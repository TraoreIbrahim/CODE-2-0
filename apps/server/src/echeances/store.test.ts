import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Base de test isolée, dans un dossier jetable.
process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-echeances-'))
const { creerEcheance, echeancesARegler, getEcheance, modifierEcheance, reglerEcheance, regleesDepuis, supprimerEcheance } = await import('./store.ts')
const { echeancierPourClaude, echeancierView } = await import('./vue.ts')
const { getRappel } = await import('../scheduler/store.ts')
const { db, ensureOwner } = await import('../db.ts')
const U = ensureOwner()
const other = Number(db.prepare('INSERT INTO utilisateurs (nom, cree) VALUES (?, ?)').run('Durand', Date.now()).lastInsertRowid)

const TZ = 'Europe/Paris'
const NOW = Date.parse('2026-11-04T10:00:00Z')
const base = { categorie: 'facture' as const, montant: null, devise: null, recurrence: null, prevenir: 3, note: null }
const iso = (ms: number) => new Date(ms).toISOString()

test('ajout : un rappel le jour du préavis à 9 h (heure locale) ; aucun si ce moment est passé', () => {
  const e = creerEcheance(U, { ...base, titre: 'Électricité', date: '2026-11-14', montant: 84.9, devise: 'EUR' }, NOW, TZ)
  const r = getRappel(U, e.rappelId!)!
  assert.equal(iso(r.echeance), '2026-11-11T08:00:00.000Z')
  assert.match(r.texte, /Électricité.*84,90.*samedi 14 novembre.*échéance \d+/)
  assert.equal(r.annonce!.replace(/[\u202f\u00a0]/g, ' '), 'l’échéance « Électricité » de 84,90 € tombe samedi 14 novembre')
  const proche = creerEcheance(U, { ...base, titre: 'Cantine', date: '2026-11-05' }, NOW, TZ)
  assert.equal(proche.rappelId, null)
})

test('réglée : rappel retiré, historique gardé, la suivante d’une récurrente créée avec son rappel', () => {
  const loyer = creerEcheance(U, { ...base, categorie: 'loyer', titre: 'Loyer', date: '2026-01-31', montant: 1150, devise: 'EUR', recurrence: 'mensuel' }, Date.parse('2026-01-01T10:00:00Z'), TZ)
  const rappel = loyer.rappelId!
  const r = reglerEcheance(U, loyer.id, Date.parse('2026-01-30T10:00:00Z'), TZ)!
  assert.equal(r.reglee.etat, 'regle')
  assert.equal(getRappel(U, rappel), null)
  assert.equal(r.suivante!.date, '2026-02-28')
  assert.equal(r.suivante!.jour, 31)
  assert.ok(r.suivante!.rappelId)
  // Réglée une seconde fois : rien.
  assert.equal(reglerEcheance(U, loyer.id, NOW, TZ), null)
  const apres = reglerEcheance(U, r.suivante!.id, Date.parse('2026-02-27T10:00:00Z'), TZ)!
  assert.equal(apres.suivante!.date, '2026-03-31')
  assert.ok(regleesDepuis(U, Date.parse('2026-01-01T00:00:00Z')).some((e) => e.id === loyer.id))
})

test('modifiée : le rappel suit la date ; retirée : plus de rappel ni de ligne', () => {
  const e = creerEcheance(U, { ...base, titre: 'Assurance', date: '2026-11-20' }, NOW, TZ)
  const avant = e.rappelId!
  const m = modifierEcheance(U, e.id, { date: '2026-12-10', prevenir: 7 }, NOW, TZ)!
  assert.equal(getRappel(U, avant), null)
  assert.equal(iso(getRappel(U, m.rappelId!)!.echeance), '2026-12-03T08:00:00.000Z')
  supprimerEcheance(U, e.id)
  assert.equal(getEcheance(U, e.id), null)
  assert.equal(getRappel(U, m.rappelId!), null)
})

test('cloisonnement : l’échéance d’un autre est introuvable et intouchable', () => {
  const e = creerEcheance(other, { ...base, titre: 'Taxe foncière', date: '2026-12-15' }, NOW, TZ)
  assert.equal(getEcheance(U, e.id), null)
  assert.equal(reglerEcheance(U, e.id, NOW, TZ), null)
  assert.equal(modifierEcheance(U, e.id, { titre: 'x' }, NOW, TZ), null)
  assert.ok(!echeancesARegler(U).some((x) => x.id === e.id))
})

test('vue : retards, semaine, mois, plus tard ; chiffres clés et texte pour l’assistant', () => {
  const v = echeancierView(echeancesARegler(U), [], NOW, TZ)
  // Le loyer de mars est passé, la cantine tombe demain, l'électricité dans 10 jours.
  assert.deepEqual(v.groupes.map((g) => g.label), ['En retard', 'Cette semaine', 'Ce mois-ci'])
  assert.equal(v.groupes[0]!.echeances[0]!.dans.startsWith('en retard'), true)
  assert.equal(v.kpis[0]!.tone, 'alerte')
  const texte = echeancierPourClaude(v)
  assert.match(texte.replace(/[\u202f\u00a0]/g, ' '), /\[échéance \d+\] Électricité · sam\. 14 nov\. \(dans 10 jours\) · 84,90 €/)
  assert.match(echeancierPourClaude(echeancierView([], [], NOW, TZ)), /^Aucune échéance à régler/)
})
