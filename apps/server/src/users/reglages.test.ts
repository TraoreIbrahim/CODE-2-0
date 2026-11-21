import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NOM_ASSISTANT_DEFAUT, cartesDuProfil, memesCartes, type Reglages } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import { inSilence, parseHhmm, silenceNow } from '../scheduler/rules.ts'
import { validateReglages, voixIds } from './reglages.ts'

const DEFAUTS = { ...codeConfig.reglages } as Reglages
const ok = (raw: unknown, current = DEFAUTS) => {
  const r = validateReglages(raw, current)
  assert.ok('ok' in r, `refusé : ${JSON.stringify('erreurs' in r ? r.erreurs : null)}`)
  return r.ok
}
const ko = (raw: unknown, current = DEFAUTS) => {
  const r = validateReglages(raw, current)
  assert.ok('erreurs' in r, `accepté : ${JSON.stringify(raw)}`)
  return r.erreurs
}

test('appellation : nettoyée, lettres et ponctuation des noms seulement', () => {
  assert.deepEqual(ok({ appellation: '  Monsieur   Martin ' }), { appellation: 'Monsieur Martin' })
  assert.deepEqual(ok({ appellation: 'M. D’Artois-Lemaire' }), { appellation: 'M. D’Artois-Lemaire' })
  assert.deepEqual(ok({ appellation: '' }), { appellation: '' }, 'vide : retour au nom de famille')
  assert.ok(ko({ appellation: '<script>' }).appellation)
  assert.ok(ko({ appellation: 'a'.repeat(41) }).appellation)
  assert.ok(ko({ appellation: 42 }).appellation)
})

test('nom de l’assistant et profil', () => {
  assert.deepEqual(ok({ nomAssistant: '  Jean   Paul ' }), { nomAssistant: 'Jean Paul' })
  assert.deepEqual(ok({ nomAssistant: 'Aya' }), { nomAssistant: 'Aya' })
  assert.ok(ko({ nomAssistant: '' }).nomAssistant, 'il faut un nom pour l’appeler')
  assert.ok(ko({ nomAssistant: 'a'.repeat(25) }).nomAssistant)
  assert.ok(ko({ nomAssistant: 'R2-D2' }).nomAssistant, 'des chiffres ne se prononcent pas comme un nom')
  assert.deepEqual(ok({ profil: 'developpeur' }), { profil: 'developpeur', widgets: cartesDuProfil('developpeur') })
  assert.ok(ko({ profil: 'astronaute' }).profil)
})

test('profil : ses cartes, sauf celles que la personne a rangées elle-même', () => {
  assert.ok(memesCartes(codeConfig.reglages.widgets, cartesDuProfil('general')), 'les cartes par défaut sont celles de l’usage général')
  if (!process.env.CODE_NOM_ASSISTANT) assert.equal(codeConfig.reglages.nomAssistant, NOM_ASSISTANT_DEFAUT, 'le même nom par défaut que les écrans')
  const foyer = ok({ profil: 'foyer' }).widgets!
  assert.deepEqual(foyer.filter((w) => w.visible).map((w) => w.id), ['meteo', 'aujourdhui', 'rappels', 'echeances'])
  // Retour à l'usage général depuis les cartes du foyer, intactes : celles de l'usage général.
  assert.deepEqual(ok({ profil: 'general' }, { ...DEFAUTS, profil: 'foyer', widgets: foyer }).widgets, cartesDuProfil('general'))
  // Cartes rangées à sa façon : elles restent.
  const rangees = [...cartesDuProfil('general')].reverse()
  assert.deepEqual(ok({ profil: 'foyer' }, { ...DEFAUTS, widgets: rangees }), { profil: 'foyer' })
  // Même profil, ou cartes envoyées avec : rien d'imposé.
  assert.deepEqual(ok({ profil: 'general' }), { profil: 'general' })
  assert.deepEqual(ok({ profil: 'foyer', widgets: rangees }).widgets, rangees)
})

test('écran simplifié : oui ou non', () => {
  assert.deepEqual(ok({ ecranSimple: true }), { ecranSimple: true })
  assert.ok(ko({ ecranSimple: 'oui' }).ecranSimple)
})

test('registre, notifications : des booléens, rien d’autre', () => {
  assert.deepEqual(ok({ tutoiement: true, notifications: false }), { tutoiement: true, notifications: false })
  const e = ko({ tutoiement: 'oui', notifications: 1 })
  assert.ok(e.tutoiement && e.notifications)
})

test('thème et voix : seulement ceux proposés', () => {
  assert.deepEqual(ok({ theme: 'violet' }), { theme: 'violet' })
  assert.deepEqual(ok({ theme: 'glacier' }), { theme: 'glacier' })
  assert.ok(ko({ theme: 'rose' }).theme)
  assert.deepEqual(ok({ theme: 'aube' }), { theme: 'aube' })
  assert.deepEqual(ok({ orbe: 'robot' }), { orbe: 'robot' })
  assert.deepEqual(ok({ orbe: 'plasma' }), { orbe: 'plasma' })
  assert.ok(ko({ orbe: 'cube' }).orbe)
  assert.ok(ko({ orbe: 3 }).orbe)
  assert.ok(voixIds().length >= 3, 'au moins trois voix à écouter')
  assert.deepEqual(ok({ voix: voixIds()[2] }), { voix: voixIds()[2] })
  assert.ok(ko({ voix: 'voix-inventée' }).voix)
})

test('voix de son compte ElevenLabs : permise pour lui seul ; rendu rapide ou naturel', () => {
  const sienne = 'AbCdEfGhIjKlMnOpQrSt'
  assert.ok('erreurs' in validateReglages({ voix: sienne }, DEFAUTS), 'pas dans son compte : refusée')
  assert.deepEqual(validateReglages({ voix: sienne }, DEFAUTS, [sienne]), { ok: { voix: sienne } })
  assert.equal(DEFAUTS.qualiteVoix, 'rapide')
  assert.deepEqual(ok({ qualiteVoix: 'naturelle' }), { qualiteVoix: 'naturelle' })
  assert.ok(ko({ qualiteVoix: 'studio' }).qualiteVoix)
})

test('vitesse de la voix : bornée, arrondie au pas', () => {
  assert.deepEqual(ok({ vitesseVoix: 1.13 }), { vitesseVoix: 1.15 })
  assert.deepEqual(ok({ vitesseVoix: 0.8 }), { vitesseVoix: 0.8 })
  assert.ok(ko({ vitesseVoix: 1.5 }).vitesseVoix)
  assert.ok(ko({ vitesseVoix: Number.NaN }).vitesseVoix)
  assert.ok(ko({ vitesseVoix: '1' }).vitesseVoix)
})

test('habitudes : heure du briefing, point du retour, heures de silence', () => {
  assert.deepEqual(ok({ briefing: '7h05' }), { briefing: '07:05' })
  assert.ok(ko({ briefing: '25:00' }).briefing)
  assert.ok(ko({ briefing: 'demain' }).briefing)
  assert.deepEqual(ok({ retourApresMinutes: 90 }), { retourApresMinutes: 90 })
  assert.ok(ko({ retourApresMinutes: 5 }).retourApresMinutes, 'trop court : CODE ferait le point sans arrêt')
  assert.ok(ko({ retourApresMinutes: 60.5 }).retourApresMinutes)
  assert.deepEqual(ok({ silence: { de: '22:00', a: '6:30' } }), { silence: { de: '22:00', a: '06:30' } })
  assert.deepEqual(ok({ silence: null }), { silence: null })
  assert.ok(ko({ silence: { de: '22:00', a: '22:00' } }).silence)
  assert.ok(ko({ silence: { de: '22:00' } }).silence)
})

test('le briefing ne peut pas tomber pendant les heures de silence', () => {
  assert.ok(ko({ silence: { de: '22:00', a: '08:00' } }).silence, 'briefing par défaut à 07:30 : refusé')
  assert.ok(ko({ briefing: '23:00' }, { ...DEFAUTS, silence: { de: '22:00', a: '06:00' } }).briefing)
  assert.deepEqual(ok({ briefing: '06:00' }, { ...DEFAUTS, silence: { de: '22:00', a: '06:00' } }), { briefing: '06:00' }, 'la fin du silence est permise')
  assert.deepEqual(ok({ silence: { de: '22:00', a: '08:00' }, briefing: '08:30' }), { silence: { de: '22:00', a: '08:00' }, briefing: '08:30' }, 'les deux changés ensemble')
})

test('ville et fuseau : un vrai fuseau horaire', () => {
  assert.deepEqual(ok({ ville: 'Bordeaux', fuseau: 'Europe/Paris' }), { ville: 'Bordeaux', fuseau: 'Europe/Paris' })
  assert.ok(ko({ fuseau: 'Lune/Base' }).fuseau)
  assert.ok(ko({ fuseau: 'UTC' }).fuseau, 'un fuseau de ville, pas un décalage')
  assert.ok(ko({ ville: '' }).ville)
})

test('une seule erreur refuse tout ; un champ inconnu aussi', () => {
  const e = ko({ theme: 'violet', briefing: '99:99' })
  assert.ok(e.briefing && !e.theme)
  assert.ok(Object.values(ko({ couleur: 'violet' })).join().includes('couleur'))
  assert.ok(Object.keys(ko(null)).length)
  assert.ok(Object.keys(ko(['theme'])).length)
})

test('heures de silence : plage dans la journée ou à cheval sur minuit', () => {
  const nuit = { de: '22:00', a: '06:30' }
  assert.equal(parseHhmm('6:30'), 390)
  assert.equal(parseHhmm('24:00'), null)
  assert.equal(inSilence(23 * 60, nuit), true)
  assert.equal(inSilence(2 * 60, nuit), true)
  assert.equal(inSilence(390, nuit), false, 'la fin n’est pas comprise')
  assert.equal(inSilence(22 * 60, nuit), true, 'le début l’est')
  assert.equal(inSilence(12 * 60, nuit), false)
  assert.equal(inSilence(13 * 60, { de: '12:30', a: '14:00' }), true)
  assert.equal(inSilence(15 * 60, { de: '12:30', a: '14:00' }), false)
  assert.equal(inSilence(13 * 60, null), false)
  // Dans le fuseau de la personne : 23:30 en UTC, 00:30 à Paris (heure d'hiver).
  const t = Date.parse('2026-11-02T23:30:00Z')
  assert.equal(silenceNow(t, 'UTC', { de: '00:00', a: '06:00' }), false)
  assert.equal(silenceNow(t, 'Europe/Paris', { de: '00:00', a: '06:00' }), true)
})

test('cartes du cockpit : ordre et côté gardés, cartes manquantes ajoutées à leur place, doublons et inconnues refusés', () => {
  const w = ok({
    widgets: [
      { id: 'mails', colonne: 'gauche', visible: true },
      { id: 'meteo', colonne: 'droite', visible: false }
    ]
  }).widgets!
  assert.deepEqual(
    w.map((x) => `${x.id}:${x.colonne}:${x.visible}`),
    ['mails:gauche:true', 'meteo:droite:false', 'aujourdhui:gauche:true', 'rappels:gauche:true', 'taches:droite:true', 'echeances:droite:false']
  )
  assert.match(ko({ widgets: [{ id: 'meteo', colonne: 'gauche', visible: true }, { id: 'meteo', colonne: 'droite', visible: true }] }).widgets!, /invalide/)
  assert.match(ko({ widgets: [{ id: 'bourse', colonne: 'gauche', visible: true }] }).widgets!, /invalide/)
  assert.match(ko({ widgets: [{ id: 'meteo', colonne: 'haut', visible: true }] }).widgets!, /invalide/)
  assert.match(ko({ widgets: 'meteo' }).widgets!, /invalide/)
})

test('moteurs : un usage changé à la fois, les autres gardés ; fournisseur et modèle vérifiés', () => {
  const r = ok({ moteurs: { rapide: { fournisseur: 'mistral', modele: ' mistral-small-latest ' } } })
  assert.deepEqual(r.moteurs, { ...DEFAUTS.moteurs, rapide: { fournisseur: 'mistral', modele: 'mistral-small-latest' } })
  assert.equal(ok({ moteurs: { principal: { fournisseur: 'openrouter', modele: 'anthropic/claude-opus-5.5' } } }).moteurs?.principal.modele, 'anthropic/claude-opus-5.5')
  assert.ok(ko({ moteurs: { principal: { fournisseur: 'inconnu', modele: 'x' } } }).moteurs)
  assert.ok(ko({ moteurs: { principal: { fournisseur: 'openai', modele: 'gpt 5; rm' } } }).moteurs)
  assert.ok(ko({ moteurs: { cuisine: { fournisseur: 'openai', modele: 'gpt-5.5' } } }).moteurs)
  assert.ok(ko({ moteurs: [] }).moteurs)
})

test('voix : services de transcription et de synthèse connus, ou automatique', () => {
  assert.deepEqual(ok({ transcription: 'mistral', synthese: 'deepgram' }), { transcription: 'mistral', synthese: 'deepgram' })
  assert.deepEqual(ok({ transcription: 'auto', synthese: 'auto' }), { transcription: 'auto', synthese: 'auto' })
  assert.ok(ko({ transcription: 'whisper' }).transcription)
  // Groq ne parle pas français : pas de synthèse chez lui.
  assert.ok(ko({ synthese: 'groq' }).synthese)
})
