import assert from 'node:assert/strict'
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto'
import { test } from 'node:test'
import { allowedEndpoint, encryptPayload, generateVapidKeys, pushTopic, vapidAuthorization, vapidPublicKey } from './webpush.ts'

const unb64 = (s: string) => Buffer.from(s, 'base64url')

test('chiffrement : vecteur de test de la RFC 8291 (annexe A)', () => {
  const body = encryptPayload(
    { endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV', keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } }, // gitleaks:allow — clé publiée dans la RFC 8291, annexe A
    Buffer.from('When I grow up, I want to be a watermelon'),
    { salt: unb64('DGv6ra1nlYgDCS1FRnbzlw'), serverPrivate: unb64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw') }
  )
  assert.equal(
    body.toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
  )
})

test('chiffrement : le téléphone retrouve le contenu', () => {
  const ua = createECDH('prime256v1')
  ua.generateKeys()
  const auth = randomBytes(16)
  const body = encryptPayload({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } }, Buffer.from('{"titre":"Rappel"}'))
  // Déchiffrement comme le ferait le navigateur.
  const salt = body.subarray(0, 16)
  assert.equal(body.readUInt32BE(16), 4096)
  const asPublic = body.subarray(21, 21 + body[20]!)
  const ikm = Buffer.from(hkdfSync('sha256', ua.computeSecret(asPublic), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32))
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const data = body.subarray(21 + asPublic.length)
  const decipher = createDecipheriv('aes-128-gcm', key, nonce)
  decipher.setAuthTag(data.subarray(-16))
  const plain = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()])
  assert.equal(plain.subarray(0, -1).toString(), '{"titre":"Rappel"}')
  assert.equal(plain.at(-1), 2)
})

test('VAPID : JWT ES256 signé, origine du service, clé publique jointe', () => {
  const keys = generateVapidKeys()
  const now = Date.parse('2026-10-30T07:30:00Z')
  const header = vapidAuthorization('https://web.push.apple.com/QGuQyavXu', keys, 'https://example.com', now)
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)
  assert.ok(m)
  const [, h, c, s, k] = m
  assert.equal(k, vapidPublicKey(keys))
  assert.equal(unb64(k!).length, 65)
  assert.deepEqual(JSON.parse(unb64(c!).toString()), { aud: 'https://web.push.apple.com', exp: now / 1000 + 12 * 3600, sub: 'https://example.com' })
  const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: keys.x, y: keys.y }, format: 'jwk' })
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, unb64(s!)))
})

test('envoi limité aux services de notification connus', () => {
  assert.ok(allowedEndpoint('https://web.push.apple.com/QGuQyavXu'))
  assert.ok(allowedEndpoint('https://fcm.googleapis.com/fcm/send/abc'))
  assert.ok(!allowedEndpoint('http://web.push.apple.com/x'))
  assert.ok(!allowedEndpoint('https://127.0.0.1:8787/x'))
  assert.ok(!allowedEndpoint('https://web.push.apple.com.evil.example/x'))
  assert.ok(!allowedEndpoint('pas une adresse'))
})

test('Topic accepté par Apple : 24 caractères base64 URL, stable', () => {
  for (const tag of ['bienvenue', 'essai', 'rappel-12', 'briefing']) {
    const t = pushTopic(tag)
    assert.match(t, /^[A-Za-z0-9_-]{24}$/)
    assert.equal(t, pushTopic(tag))
  }
  assert.notEqual(pushTopic('rappel-1'), pushTopic('rappel-2'))
})
