import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { SCOPES, TEST_MODE_LIFETIME_MS, authUrl, classifyTokenError, describeExpiry, pkcePair, tokenLife } from './oauth.ts'

const H = 3600_000
const T0 = Date.parse('2026-10-22T09:00:00Z')

test('mode test : l’accès dure 7 jours après la connexion', () => {
  const life = tokenLife(T0, T0 + 2 * 24 * H)
  assert.equal(life.expireLe, T0 + TEST_MODE_LIFETIME_MS)
  assert.equal(life.restantMs, 5 * 24 * H)
  assert.equal(life.bientot, false)
  assert.equal(tokenLife(T0, T0 + 6.5 * 24 * H).bientot, true)
})

test('expiration dite en clair', () => {
  assert.equal(describeExpiry(T0, T0 + H), 'expire dans 6 jours')
  assert.equal(describeExpiry(T0, T0 + 5 * 24 * H + H), 'expire demain')
  assert.equal(describeExpiry(T0, T0 + 6 * 24 * H + 21 * H), 'expire dans 3 h')
  assert.equal(describeExpiry(T0, T0 + 7 * 24 * H - 10 * 60_000), 'expire dans moins d’une heure')
  assert.equal(describeExpiry(T0, T0 + 8 * 24 * H), 'a sans doute expiré')
})

test('un refus « invalid_grant » signifie : reconnecter Google ; le reste est passager', () => {
  assert.equal(classifyTokenError(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), 'expire')
  assert.equal(classifyTokenError(400, { error: 'unauthorized_client' }), 'expire')
  assert.equal(classifyTokenError(500, { error: 'internal_failure' }), 'temporaire')
  assert.equal(classifyTokenError(503, 'Service Unavailable'), 'temporaire')
  assert.equal(classifyTokenError(429, {}), 'temporaire')
})

test('PKCE : le défi est le SHA-256 du vérificateur', () => {
  const { verifier, challenge } = pkcePair()
  assert.ok(verifier.length >= 43 && verifier.length <= 128)
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'))
  assert.notEqual(pkcePair().verifier, verifier)
})

test('page de consentement : accès durable, consentement redemandé, boucle locale, Gmail et Agenda', () => {
  const url = new URL(authUrl('client.apps.googleusercontent.com', 'http://127.0.0.1:53682', 'defi', 'etat'))
  const q = url.searchParams
  assert.equal(q.get('access_type'), 'offline')
  assert.equal(q.get('prompt'), 'consent')
  assert.equal(q.get('redirect_uri'), 'http://127.0.0.1:53682')
  assert.equal(q.get('code_challenge_method'), 'S256')
  assert.equal(q.get('state'), 'etat')
  assert.deepEqual(q.get('scope')!.split(' ').sort(), Object.values(SCOPES).sort())
})
