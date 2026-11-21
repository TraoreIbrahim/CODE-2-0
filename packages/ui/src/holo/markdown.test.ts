import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inline, parseMarkdown } from './markdown.ts'

test('Markdown : titres, paragraphes, séparateur, bloc de code', () => {
  const b = parseMarkdown('# Atelier Nova\n\nLe **backend** et\nle `front`.\n\n---\n\n```ts\nconst a = 1\n\n// fin\n```\n')
  assert.deepEqual(b, [
    { t: 'h', level: 1, c: [{ t: 'text', v: 'Atelier Nova' }] },
    { t: 'p', c: [{ t: 'text', v: 'Le ' }, { t: 'strong', c: [{ t: 'text', v: 'backend' }] }, { t: 'text', v: ' et le ' }, { t: 'code', v: 'front' }, { t: 'text', v: '.' }] },
    { t: 'hr' },
    { t: 'code', lang: 'ts', v: 'const a = 1\n\n// fin' }
  ])
})

test('Markdown : listes imbriquées, numérotées, à cocher', () => {
  const [list, ordered] = parseMarkdown('- un\n  - un.a\n  - un.b\n- [x] deux\n- [ ] trois\n\n3. trois\n4. quatre\n')
  assert.deepEqual(list, {
    t: 'list',
    ordered: false,
    start: 1,
    items: [
      { c: [{ t: 'text', v: 'un' }], sub: { t: 'list', ordered: false, start: 1, items: [{ c: [{ t: 'text', v: 'un.a' }] }, { c: [{ t: 'text', v: 'un.b' }] }] } },
      { c: [{ t: 'text', v: 'deux' }], checked: true },
      { c: [{ t: 'text', v: 'trois' }], checked: false }
    ]
  })
  assert.equal(ordered!.t === 'list' && ordered!.start, 3)
})

test('Markdown : tableau avec alignements, citation', () => {
  const [table, quote] = parseMarkdown('| Salle | Places |\n|:-----|------:|\n| Belleville | 6 |\n| Centre \\| Tour A | 4 |\n\n> À vérifier\n> demain')
  assert.deepEqual(table, {
    t: 'table',
    head: [[{ t: 'text', v: 'Salle' }], [{ t: 'text', v: 'Places' }]],
    align: ['left', 'right'],
    rows: [
      [[{ t: 'text', v: 'Belleville' }], [{ t: 'text', v: '6' }]],
      [[{ t: 'text', v: 'Centre | Tour A' }], [{ t: 'text', v: '4' }]]
    ]
  })
  assert.deepEqual(quote, { t: 'quote', c: [{ t: 'p', c: [{ t: 'text', v: 'À vérifier demain' }] }] })
})

test('Markdown en ligne : liens, images, italique, barré, échappements', () => {
  assert.deepEqual(inline('voir [la doc](https://x.example) et ![logo](a.png), *vite* ~~non~~ \\*pas\\*'), [
    { t: 'text', v: 'voir ' },
    { t: 'link', c: [{ t: 'text', v: 'la doc' }], href: 'https://x.example' },
    { t: 'text', v: ' et ' },
    { t: 'image', alt: 'logo', src: 'a.png' },
    { t: 'text', v: ', ' },
    { t: 'em', c: [{ t: 'text', v: 'vite' }] },
    { t: 'text', v: ' ' },
    { t: 'del', c: [{ t: 'text', v: 'non' }] },
    { t: 'text', v: ' *pas*' }
  ])
  // Un nom de fichier avec des tirets bas n'est pas de l'italique.
  assert.deepEqual(inline('mcp_keys_table'), [{ t: 'text', v: 'mcp_keys_table' }])
})
