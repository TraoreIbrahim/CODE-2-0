import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nomJpeg, typeDocument } from './document-envoi.ts'

test('papier à envoyer : son type, même sans celui du système ; le nom de la photo réencodée', () => {
  assert.equal(typeDocument({ name: 'avis.PDF', type: '' }), 'application/pdf')
  assert.equal(typeDocument({ name: 'IMG_1.HEIC', type: 'image/heic' }), 'image/heic')
  assert.equal(typeDocument({ name: 'note.txt', type: '' }), '')
  assert.equal(nomJpeg('IMG_2231.HEIC'), 'IMG_2231.jpg')
  assert.equal(nomJpeg('scan.final.png'), 'scan.final.jpg')
  assert.equal(nomJpeg('.jpeg'), 'photo.jpg')
})
