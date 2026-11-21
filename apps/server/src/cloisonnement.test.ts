import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Base de test isolée, dans un dossier jetable.
process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-cloison-'))
const { setMasterKey } = await import('./users/crypto.ts')
setMasterKey(randomBytes(32))
const { addLog, addMessage, db, ensureOwner, recentLog, recentMessages } = await import('./db.ts')
const store = await import('./scheduler/store.ts')
await import('./echeances/store.ts')
await import('./documents/store.ts')
const listes = await import('./listes/store.ts')
const push = await import('./push/push.ts')
const { recordUsage, usageResume } = await import('./brain/usage.ts')
await import('./google/oauth.ts')
await import('./voice/speaker.ts')
await import('./scheduler/tasks.ts')
await import('./users/users.ts')
await import('./users/cles.ts')
await import('./users/comptes.ts')

/** Tables qui appartiennent à un utilisateur : aucune lecture ni écriture sans lui. */
const CLOISONNEES = ['messages', 'log', 'rappels', 'echeances', 'documents', 'listes', 'etat', 'taches', 'taches_executions', 'push_abonnements', 'google_acces', 'empreintes_vocales', 'usage_tokens', 'appareils', 'cles']

/**
 * Requêtes volontairement transverses, chacune avec sa raison. Toute autre requête sur une table
 * cloisonnée doit filtrer (`utilisateur_id = ?`) ou écrire (`utilisateur_id` en colonne) son utilisateur.
 */
const EXCEPTIONS: Record<string, string> = {
  'SELECT * FROM appareils WHERE jeton_hash = ?': 'authentification : le jeton désigne lui-même son utilisateur',
  'SELECT utilisateur_id AS uid FROM google_acces WHERE utilisateur_id IS NOT NULL': 'démarrage : liste des utilisateurs à vérifier, sans lire de jeton',
  "UPDATE taches_executions SET statut = 'erreur'": 'démarrage : le serveur entier s’est arrêté, les exécutions de tous sont interrompues',
  'UPDATE listes SET modifie = ? WHERE id = ?': 'liste partagée : écrite par chacun de ceux qui la voient, accès vérifié avant (getListe)'
}

const src = fileURLToPath(new URL('.', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : []
  })
}

/** Les requêtes préparées écrites en toutes lettres (les migrations génériques `${table}` n'en nomment aucune). */
function statements(): { file: string; sql: string }[] {
  const out: { file: string; sql: string }[] = []
  for (const file of sources(src)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/\.prepare\(\s*(['"`])([\s\S]*?)\1\s*\)/g)) out.push({ file: relative(src, file), sql: m[2]!.replace(/\s+/g, ' ').trim() })
  }
  return out
}

const touches = (sql: string, table: string) => new RegExp(`\\b(FROM|INTO|UPDATE|JOIN)\\s+${table}\\b`, 'i').test(sql)

test('statique : chaque requête sur une table cloisonnée porte son utilisateur', () => {
  const all = statements()
  assert.ok(all.length > 40, `requêtes trouvées : ${all.length}`)
  const fautes: string[] = []
  let vues = 0
  for (const { file, sql } of all) {
    const table = CLOISONNEES.find((t) => touches(sql, t))
    if (!table) continue
    vues++
    if (Object.keys(EXCEPTIONS).some((e) => sql.startsWith(e))) continue
    const ok = /^INSERT/i.test(sql) ? /\(\s*utilisateur_id\b/.test(sql) : /\butilisateur_id\s*=\s*\?/.test(sql)
    if (!ok) fautes.push(`${file} : ${sql}`)
  }
  assert.ok(vues > 30, `requêtes cloisonnées vues : ${vues}`)
  assert.deepEqual(fautes, [], 'requêtes sans filtre utilisateur')
})

test('statique : chaque table cloisonnée a sa colonne utilisateur_id', () => {
  for (const table of CLOISONNEES) {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number; pk: number }[]).map((c) => c.name)
    assert.ok(cols.includes('utilisateur_id'), `${table} sans utilisateur_id`)
  }
})

const a = ensureOwner()
const b = Number(db.prepare('INSERT INTO utilisateurs (nom, cree) VALUES (?, ?)').run('Durand', Date.now()).lastInsertRowid)

test('deux utilisateurs : messages et journal chacun chez soi', () => {
  addMessage(a, 'user', 'Rappelle-moi le devis peinture')
  addMessage(b, 'user', 'Quels sont mes rappels ?')
  addLog(a, 'voix', 'devis peinture')
  assert.deepEqual(recentMessages(a, 10).map((m) => m.text), ['Rappelle-moi le devis peinture'])
  assert.deepEqual(recentMessages(b, 10).map((m) => m.text), ['Quels sont mes rappels ?'])
  assert.deepEqual(recentLog(b, 10), [])
  assert.equal(recentLog(a, 10).length, 1)
})

test('deux utilisateurs : un rappel n’est ni visible, ni modifiable, ni supprimable par l’autre', () => {
  const r = store.createRappel(a, 'Appeler le plombier', Date.parse('2026-10-30T10:00:00Z'), null)
  assert.equal(store.getRappel(b, r.id), null)
  assert.deepEqual(store.activeRappels(b), [])
  assert.equal(store.markDone(b, r.id, Date.now()), null)
  assert.equal(store.snooze(b, r.id, Date.now()), null)
  store.deleteRappel(b, r.id)
  assert.ok(store.getRappel(a, r.id), 'toujours là pour son utilisateur')
  // Il ne sonne que pour lui.
  assert.deepEqual(store.fireDue(b, Date.parse('2026-10-30T10:00:05Z'), 'UTC'), [])
  assert.deepEqual(store.fireDue(a, Date.parse('2026-10-30T10:00:05Z'), 'UTC').map((x) => x.id), [r.id])
})

test('listes : une liste privée n’est ni visible ni modifiable par un autre ; partagée, seulement par ceux qui la voient', () => {
  const c = Number(db.prepare('INSERT INTO utilisateurs (prenom, cree) VALUES (?, ?)').run('Alex', Date.now()).lastInsertRowid)
  const privee = listes.creerListe(a, 'Cadeaux')
  listes.ajouterElements(a, privee.id, [{ texte: 'Livre' }])
  assert.equal(listes.getListe(b, privee.id), null)
  assert.deepEqual(listes.elementsDe(b, privee.id), [])
  assert.equal(listes.ajouterElements(b, privee.id, [{ texte: 'Intrus' }]), null)
  assert.equal(listes.cocherElements(b, privee.id, [listes.elementsDe(a, privee.id)[0]!.id]), null)
  assert.equal(listes.retirerElements(b, privee.id, { coches: true }), null)
  assert.equal(listes.supprimerListe(b, privee.id), false)
  // Partagée avec b seulement : b l'écrit et la coche ; c ne la voit pas.
  const avecB = listes.partagerListe(a, privee.id, 'personnes', [b])!
  assert.equal(avecB.partage, 'personnes')
  assert.ok(listes.ajouterElements(b, privee.id, [{ texte: 'Carte' }]))
  assert.equal(listes.getListe(c, privee.id), null)
  // Seul le créateur la repartage ou la supprime.
  assert.equal(listes.partagerListe(b, privee.id, 'tous'), null)
  assert.equal(listes.supprimerListe(b, privee.id), false)
  listes.partagerListe(a, privee.id, 'tous')
  assert.ok(listes.getListe(c, privee.id))
  listes.partagerListe(a, privee.id, 'prive')
  assert.equal(listes.getListe(b, privee.id), null)
  assert.deepEqual(listes.listesDe(c), [])
})

test('deux utilisateurs : état (présence, briefing, veille) séparé', () => {
  store.setState(a, 'briefing_matin', '2026-10-30')
  assert.equal(store.getState(b, 'briefing_matin'), null)
  store.setState(b, 'briefing_matin', '2026-10-29')
  assert.equal(store.getState(a, 'briefing_matin'), '2026-10-30')
})

test('deux utilisateurs : un téléphone abonné ne reçoit que les notifications de son utilisateur', () => {
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } }
  assert.ok(!('erreur' in push.subscribe(a, sub)))
  assert.equal(push.pushInfo(a).abonnes, 1)
  assert.equal(push.pushInfo(b).abonnes, 0)
  push.unsubscribe(b, sub.endpoint)
  assert.equal(push.pushInfo(a).abonnes, 1, 'l’autre ne peut pas le désabonner')
  // Le même téléphone se reconnecte avec un autre compte : il passe à celui-ci.
  push.subscribe(b, sub)
  assert.equal(push.pushInfo(a).abonnes, 0)
  assert.equal(push.pushInfo(b).abonnes, 1)
})

test('deux utilisateurs : compteur de tokens par personne', () => {
  const now = Date.parse('2026-10-30T12:00:00Z')
  recordUsage(a, 'conversation', 'claude-opus-5-5', { input_tokens: 1000, output_tokens: 100 }, now)
  recordUsage(b, 'tache', 'claude-haiku-5-5', { input_tokens: 2000, output_tokens: 0 }, now)
  assert.equal(usageResume(b, 'UTC', null, now).jour.parUsage.conversation, undefined)
  assert.equal(usageResume(a, 'UTC', null, now).jour.total.appels, 1)
})
