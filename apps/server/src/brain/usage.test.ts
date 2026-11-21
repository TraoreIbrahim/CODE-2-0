import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Base de test isolée, dans un dossier jetable.
process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-usage-'))
const { budgetOf, budgetThreshold, costOf, onUsage, periodStarts, priceOf, recordUsage, usageResume } = await import('./usage.ts')
const { db, ensureOwner } = await import('../db.ts')

const TZ = 'UTC'
const at = (s: string) => Date.parse(s)

test('tarifs : coût exact par type de token, modèle de repli compté au tarif du modèle puissant', () => {
  // Opus 5.5 : 4 $ / 20 $ par million, cache lu 0,2 $, écrit 5 $.
  assert.equal(costOf('claude-opus-5-5', { input_tokens: 1_000_000 }), 4)
  assert.equal(costOf('claude-opus-5-5', { output_tokens: 1_000_000 }), 20)
  assert.equal(costOf('claude-opus-5-5', { cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }), 5.2)
  assert.ok(Math.abs(costOf('claude-haiku-5-5', { input_tokens: 10_000, output_tokens: 2_000 }) - (10_000 * 0.1 + 2_000 * 0.5) / 1e6) < 1e-12)
  assert.deepEqual(priceOf('claude-modele-inconnu'), priceOf('claude-opus-5-5'))
  assert.equal(costOf('claude-opus-5-5', { input_tokens: null, output_tokens: undefined }), 0)
})

test('périodes : début du jour et du mois à l’heure de l’utilisateur', () => {
  const { jour, mois } = periodStarts(at('2026-10-30T15:00:00Z'), TZ)
  assert.equal(new Date(jour).toISOString(), '2026-10-30T00:00:00.000Z')
  assert.equal(new Date(mois).toISOString(), '2026-10-01T00:00:00.000Z')
  // Paris (UTC+1 fin octobre) : le jour commence à 23 h UTC la veille.
  assert.equal(new Date(periodStarts(at('2026-10-30T15:00:00Z'), 'Europe/Paris').jour).toISOString(), '2026-10-29T23:00:00.000Z')
})

test('compteur : jour, mois et usage ; vue par personne seulement si demandée', () => {
  const a = ensureOwner()
  const b = Number(db.prepare('INSERT INTO utilisateurs (nom, cree) VALUES (?, ?)').run('Durand', Date.now()).lastInsertRowid)
  const seen: number[] = []
  const off = onUsage((uid) => seen.push(uid))
  recordUsage(a, 'conversation', 'claude-haiku-5-5', { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000 }, at('2026-10-30T09:00:00Z'))
  recordUsage(a, 'tache', 'claude-opus-5-5', { input_tokens: 10_000, output_tokens: 3000, cache_creation_input_tokens: 2000 }, at('2026-10-30T17:00:00Z'))
  recordUsage(a, 'briefing', 'claude-opus-5-5', { input_tokens: 5000, output_tokens: 500 }, at('2026-10-02T07:30:00Z'))
  recordUsage(b, 'conversation', 'claude-opus-5-5', { input_tokens: 1_000_000 }, at('2026-10-30T10:00:00Z'))
  off()
  assert.deepEqual(seen, [a, a, a, b])

  const r = usageResume(a, TZ, null, at('2026-10-30T18:00:00Z'))
  assert.equal(r.parPersonne, undefined)
  assert.equal(r.jour.total.appels, 2)
  assert.equal(r.mois.total.appels, 3)
  assert.equal(r.jour.parUsage.briefing, undefined, 'le briefing du 2 n’est pas du jour')
  assert.equal(r.mois.parUsage.briefing?.appels, 1)
  assert.equal(r.jour.parUsage.conversation?.cacheLecture, 5000)
  const tache = costOf('claude-opus-5-5', { input_tokens: 10_000, output_tokens: 3000, cache_creation_input_tokens: 2000 })
  assert.ok(Math.abs(r.jour.parUsage.tache!.cout - tache) < 1e-12)
  assert.ok(r.jour.total.cout < 1, 'les 4 $ de Durand ne sont pas comptés pour Martin')

  const owner = usageResume(a, TZ, [{ id: a, nom: 'Martin' }, { id: b, nom: 'Durand' }], at('2026-10-30T18:00:00Z'))
  assert.equal(owner.parPersonne?.length, 2)
  assert.equal(owner.parPersonne?.[1]?.jour, 4)
  assert.ok(Math.abs(owner.parPersonne![0]!.mois - r.mois.total.cout) < 1e-12)
})

test('plafond du jour : dépassé au-delà, annonce à 80 % puis à 100 %, une fois chacune par jour', () => {
  const c = Number(db.prepare('INSERT INTO utilisateurs (nom, cree) VALUES (?, ?)').run('Bernard', Date.now()).lastInsertRowid)
  const now = at('2026-11-02T10:00:00Z')
  // 1 M de tokens de sortie Opus : 20 $ ; on vise des montants ronds avec la sortie seule.
  const spend = (dollars: number, t: number) => recordUsage(c, 'conversation', 'claude-opus-5-5', { output_tokens: dollars * 50_000 }, t)
  assert.equal(budgetOf(c, TZ, null, now).depasse, false)
  spend(2, at('2026-11-02T08:00:00Z'))
  assert.equal(budgetThreshold(c, TZ, 3, now), null)
  assert.equal(budgetOf(c, TZ, 3, now).depasse, false)
  spend(0.5, at('2026-11-02T09:00:00Z'))
  assert.deepEqual(budgetThreshold(c, TZ, 3, now), { seuil: 80, depense: 2.5 })
  assert.equal(budgetThreshold(c, TZ, 3, now), null)
  spend(1, at('2026-11-02T09:30:00Z'))
  assert.equal(budgetOf(c, TZ, 3, now).depasse, true)
  assert.deepEqual(budgetThreshold(c, TZ, 3, now), { seuil: 100, depense: 3.5 })
  assert.equal(budgetThreshold(c, TZ, 3, now), null)
  // Sans plafond : jamais dépassé, jamais annoncé. Le lendemain : compteur à zéro.
  assert.equal(budgetThreshold(c, TZ, null, now), null)
  assert.equal(budgetOf(c, TZ, 3, at('2026-11-03T10:00:00Z')).depasse, false)
})
