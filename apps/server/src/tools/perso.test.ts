import assert from 'node:assert/strict'
import { test } from 'node:test'
const { persoPageable } = await import('./perso.ts')

test('interface : elle ouvre les listes en lecture (cartes du cockpit, « Tout voir »), jamais une action', () => {
  for (const nom of ['rappels_lister', 'taches_lister', 'echeances_lister', 'meteo', 'document_lire', 'documents_retrouver']) assert.ok(persoPageable(nom), nom)
  for (const nom of ['echeance_regler', 'rappel_creer', 'gmail_envoyer', 'document_ranger']) assert.equal(persoPageable(nom), null, nom)
})
