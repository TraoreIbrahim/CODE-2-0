import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SentenceChunker, clean } from './chunker.ts'

function feed(text: string, step = 3): string[] {
  const c = new SentenceChunker()
  const out: string[] = []
  for (let i = 0; i < text.length; i += step) out.push(...c.push(text.slice(i, i + step)))
  return [...out, ...c.flush()]
}

test('coupe aux fins de phrase', () => {
  assert.deepEqual(feed('Bonsoir. Vous avez trois mails importants ! Je les lis ?'), [
    'Bonsoir.',
    'Vous avez trois mails importants !',
    'Je les lis ?'
  ])
})

test('ne coupe pas après « M. »', () => {
  assert.deepEqual(feed('J’ai écrit à M. Bernard ce matin. C’est fait.'), [
    'J’ai écrit à M. Bernard ce matin.',
    'C’est fait.'
  ])
})

test('coupe tôt la première proposition sur une virgule', () => {
  const out = feed('Le point équipe dev est à neuf heures au bureau, puis la revue du poste de commandement en visio à seize heures.')
  assert.equal(out[0], 'Le point équipe dev est à neuf heures au bureau,')
  assert.equal(out.length, 2)
})

test('retire le markdown', () => {
  assert.equal(clean('**Important** : `code` et # titre'), 'Important : code et titre')
})
