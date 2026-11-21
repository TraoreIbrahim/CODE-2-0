import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Base de test isolée, dans un dossier jetable.
process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-taches-'))
const { createTache, executions, finishExecution, getExecution, getTache, runningTaches, startExecution, takeDue, updateTache } = await import('./tasks.ts')
const { splitResult, tachesView, toUiTache } = await import('./task-views.ts')
const { db, ensureOwner } = await import('../db.ts')
const U = ensureOwner()
const other = Number(db.prepare('INSERT INTO utilisateurs (nom, cree) VALUES (?, ?)').run('Durand', Date.now()).lastInsertRowid)

const TZ = 'UTC'
const at = (s: string) => Date.parse(s)
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())
const daily17 = { type: 'quotidien' as const, heure: 17 * 60 }

test('récurrente : lancée une fois, puis reprogrammée au lendemain ; occurrences manquées non rattrapées', () => {
  const t = createTache(U, 'Idées TikTok', 'Propose deux idées.', at('2026-10-30T17:00:00Z'), daily17)
  assert.deepEqual(takeDue(U, at('2026-10-30T16:59:00Z'), TZ), [])
  const due = takeDue(U, at('2026-10-30T17:00:05Z'), TZ)
  assert.equal(due.length, 1)
  assert.equal(due[0]!.retard, false)
  assert.equal(iso(getTache(U, t.id)!.echeance), '2026-10-31T17:00:00.000Z')
  assert.deepEqual(takeDue(U, at('2026-10-30T17:00:15Z'), TZ), [], 'pas de double lancement')
  // Mac éteint trois jours : une seule exécution, en retard, puis la prochaine occurrence future.
  const late = takeDue(U, at('2026-11-03T08:00:00Z'), TZ)
  assert.equal(late.length, 1)
  assert.equal(late[0]!.retard, true)
  assert.equal(iso(getTache(U, t.id)!.echeance), '2026-11-03T17:00:00.000Z')
})

test('ponctuelle : terminée après son exécution ; pause puis reprise sans rattrapage', () => {
  const once = createTache(U, 'Bilan', 'Fais le bilan.', at('2026-10-30T09:00:00Z'), null)
  takeDue(U, at('2026-10-30T09:00:00Z'), TZ)
  assert.equal(getTache(U, once.id)!.etat, 'terminee')
  assert.equal(getTache(U, once.id)!.echeance, null)

  const t = createTache(U, 'Veille', 'Résume.', at('2026-10-30T17:00:00Z'), daily17)
  updateTache(U, t.id, { etat: 'pause' }, at('2026-10-30T10:00:00Z'), TZ)
  assert.deepEqual(takeDue(U, at('2026-10-30T17:30:00Z'), TZ).filter((d) => d.tache.id === t.id), [], 'en pause : rien ne part')
  const resumed = updateTache(U, t.id, { etat: 'active' }, at('2026-10-30T18:00:00Z'), TZ)!
  assert.equal(iso(resumed.echeance), '2026-10-31T17:00:00.000Z')
})

test('exécutions : en cours, puis résultat gardé ; vue de la tâche', () => {
  const t = createTache(U, 'Idées', 'Deux idées.', at('2026-10-31T17:00:00Z'), daily17)
  const id = startExecution(U, t.id, at('2026-10-30T17:00:00Z'), false)
  assert.ok(runningTaches(U).has(t.id))
  finishExecution(U, id, 'ok', 'Deux idées : API et Mobile Money', '## Idée 1', at('2026-10-30T17:01:30Z'))
  assert.ok(!runningTaches(U).has(t.id))
  const ui = toUiTache(getTache(U, t.id)!, executions(U, t.id, 1)[0]!, false, at('2026-10-30T18:00:00Z'), TZ)
  assert.equal(ui.quand, 'tous les jours à 17:00')
  assert.equal(ui.prochaineLabel, 'demain · 17:00')
  assert.equal(ui.derniere?.resume, 'Deux idées : API et Mobile Money')
  assert.equal(ui.derniere?.quand, 'aujourd’hui à 17:01')
  assert.match(tachesView([ui]).sousTitre, /^1 TÂCHE ACTIVE · PROCHAINE DEMAIN · 17:00$/)
})

test('cloisonnement : un autre utilisateur ne voit, ne lance ni ne modifie les tâches du premier', () => {
  const t = createTache(U, 'Rapport', 'Résume les mails de la semaine.', at('2026-11-05T08:00:00Z'), null)
  assert.equal(getTache(other, t.id), null)
  assert.equal(updateTache(other, t.id, { etat: 'pause' }), null)
  assert.deepEqual(takeDue(other, at('2026-11-05T09:00:00Z'), TZ), [])
  assert.ok(getTache(U, t.id), 'toujours là pour son utilisateur')
  const id = startExecution(U, t.id, at('2026-11-05T09:00:00Z'), false)
  assert.equal(getExecution(other, id), null)
  assert.ok(getExecution(U, id))
})

test('résumé : ligne « Résumé : » détachée du contenu, sinon début du texte', () => {
  assert.deepEqual(splitResult('Résumé : **Deux idées** sur le Mobile Money\n\n## Idée 1\nTexte'), { resume: 'Deux idées sur le Mobile Money', texte: '## Idée 1\nTexte' })
  assert.deepEqual(splitResult('## Idée 1 : le **cache** expliqué\nTexte'), { resume: 'Idée 1 : le cache expliqué', texte: '## Idée 1 : le **cache** expliqué\nTexte' })
})
