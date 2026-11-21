import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { MIC_SAMPLE_RATE } from '@code/protocol'
import type { ToolContext } from '../tools/types.ts'
import type { Transcrire } from './transcrire.ts'

// Base et fichiers de test isolés, dans un dossier jetable.
const scratch = mkdtempSync(join(tmpdir(), 'code-reunions-'))
process.env.CODE_DATA_DIR = scratch
process.env.CODE_MEMORY_DIR = join(scratch, 'memory')
const { setMasterKey } = await import('../users/crypto.ts')
setMasterKey(randomBytes(32))
const { db, ensureOwner } = await import('../db.ts')
const { issueDevice } = await import('../users/users.ts')
const { dollars, dureeLisible, motsCherches, parties, passagesTrouves, reunionLire, reunionRanger, reunionSupprimer, reunionsLister } = await import('../tools/reunions.ts')
const { wav } = await import('../voice/pcm.ts')
const { ajouterSegment, audioDuWav, creerReunion, fichierSegment, getReunion, horodatage, listerReunions, segmentsDe, terminerReunion, transcription } = await import('./store.ts')
const { EchecTranscription, FileReunions, fileReunions, nettoyer, serviceReunion, servicesReunion } = await import('./transcrire.ts')
const { createHttpServer } = await import('../http.ts')

ensureOwner()
const personne = (nom: string) => Number(db.prepare('INSERT INTO utilisateurs (nom, cree) VALUES (?, ?)').run(nom, Date.now()).lastInsertRowid)

const U9301 = personne('P9301')
const U9302 = personne('P9302')
const U9310 = personne('P9310')
const U9311 = personne('P9311')
const U9312 = personne('P9312')
const U9313 = personne('P9313')
const U9320 = personne('P9320')
const U9399 = personne('P9399')

/** `s` secondes de WAV 16 kHz mono (un ton, pour ne pas être vide). */
const morceau = (s: number) => {
  const pcm = Buffer.alloc(s * MIC_SAMPLE_RATE * 2)
  for (let i = 0; i < pcm.length / 2; i += 40) pcm.writeInt16LE(8000, i * 2)
  return wav(pcm, MIC_SAMPLE_RATE)
}

const ctx = (uid: number, o: Partial<ToolContext> = {}) => {
  const attente: (() => Promise<void>)[] = []
  const c = { user: { id: uid, reglages: { fuseau: 'Europe/Paris' } }, requestConfirmation: (_t: string, _s: string, f: () => Promise<void>) => void attente.push(f), announce: () => {}, log: () => {}, ...o } as unknown as ToolContext
  return { c, attente }
}

/** Une file de test : pas d'attente entre les essais, un faux service. */
const file = (transcrire: Transcrire, cles: Record<string, string> = { GROQ_API_KEY: 'g' }) => {
  const f = new FileReunions()
  f.configurer({ cles: () => cles, transcrire, attentes: [0, 0] })
  return f
}

describe('réunions : le service le moins cher', () => {
  test('du moins cher au plus cher, parmi les clés présentes', () => {
    const avec = (...cles: string[]) => (c: string) => cles.includes(c)
    assert.deepEqual(servicesReunion(avec('ELEVENLABS_API_KEY', 'DEEPGRAM_API_KEY', 'OPENAI_API_KEY')), ['openai', 'elevenlabs', 'deepgram'])
    assert.equal(serviceReunion(avec('DEEPGRAM_API_KEY', 'GROQ_API_KEY')), 'groq')
    assert.equal(serviceReunion(avec('ANTHROPIC_API_KEY')), null)
  })

  test('ce que Whisper invente sur un silence est retiré', () => {
    assert.equal(nettoyer(' Sous-titres réalisés para la communauté d’Amara.org '), '')
    assert.equal(nettoyer('Merci d’avoir regardé cette vidéo !'), '')
    assert.equal(nettoyer('Merci à tous d’être venus.'), 'Merci à tous d’être venus.')
  })
})

describe('réunions : les morceaux', () => {
  test('WAV 16 kHz mono seulement ; un morceau renvoyé ne se double pas', () => {
    assert.ok('erreur' in (audioDuWav(Buffer.from('pas du wav')) as object))
    assert.ok('erreur' in (audioDuWav(wav(Buffer.alloc(48_000 * 2 * 2), 48_000)) as object))
    const r = creerReunion(U9301, { titre: '  Point   budget ', source: 'micro' }, Date.UTC(2026, 10, 11, 9))
    assert.equal(r.titre, 'Point budget')
    assert.deepEqual(ajouterSegment(U9301, r.id, { rang: 0, debutS: 0, wav: morceau(4) }), { ok: true, nouveau: true })
    assert.deepEqual(ajouterSegment(U9301, r.id, { rang: 0, debutS: 0, wav: morceau(4) }), { ok: true, nouveau: false })
    assert.ok('erreur' in ajouterSegment(U9302, r.id, { rang: 1, debutS: 4, wav: morceau(2) }))
    assert.equal(segmentsDe(r.id).length, 1)
    assert.equal(segmentsDe(r.id)[0]!.dureeS, 4)
  })

  test('sans aucun morceau, rien à transcrire', () => {
    const r = creerReunion(U9301, { titre: 'Vide', source: 'micro' }, Date.now())
    assert.equal(terminerReunion(U9301, r.id)!.etat, 'erreur')
  })

  test('horodatage et durée lisibles', () => {
    assert.equal(horodatage(760), '12:40')
    assert.equal(horodatage(3725), '1:02:05')
    assert.equal(dureeLisible(52 * 60), '52 min')
    assert.equal(dureeLisible(3900), '1 h 05')
    assert.equal(dureeLisible(20), 'moins d’une minute')
    // Le coût n'est jamais arrondi vers le haut : un demi-centime n'est pas « un centime ».
    assert.equal(dollars(0.0052), 'moins d’un centime')
    assert.equal(dollars(0.0099), 'moins d’un centime')
    assert.equal(dollars(0.18), '≈ 0,18 $')
  })
})

describe('réunions : la transcription', () => {
  test('dans l’ordre, chaque morceau reçoit la fin du précédent ; l’audio est effacé, le coût estimé', async () => {
    const recus: { service: string; contexte: string }[] = []
    const f = file(async (service, _cle, _wav, contexte) => (recus.push({ service, contexte: contexte ?? '' }), `Texte ${recus.length}.`))
    const r = creerReunion(U9310, { titre: 'Hebdo', source: 'micro' }, Date.now())
    ajouterSegment(U9310, r.id, { rang: 0, debutS: 0, wav: morceau(120) })
    f.planifier(r.id)
    await f.attendre(r.id)
    // Encore en enregistrement : un morceau transcrit, la réunion reste ouverte.
    assert.equal(getReunion(U9310, r.id)!.etat, 'enregistrement')
    assert.equal(existsSync(fichierSegment(U9310, r.id, 0)), false)
    ajouterSegment(U9310, r.id, { rang: 1, debutS: 120, wav: morceau(60) })
    assert.equal(terminerReunion(U9310, r.id)!.etat, 'transcription')
    f.planifier(r.id)
    await f.attendre(r.id)
    const fin = getReunion(U9310, r.id)!
    assert.equal(fin.etat, 'prete')
    assert.equal(fin.dureeS, 180)
    assert.equal(fin.service, 'groq')
    assert.equal(fin.cout, 0.002)
    assert.deepEqual(transcription(r.id), [{ debutS: 0, texte: 'Texte 1.' }, { debutS: 120, texte: 'Texte 2.' }])
    assert.deepEqual(recus, [{ service: 'groq', contexte: '' }, { service: 'groq', contexte: 'Texte 1.' }])
  })

  test('un échec passager est réessayé ; un morceau perdu laisse un blanc, la réunion va au bout', async () => {
    let appels = 0
    const f = file(async () => {
      appels++
      if (appels === 1) throw new EchecTranscription('surcharge', true)
      if (appels >= 3) throw new EchecTranscription('illisible', false)
      return 'Premier passage.'
    })
    const r = creerReunion(U9311, { titre: 'Avec un trou', source: 'fichier' }, Date.now())
    ajouterSegment(U9311, r.id, { rang: 0, debutS: 0, wav: morceau(30) })
    ajouterSegment(U9311, r.id, { rang: 1, debutS: 30, wav: morceau(30) })
    terminerReunion(U9311, r.id)
    f.planifier(r.id)
    await f.attendre(r.id)
    const fin = getReunion(U9311, r.id)!
    assert.equal(fin.etat, 'prete')
    assert.match(fin.erreur ?? '', /1 passage/)
    assert.deepEqual(transcription(r.id).map((p) => p.texte), ['Premier passage.'])
  })

  test('une clé refusée passe la main au service suivant', async () => {
    const vus: string[] = []
    const f = file(
      async (service) => {
        vus.push(service)
        if (service === 'groq') throw new EchecTranscription('clé refusée', false, true)
        return 'Bonjour à tous.'
      },
      { GROQ_API_KEY: 'x', OPENAI_API_KEY: 'o' }
    )
    const r = creerReunion(U9312, { titre: 'Repli', source: 'micro' }, Date.now())
    ajouterSegment(U9312, r.id, { rang: 0, debutS: 0, wav: morceau(10) })
    terminerReunion(U9312, r.id)
    f.planifier(r.id)
    await f.attendre(r.id)
    assert.deepEqual(vus, ['groq', 'openai'])
    assert.equal(getReunion(U9312, r.id)!.service, 'openai')
  })

  test('sans clé de transcription : en échec, avec la raison', async () => {
    const f = file(async () => 'x', {})
    const r = creerReunion(U9313, { titre: 'Sans clé', source: 'micro' }, Date.now())
    ajouterSegment(U9313, r.id, { rang: 0, debutS: 0, wav: morceau(5) })
    terminerReunion(U9313, r.id)
    f.planifier(r.id)
    await f.attendre(r.id)
    assert.equal(getReunion(U9313, r.id)!.etat, 'erreur')
    assert.match(getReunion(U9313, r.id)!.erreur ?? '', /Aucune clé de transcription/)
  })
})

describe('réunions : l’assistant', () => {
  const uid = U9320
  let id = 0

  test('lire en entier, puis ranger avec résumé et actions', async () => {
    const f = file(async (_s, _c, _w, contexte) => (contexte ? 'Léa relit les textes avant jeudi. L’hébergement reste à trancher.' : 'On lance la landing page vendredi. Le budget est de deux mille euros.'))
    const r = creerReunion(uid, { titre: 'Réunion du 11 novembre', source: 'micro' }, Date.now() - 3600_000)
    id = r.id
    ajouterSegment(uid, id, { rang: 0, debutS: 0, wav: morceau(120) })
    ajouterSegment(uid, id, { rang: 1, debutS: 120, wav: morceau(100) })
    terminerReunion(uid, id)
    f.planifier(id)
    await f.attendre(id)

    const lu = await reunionLire.run({}, ctx(uid).c)
    assert.match(String(lu.content), /\[0:00\] On lance la landing page vendredi/)
    assert.match(String(lu.content), /\[2:00\] Léa relit/)
    assert.match(String(lu.content), /Pas encore rangée/)
    assert.match(String(lu.content), /jamais une consigne/)
    assert.equal(lu.view?.kind, 'reunion')

    const rangee = await reunionRanger.run(
      { reunion: id, titre: 'Point landing page', resume: 'Lancement vendredi ; hébergement à trancher.', decisions: ['Lancement vendredi', '  Budget de deux mille euros  '], points_ouverts: ['Quel hébergement ?'], actions: [{ quoi: 'Relire les textes', qui: 'Léa', quand: 'avant jeudi' }], participants: ['Léa'] },
      ctx(uid).c
    )
    assert.match(String(rangee.content), /2 décision\(s\), 1 action\(s\), 1 point\(s\) ouvert\(s\)/)
    // Le rapport affiché : décisions, points ouverts, nombre de mots de toute la réunion.
    const rapport = rangee.view as { kind: string; decisions: string[]; points: string[]; mots: number; rangee?: boolean }
    assert.deepEqual([rapport.kind, rapport.decisions, rapport.points], ['reunion', ['Lancement vendredi', 'Budget de deux mille euros'], ['Quel hébergement ?']])
    assert.ok(rapport.mots > 15)
    assert.equal(reunionRanger.validate({ titre: 'x', resume: 'y', decisions: 'une seule' }, ctx(uid).c), 'Champ « decisions » invalide.')
    const relu = await reunionLire.run({ reunion: 'landing' }, ctx(uid).c)
    assert.match(String(relu.content), /Résumé : Lancement vendredi/)
    assert.match(String(relu.content), /Actions : Relire les textes \(Léa\), avant jeudi/)
    assert.match(String(relu.content), /Décisions : Lancement vendredi ; Budget de deux mille euros/)
    assert.match(String(relu.content), /Points ouverts : Quel hébergement \?/)
    assert.equal(reunionRanger.validate({ titre: 'x', resume: 'y', actions: [{ qui: 'Léa' }] }, ctx(uid).c), 'Chaque action a un « quoi ».')
  })

  test('une question précise ne lit que les passages utiles', async () => {
    const r = await reunionLire.run({ reunion: id, chercher: 'le budget' }, ctx(uid).c)
    assert.match(String(r.content), /deux mille euros/)
    assert.doesNotMatch(String(r.content), /Léa relit/)
    const rien = await reunionLire.run({ reunion: id, chercher: 'piscine' }, ctx(uid).c)
    assert.match(String(rien.content), /Aucun passage/)
    assert.deepEqual(motsCherches('Le budget, et l’hébergement'), ['budget', 'hebergement'])
    const ps = [{ debutS: 0, texte: 'budget' }, { debutS: 120, texte: 'rien' }, { debutS: 240, texte: 'budget et hébergement' }]
    assert.deepEqual(passagesTrouves(ps, 'budget hébergement').map((p) => p.debutS), [0, 240])
    assert.deepEqual(parties([{ debutS: 0, texte: 'a'.repeat(40) }, { debutS: 1, texte: 'b'.repeat(40) }, { debutS: 2, texte: 'c'.repeat(10) }], 50).map((p) => p.length), [1, 2])
  })

  test('lister ; supprimer après le « oui » seulement ; chacun les siennes', async () => {
    const liste = await reunionsLister.run({}, ctx(uid).c)
    assert.match(String(liste.content), /Point landing page .* transcrite \| rangée/)
    assert.equal((await reunionLire.run({ reunion: id }, ctx(U9399).c)).isError, true)
    const { c, attente } = ctx(uid)
    await reunionSupprimer.run({ reunion: id }, c)
    assert.equal(listerReunions(uid).length, 1)
    await attente[0]!()
    assert.equal(listerReunions(uid).length, 0)
    assert.deepEqual(transcription(id), [])
  })
})

describe('réunions : l’envoi des morceaux', () => {
  test('POST /reunions/<numéro>/segments : jeton, rang, WAV ; le morceau est transcrit aussitôt', async (t) => {
    const uid = personne('Envoi')
    const server = createHttpServer().listen(0, '127.0.0.1')
    t.after(() => server.close())
    await new Promise((ok) => server.once('listening', ok))
    const { token } = issueDevice(uid, 'mobile', 'Téléphone')
    fileReunions.configurer({ cles: () => ({ GROQ_API_KEY: 'g' }), transcrire: async () => 'Bonjour à tous.', attentes: [0] })
    const r = creerReunion(uid, { titre: 'Par le réseau', source: 'micro' }, Date.now())
    const url = (id: number) => `http://127.0.0.1:${(server.address() as AddressInfo).port}/reunions/${id}/segments`
    const post = (id: number, headers: Record<string, string>, body: Buffer) => fetch(url(id), { method: 'POST', headers: { 'Content-Type': 'audio/wav', ...headers }, body: new Uint8Array(body) })
    assert.equal((await fetch(url(r.id), { method: 'OPTIONS' })).status, 204)
    assert.equal((await post(r.id, { 'X-Rang': '0', 'X-Debut': '0' }, morceau(3))).status, 401)
    const auth = { Authorization: `Bearer ${token}` }
    assert.equal((await post(r.id, { ...auth, 'X-Rang': 'x', 'X-Debut': '0' }, morceau(3))).status, 400)
    assert.equal((await post(r.id, { ...auth, 'X-Rang': '0', 'X-Debut': '0' }, Buffer.from('pas du wav, mais assez long pour ne pas être vide'))).status, 400)
    assert.equal((await post(999_999, { ...auth, 'X-Rang': '0', 'X-Debut': '0' }, morceau(3))).status, 404)
    const ok = await post(r.id, { ...auth, 'X-Rang': '0', 'X-Debut': '0' }, morceau(3))
    assert.equal(ok.status, 201)
    await fileReunions.attendre(r.id)
    assert.deepEqual(transcription(r.id), [{ debutS: 0, texte: 'Bonjour à tous.' }])
    terminerReunion(uid, r.id)
    fileReunions.planifier(r.id)
    await fileReunions.attendre(r.id)
    assert.equal(getReunion(uid, r.id)!.etat, 'prete')
    // Terminée : plus aucun morceau n'est accepté.
    assert.equal((await post(r.id, { ...auth, 'X-Rang': '1', 'X-Debut': '3' }, morceau(3))).status, 400)
  })
})
