import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { UiAgendaEvent, UiMailRow, UiRappel } from '@code/protocol'
import { PANNEAUX_RETOUR, absenceText, panneauxRetour, retourLines, retourPrompt, type RetourFacts } from './retour.ts'

const rappel = (id: number, texte: string, heure: string, etat: UiRappel['etat'], jour = 'aujourd’hui'): UiRappel => ({ id, texte, echeance: 0, heure, jour, etat })
const mail = (de: string, objet: string, nonLu: boolean): UiMailRow => ({ id: de, de, deEmail: '', initiales: '', objet, extrait: '', quand: '14:10', nonLu, important: true, messages: 1, pieces: 0 })
const evt = (titre: string, debut: string, de: number, a: number): UiAgendaEvent => ({ id: titre, titre, debut, fin: '', de, a, journee: false, visio: false, participants: 0, etat: 'a_venir' })

const base: RetourFacts = { depuis: '13:05', absence: '2 h 10', rappels: [], taches: [], enAttente: null, perso: { at: 0, agenda: [], mails: [] }, maintenant: 15 * 60 + 15 }

test('durée d’absence dite simplement', () => {
  assert.equal(absenceText(45 * 60_000), '45 min')
  assert.equal(absenceText(60 * 60_000), '1 h')
  assert.equal(absenceText(130 * 60_000), '2 h 10')
  assert.equal(absenceText(3 * 24 * 3600_000), '3 jours')
})

test('point du retour : ce qui demande une action, les mails, le prochain rendez-vous', () => {
  const lines = retourLines({
    ...base,
    rappels: [rappel(1, 'Appeler Bernard', '14:00', 'sonne'), rappel(2, 'Payer le fournisseur', '17:00', 'a_venir'), rappel(3, 'Réunion', '09:00', 'a_venir', 'demain')],
    taches: [{ execution: { id: 1, tacheId: 4, debut: 0, fin: 1, statut: 'ok', retard: false, resume: 'deux idées prêtes', texte: '' }, tache: { id: 4, titre: 'Idées TikTok', consigne: '', echeance: null, recurrence: null, etat: 'active' } }],
    enAttente: { actionId: 'a', title: 'Envoyer le mail', summary: 'à Bernard', expiresAt: 0 },
    perso: { at: 0, mails: [mail('Léa Durand', 'Dîner samedi ?', true), mail('Banque', 'Relevé', false)], agenda: [evt('Déjeuner', '12:30', 750, 840), evt('Point Atlas', '16:00', 960, 1020)] }
  })
  const text = lines.join('\n')
  assert.match(text, /attendent « fait » : Appeler Bernard \(14:00\)/)
  assert.match(text, /Prochains rappels aujourd’hui : 17:00 Payer le fournisseur\./, 'pas ceux de demain')
  assert.match(text, /« Idées TikTok » terminée : deux idées prêtes/)
  assert.match(text, /En attente de son accord : Envoyer le mail/)
  assert.match(text, /non lus : Léa Durand — « Dîner samedi \? »/)
  assert.doesNotMatch(text, /Banque/, 'seulement les non lus')
  assert.match(text, /restants aujourd’hui : 16:00 Point Atlas\./, 'le déjeuner est passé')
})

test('rien ne s’est passé, Google déconnecté', () => {
  const text = retourLines({ ...base, perso: null }).join('\n')
  assert.match(text, /Aucun rappel en attente/)
  assert.match(text, /Aucune tâche planifiée/)
  assert.match(text, /non disponibles \(Google non connecté\)/)
})

test('la consigne : pas d’outil, et la question à la fin', () => {
  const p = retourPrompt(base, 'Martin')
  assert.match(p, /^\[Retour de Martin après 2 h 10 d’absence \(depuis 13:05\)/)
  assert.match(p, /N’appelle aucun outil/)
  assert.match(p, /s’il veut le détail de quelque chose\.$/)
})

test('point du retour : des panneaux seulement pour ce qui a quelque chose à montrer, annoncés par leur marque', () => {
  assert.deepEqual(panneauxRetour(base), [])
  const faits: RetourFacts = {
    ...base,
    rappels: [rappel(1, 'Appeler Bernard', '14:00', 'sonne'), rappel(3, 'Réunion', '09:00', 'a_venir', 'demain')],
    perso: { at: 0, mails: [mail('Léa Durand', 'Dîner samedi ?', true)], agenda: [evt('Déjeuner', '12:30', 750, 840)] }
  }
  // Le déjeuner est passé (15 h 15) : pas de panneau d'agenda ; un rappel de demain seul n'en aurait pas donné.
  assert.deepEqual(panneauxRetour(faits), ['rappels', 'mails'])
  assert.deepEqual(panneauxRetour({ ...base, rappels: [rappel(3, 'Réunion', '09:00', 'a_venir', 'demain')] }), [])
  const sans = retourPrompt(faits, 'Léa')
  assert.doesNotMatch(sans, /\[\[voir/)
  const avec = retourPrompt(faits, 'Léa', [{ marque: PANNEAUX_RETOUR.rappels, sujet: 'les rappels' }, { marque: PANNEAUX_RETOUR.mails, sujet: 'les mails' }])
  assert.match(avec, /les rappels → \[\[voir:rappels_lister\]\] ; les mails → \[\[voir:mails\]\]/)
  assert.match(avec, /N’appelle aucun outil/)
})
