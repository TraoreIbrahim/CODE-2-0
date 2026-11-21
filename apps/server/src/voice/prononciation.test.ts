import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enLettres, pourLaVoix } from './prononciation.ts'

test('nombres en lettres, avec les accords du français', () => {
  const cas: [number, string][] = [
    [0, 'zéro'], [1, 'un'], [17, 'dix-sept'], [21, 'vingt et un'], [71, 'soixante et onze'], [72, 'soixante-douze'],
    [80, 'quatre-vingts'], [81, 'quatre-vingt-un'], [91, 'quatre-vingt-onze'], [99, 'quatre-vingt-dix-neuf'],
    [100, 'cent'], [200, 'deux cents'], [201, 'deux cent un'], [1000, 'mille'], [1019, 'mille dix-neuf'],
    [2026, 'deux mille vingt-six'], [80000, 'quatre-vingt mille'], [200000, 'deux cent mille'],
    [41000000, 'quarante et un millions'], [1500000, 'un million cinq cent mille'], [2000000000, 'deux milliards']
  ]
  for (const [n, attendu] of cas) assert.equal(enLettres(n), attendu, String(n))
})

test('codes de dossier : lettres épelées, année dite, numéro chiffre par chiffre', () => {
  assert.equal(pourLaVoix('Dossier REF-2026-0003 enregistré.'), 'Dossier èr eu èf, deux mille vingt-six, zéro zéro zéro trois enregistré.')
  assert.equal(pourLaVoix('Commande CMD-WEB-2026-0012.'), 'Commande cé èm dé, double vé eu bé, deux mille vingt-six, zéro zéro un deux.')
  assert.equal(pourLaVoix('Le lot LOT-005'), 'Le lot èl o té, zéro zéro cinq')
})

test('téléphones : par paires, indicatif international compris', () => {
  assert.equal(pourLaVoix('au 06 12 34 56 78'), 'au zéro six, douze, trente-quatre, cinquante-six, soixante-dix-huit')
  assert.equal(pourLaVoix('au 0612345678'), 'au zéro six, douze, trente-quatre, cinquante-six, soixante-dix-huit')
  assert.equal(pourLaVoix('+33 6 12 34 56 78'), 'plus trente-trois, six, douze, trente-quatre, cinquante-six, soixante-dix-huit')
  assert.equal(pourLaVoix('+1 415.555.0123'), 'plus un, quatre un cinq, cinq cinq cinq, zéro un, vingt-trois')
  assert.equal(pourLaVoix('+33612345678'), 'plus trois trois six un deux trois quatre cinq six sept huit')
})

test('heures, dates, montants, pourcentages', () => {
  assert.equal(pourLaVoix('à 14:32'), 'à quatorze heures trente-deux')
  assert.equal(pourLaVoix('vers 9 h 05'), 'vers neuf heures cinq')
  assert.equal(pourLaVoix('à 21h'), 'à vingt et une heures')
  assert.equal(pourLaVoix('à 1h01'), 'à une heure une')
  assert.equal(pourLaVoix('le 05/11/2026'), 'le cinq novembre deux mille vingt-six')
  assert.equal(pourLaVoix('le 1/12'), 'le premier décembre')
  assert.equal(pourLaVoix('le 2026-10-31'), 'le trente et un octobre deux mille vingt-six')
  assert.equal(pourLaVoix('50 000 FCFA'), 'cinquante mille francs CFA')
  assert.equal(pourLaVoix('1 200 €'), 'mille deux cents euros')
  assert.equal(pourLaVoix('1 019 personnes'), 'mille dix-neuf personnes')
  assert.equal(pourLaVoix('12 %'), 'douze pour cent')
  assert.equal(pourLaVoix('3,5 jours'), 'trois virgule cinq jours')
  assert.equal(pourLaVoix('le 1er novembre'), 'le premier novembre')
})

test('un texte sans chiffre ne change pas', () => {
  const t = 'Bonjour Madame Martin, tout va bien à la maison.'
  assert.equal(pourLaVoix(t), t)
})
