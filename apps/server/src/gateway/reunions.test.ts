import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MIC_SAMPLE_RATE, decode, encode, type ClientMessage, type ClientPayload, type ServerPayload } from '@code/protocol'

// Base de test isolée, dans un dossier jetable.
process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-reunions-session-'))
const { setMasterKey } = await import('../users/crypto.ts')
setMasterKey(randomBytes(32))
const { ensureOwner, recentMessages } = await import('../db.ts')
const { Session } = await import('./session.ts')
const { ajouterSegment, cloreAbandonnees, creerReunion, getReunion, listerReunions, onReunionsChange } = await import('../reunions/store.ts')
const { fileReunions } = await import('../reunions/transcrire.ts')
const { wav } = await import('../voice/pcm.ts')
type SessionDeps = ConstructorParameters<typeof Session>[1]

const uid = ensureOwner()
const sent: { to: string; msg: ServerPayload }[] = []
const io = { send: (to: string, msg: ServerPayload) => sent.push({ to, msg }), sendBinary: () => {}, broadcast: (msg: ServerPayload) => sent.push({ to: '*', msg }) }
let cles: Record<string, string> = {}
const s = new Session(uid, { io, cles: () => cles, voix: async () => null, fichiers: () => false } satisfies SessionDeps)
onReunionsChange((u, id) => u === uid && s.onReunionChanged(id))
fileReunions.configurer({ cles: () => cles, transcrire: async () => 'On lance vendredi.', attentes: [0] })

/** Le message tel qu'il arrive du réseau : avec l'enveloppe (`v`, `id` du message, `ts`). */
const recu = (p: ClientPayload) => decode<ClientMessage>(encode(p)) as unknown as Record<string, unknown>
const dernier = <T extends ServerPayload['type']>(type: T) => sent.filter((e) => e.msg.type === type).at(-1)?.msg as Extract<ServerPayload, { type: T }> | undefined
const morceau = (sec: number) => {
  const pcm = Buffer.alloc(sec * MIC_SAMPLE_RATE * 2)
  for (let i = 0; i < pcm.length / 2; i += 40) pcm.writeInt16LE(8000, i * 2)
  return wav(pcm, MIC_SAMPLE_RATE)
}

test('sans clé de transcription, l’enregistrement ne commence pas', () => {
  s.onReunionDemarrer('mac-1', recu({ type: 'reunion.demarrer', source: 'micro' }))
  assert.match(dernier('reunion.refus')!.message, /Aucune clé de transcription/)
  assert.equal(listerReunions(uid).length, 0)
})

test('démarrer, envoyer, terminer : la réunion est transcrite puis annoncée une seule fois', async () => {
  cles = { OPENAI_API_KEY: 'o', DEEPGRAM_API_KEY: 'd' }
  s.onReunionDemarrer('mac-1', recu({ type: 'reunion.demarrer', source: 'micro', titre: '  Point   landing ' }))
  const ouverte = dernier('reunion.ouverte')!
  assert.equal(ouverte.titre, 'Point landing')
  // Le moins cher des deux : OpenAI, à 18 centimes l'heure.
  assert.deepEqual([ouverte.service, ouverte.tarif, ouverte.segmentS], ['OpenAI', 0.18, 120])
  const id = ouverte.reunion
  assert.deepEqual(ajouterSegment(uid, id, { rang: 0, debutS: 0, wav: morceau(90) }), { ok: true, nouveau: true })
  fileReunions.planifier(id)
  await fileReunions.attendre(id)
  assert.deepEqual(dernier('reunion.etat')!.ligne?.progression, { transcrits: 1, recus: 1 })
  s.onReunionTerminer(Number(recu({ type: 'reunion.terminer', reunion: id }).reunion))
  await fileReunions.attendre(id)
  const r = getReunion(uid, id)!
  assert.deepEqual([r.etat, r.annoncee, r.service], ['prete', true, 'openai'])
  assert.equal(dernier('reunion.etat')!.ligne?.etat, 'prete')
  // Aucun écran ouvert : l'annonce entre dans la conversation, pour que « oui » se comprenne.
  const annonces = recentMessages(uid, 10).filter((m) => m.text.includes(`[Réunion ${id} transcrite`))
  assert.equal(annonces.length, 1)
  assert.match(annonces[0]!.text, /« Point landing », 2 min\.\] La réunion est transcrite/)
  // Un changement ultérieur (rangement) ne l'annonce pas de nouveau.
  s.onReunionChanged(id)
  assert.equal(recentMessages(uid, 10).filter((m) => m.text.includes('transcrite')).length, 1)
})

test('abandonner efface tout ; un enregistrement laissé ouvert est clos d’office', async () => {
  s.onReunionDemarrer('mac-1', recu({ type: 'reunion.demarrer', source: 'fichier' }))
  const id = dernier('reunion.ouverte')!.reunion
  assert.match(dernier('reunion.ouverte')!.titre, /^Enregistrement importé le /)
  s.onReunionAnnuler(id)
  assert.equal(getReunion(uid, id), null)
  assert.equal(dernier('reunion.etat')!.ligne, undefined)

  const vieille = creerReunion(uid, { titre: 'Oubliée', source: 'micro' }, Date.now() - 3 * 3600_000)
  ajouterSegment(uid, vieille.id, { rang: 0, debutS: 0, wav: morceau(60) })
  const recente = creerReunion(uid, { titre: 'En cours', source: 'micro' }, Date.now() - 60_000)
  assert.deepEqual(cloreAbandonnees(Date.now()).map((r) => r.id), [vieille.id])
  assert.equal(getReunion(uid, recente.id)!.etat, 'enregistrement')
  fileReunions.planifier(vieille.id)
  await fileReunions.attendre(vieille.id)
  assert.equal(getReunion(uid, vieille.id)!.etat, 'prete')
})

test('une visio de l’agenda commence : proposée une fois sur les écrans ouverts, jamais pendant un enregistrement', () => {
  const v = { cle: 'ev@1', titre: 'Point hebdo', debut: Date.UTC(2026, 10, 12, 13, 30), service: 'Meet' }
  for (const r of listerReunions(uid).filter((x) => x.etat === 'enregistrement')) s.onReunionAnnuler(r.id)
  // Aucun écran ouvert : à retenter.
  assert.equal(s.onVisioProche(v), false)
  s.welcome('mac-1', 'mac', 1)
  assert.equal(s.onVisioProche(v), true)
  const p = dernier('reunion.proposition')!
  assert.deepEqual([p.titre, p.service, p.cle], ['Point hebdo', 'Meet', 'ev@1'])
  assert.match(recentMessages(uid, 3).at(-1)!.text, /^\[Réunion d’agenda : « Point hebdo », \d\d:\d\d, en visio\.\] .* réunion « Point hebdo » commence sur Meet\. Je l’enregistre \?$/)
  // Un enregistrement est déjà en cours : rien de plus.
  const avant = sent.filter((e) => e.msg.type === 'reunion.proposition').length
  creerReunion(uid, { titre: 'En cours', source: 'micro' }, Date.now())
  assert.equal(s.onVisioProche({ ...v, cle: 'ev@2' }), true)
  assert.equal(sent.filter((e) => e.msg.type === 'reunion.proposition').length, avant)
})

test('la miniature (ou un autre écran) voit l’enregistrement et peut l’arrêter', () => {
  for (const r of listerReunions(uid).filter((x) => x.etat === 'enregistrement')) s.onReunionAnnuler(r.id)
  const debut = Date.now()
  s.onReunionDemarrer('mac-1', recu({ type: 'reunion.demarrer', source: 'micro' }))
  const id = dernier('reunion.ouverte')!.reunion
  // Tous les écrans apprennent qu'on enregistre, et depuis quand (le chrono de la miniature).
  const ligne = sent.filter((e) => e.to === '*' && e.msg.type === 'reunion.etat').at(-1)!.msg as Extract<ServerPayload, { type: 'reunion.etat' }>
  assert.equal(ligne.ligne?.etat, 'enregistrement')
  assert.ok(ligne.ligne!.debut! >= debut && ligne.ligne!.debut! <= Date.now())
  // « Terminer » depuis la miniature : la demande part à tous, celui qui enregistre s'arrête.
  const avant = sent.filter((e) => e.msg.type === 'reunion.commande').length
  s.onReunionStop(Number(recu({ type: 'reunion.stop', reunion: id }).reunion))
  assert.deepEqual(sent.filter((e) => e.msg.type === 'reunion.commande').at(-1), { to: '*', msg: { type: 'reunion.commande', action: 'arreter' } })
  // Une réunion déjà finie, ou d'un autre numéro : rien.
  s.onReunionAnnuler(id)
  s.onReunionStop(id)
  s.onReunionStop(999_999)
  assert.equal(sent.filter((e) => e.msg.type === 'reunion.commande').length, avant + 1)
  // Une fois l'enregistrement fini, la ligne ne porte plus de début.
  assert.equal(listerReunions(uid).filter((x) => x.etat === 'enregistrement').length, 0)
})

test('pendant un enregistrement : pause depuis n’importe quel écran, et l’assistant n’écoute plus en continu', () => {
  for (const r of listerReunions(uid).filter((x) => x.etat === 'enregistrement')) s.onReunionAnnuler(r.id)
  s.onReunionDemarrer('mac-1', recu({ type: 'reunion.demarrer', source: 'micro' }))
  const id = dernier('reunion.ouverte')!.reunion
  // Pause : tous les écrans l'apprennent ; demander deux fois la même chose ne change rien.
  assert.equal(s.onReunionPause(id, true), true)
  assert.equal(dernier('reunion.etat')!.ligne?.enPause, true)
  assert.equal(s.onReunionPause(id, true), false)
  assert.equal(s.reunionsPayload().reunions.find((r) => r.id === id)?.enPause, true)
  assert.equal(s.onReunionPause(Number(recu({ type: 'reunion.pause', reunion: id, pause: false }).reunion), false), true)
  assert.equal(dernier('reunion.etat')!.ligne?.enPause, undefined)
  assert.equal(s.onReunionPause(999_999, true), false)
  // Le mode conversation est refusé tant que la réunion s'enregistre : il répondrait à tout ce qui se dit.
  const refus = s.setConversation('mac-1', true)
  assert.equal(refus.ok, false)
  assert.match(refus.message, /pendant l’enregistrement d’une réunion/)
  // Terminée : la pause est oubliée.
  s.onReunionPause(id, true)
  s.onReunionAnnuler(id)
  assert.equal(s.reunionsPayload().reunions.some((r) => r.enPause), false)
})
