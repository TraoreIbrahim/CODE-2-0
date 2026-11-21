import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { UiAgendaEvent, UiMailRow, UiRappel } from '@code/protocol'
import { briefingMessage, reminderMessage } from './messages.ts'

const ev = (titre: string, debut: string, etat: UiAgendaEvent['etat']): UiAgendaEvent => ({ id: titre, titre, debut, fin: '', de: 0, a: 0, journee: false, visio: false, participants: 0, etat })
const mail = (objet: string, nonLu: boolean): UiMailRow => ({ id: objet, de: 'M. Bernard', deEmail: 'bernard@example.com', initiales: 'MB', objet, extrait: '', quand: '08:10', nonLu, important: true, messages: 1, pieces: 0 })
const rappel = (id: number, texte: string, extra: Partial<UiRappel> = {}): UiRappel => ({ id, texte, echeance: 0, heure: '10:00', jour: 'aujourd’hui', etat: 'a_venir', ...extra })

test('rappel : texte en corps, un tag par rappel, « en retard » au titre', () => {
  assert.deepEqual(reminderMessage(rappel(7, 'Appeler le fournisseur')), { titre: 'Rappel', corps: 'Appeler le fournisseur', tag: 'rappel-7', url: '/' })
  assert.equal(reminderMessage(rappel(7, 'x', { retard: true })).titre, 'Rappel · en retard')
})

test('briefing écrit : prochain rendez-vous, mails non lus, rappels du jour', () => {
  const m = briefingMessage(
    { at: 0, agenda: [ev('Point équipe technique', '08:30', 'passe'), ev('Déjeuner avec M. Bernard', '12:30', 'a_venir'), ev('Visio fournisseur', '16:00', 'a_venir')], mails: [mail('Devis', true), mail('Contrat', false)] },
    [rappel(1, 'Envoyer le devis'), rappel(2, 'Point hebdo', { jour: 'demain' })],
    'Martin'
  )
  assert.equal(m.titre, 'Bonjour Martin')
  assert.equal(m.tag, 'briefing')
  assert.equal(m.corps, '3 rendez-vous · 12:30 Déjeuner avec M. Bernard\n2 mails importants, 1 non lu\n1 rappel aujourd’hui · 10:00 Envoyer le devis')
})

test('briefing écrit : journée vide, ou Google déconnecté', () => {
  assert.equal(briefingMessage({ at: 0, agenda: [], mails: [] }, [], 'Martin').corps, 'Aucun rendez-vous aujourd’hui.\nAucun mail important.')
  assert.equal(briefingMessage({ at: 0, agenda: null, mails: null, erreur: 'Accès Google expiré : reconnectez Google depuis le cockpit.' }, [], 'Martin').corps, 'Accès Google expiré : reconnectez Google depuis le cockpit.')
  assert.equal(briefingMessage(null, [], 'Martin').corps, 'Rien de prévu aujourd’hui.')
})
