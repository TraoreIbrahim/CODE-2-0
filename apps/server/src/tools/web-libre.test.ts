import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adressePrivee, htmlEnTexte, lirePage, webLire } from './web-libre.ts'

test('adresses privées : réseau local, machine et IPv6 locale refusés ; le reste passe', () => {
  for (const ip of ['127.0.0.1', '10.2.3.4', '192.168.1.20', '172.20.0.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.0.1']) assert.ok(adressePrivee(ip), ip)
  // Adresses publiques réservées à la documentation (RFC 5737, RFC 3849).
  for (const ip of ['203.0.113.7', '198.51.100.4', '2001:db8::1']) assert.ok(!adressePrivee(ip), ip)
})

test('lecture : jamais vers la machine ou le réseau local, même par redirection', async () => {
  const jamais = (async () => {
    throw new Error('ne doit pas être appelé')
  }) as unknown as typeof fetch
  await assert.rejects(lirePage('http://127.0.0.1:8787/secrets', jamais), /réseau privé/)
  await assert.rejects(lirePage('http://[::1]/', jamais), /réseau privé/)
  const redirige = (async () => new Response(null, { status: 302, headers: { location: 'http://192.168.1.1/admin' } })) as unknown as typeof fetch
  await assert.rejects(lirePage('http://203.0.113.7/', redirige), /réseau privé/)
  assert.ok(webLire.validate({ url: 'file:///etc/passwd' }, {} as never))
})

test('HTML en texte : titre, paragraphes et listes ; sans scripts, styles ni menus', () => {
  const t = htmlEnTexte('<html><head><title>Horaires &amp; tarifs</title><style>p{}</style></head><body><nav>Menu</nav><h1>Piscine</h1><p>Ouverte de 9&nbsp;h à 20&nbsp;h.</p><ul><li>Adulte : 4 €</li><li>Enfant : 2 €</li></ul><script>alert(1)</script></body></html>')
  assert.equal(t, '# Horaires & tarifs\nPiscine\nOuverte de 9 h à 20 h.\n• Adulte : 4 €\n• Enfant : 2 €')
})
