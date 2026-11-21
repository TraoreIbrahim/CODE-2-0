import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contactDe, contactsPourClaude, fusionner } from './contacts.ts'

test('un contact du carnet : nom, poste, adresses sans doublon, anniversaire en clair', () => {
  const c = contactDe({
    names: [{ displayName: 'Claire Bernard' }],
    emailAddresses: [{ value: 'Claire@Exemple.fr' }, { value: 'claire@exemple.fr' }],
    phoneNumbers: [{ value: '06 12 34 56 78', formattedType: 'Mobile' }],
    organizations: [{ name: 'Atelier Nova', title: 'Comptable' }],
    addresses: [{ formattedValue: '3 rue des Lilas\n69003 Lyon' }],
    birthdays: [{ date: { day: 12, month: 3 } }]
  })!
  assert.equal(c.initiales, 'CB')
  assert.deepEqual(c.emails, ['claire@exemple.fr'])
  assert.equal(c.adresse, '3 rue des Lilas, 69003 Lyon')
  assert.equal(c.anniversaire, '12 mars')
  assert.match(contactsPourClaude([c]), /Claire Bernard · Comptable · Atelier Nova · claire@exemple.fr · tél. 06 12 34 56 78 \(Mobile\)/)
})

test('sans nom, l’adresse sert de nom ; rien du tout : pas de contact', () => {
  assert.equal(contactDe({ emailAddresses: [{ value: 'devis@plombier.fr' }] }, true)!.nom, 'devis@plombier.fr')
  assert.equal(contactDe({ names: [{ displayName: ' ' }] }), null)
})

test('les échanges complètent le carnet sans répéter une même adresse', () => {
  const carnet = [contactDe({ names: [{ displayName: 'Claire Bernard' }], emailAddresses: [{ value: 'claire@exemple.fr' }] })!]
  const echanges = [contactDe({ emailAddresses: [{ value: 'claire@exemple.fr' }] }, true)!, contactDe({ names: [{ displayName: 'M. Martin' }], emailAddresses: [{ value: 'martin@exemple.fr' }] }, true)!]
  assert.deepEqual(fusionner(carnet, echanges).map((c) => c.nom), ['Claire Bernard', 'M. Martin'])
})
