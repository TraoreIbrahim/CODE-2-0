import { createECDH, createHash, createPrivateKey, createCipheriv, generateKeyPairSync, hkdfSync, randomBytes, sign, type KeyObject } from 'node:crypto'

/**
 * Web Push sans dépendance : chiffrement du contenu (RFC 8291, aes128gcm) et
 * identification du serveur auprès d'Apple ou de Google (VAPID, RFC 8292).
 */

/**
 * En-tête `Topic` (regroupement des notifications) : 32 caractères base64 URL au plus, et Apple
 * le refuse (« BadWebPushTopic ») si ce n'est pas du base64 valide : « bienvenue » ou « essai »,
 * de longueur 4n + 1, sont rejetés. On envoie donc une empreinte de 24 caractères, stable pour
 * un même `tag`.
 */
export function pushTopic(tag: string): string {
  return createHash('sha256').update(tag).digest('base64url').slice(0, 24)
}

export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } }

/** Clé VAPID (JWK P-256), rangée dans le trousseau sous PUSH_VAPID. */
export type VapidKeys = { x: string; y: string; d: string }

const b64 = (buf: Buffer | Uint8Array) => Buffer.from(buf).toString('base64url')
const unb64 = (s: string) => Buffer.from(s, 'base64url')

export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = privateKey.export({ format: 'jwk' })
  return { x: jwk.x!, y: jwk.y!, d: jwk.d! }
}

/** Clé publique brute (65 octets, base64url) : `applicationServerKey` côté téléphone, `k=` dans l'en-tête. */
export function vapidPublicKey(keys: VapidKeys): string {
  return b64(Buffer.concat([Buffer.from([4]), unb64(keys.x), unb64(keys.y)]))
}

function privateKeyObject(keys: VapidKeys): KeyObject {
  return createPrivateKey({ key: { kty: 'EC', crv: 'P-256', ...keys }, format: 'jwk' })
}

/** En-tête `Authorization` VAPID : un JWT ES256 valable 12 h pour l'origine du service de notification. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const header = b64(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })))
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: privateKeyObject(keys), dsaEncoding: 'ieee-p1363' })
  return `vapid t=${header}.${claims}.${b64(signature)}, k=${vapidPublicKey(keys)}`
}

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number) => Buffer.from(hkdfSync('sha256', ikm, salt, info, length))

/**
 * Chiffre le contenu pour un abonnement (un seul enregistrement de 4096 octets).
 * `salt` et `serverKey` ne sont fournis que par les tests (vecteur de la RFC 8291).
 */
export function encryptPayload(sub: Subscription, payload: Buffer, test?: { salt: Buffer; serverPrivate: Buffer }): Buffer {
  const uaPublic = unb64(sub.keys.p256dh)
  const authSecret = unb64(sub.keys.auth)
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('Abonnement invalide : clés du téléphone illisibles.')
  const ecdh = createECDH('prime256v1')
  if (test) ecdh.setPrivateKey(test.serverPrivate)
  else ecdh.generateKeys()
  const asPublic = ecdh.getPublicKey()
  const secret = ecdh.computeSecret(uaPublic)
  const ikm = hkdf(authSecret, secret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32)
  const salt = test?.salt ?? randomBytes(16)
  const key = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)
  const cipher = createCipheriv('aes-128-gcm', key, nonce)
  // 0x02 : dernier (et seul) enregistrement, sans remplissage.
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])
  const rs = Buffer.alloc(4)
  rs.writeUInt32BE(4096)
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body])
}

/** Services de notification connus (Apple, Google, Mozilla, Microsoft) : on n'envoie rien ailleurs. */
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/]

/** `CODE_PUSH_TEST_HOST` : hôte local du faux service de notification (scripts/e2e.mjs). */
export function allowedEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  const test = process.env.CODE_PUSH_TEST_HOST
  if (test && url.host === test) return true
  return url.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(url.hostname))
}

export type PushOptions = {
  /** Durée de vie chez Apple ou Google si le téléphone est éteint (secondes). */
  ttl?: number
  urgency?: 'very-low' | 'low' | 'normal' | 'high'
  /** Une notification en attente remplace la précédente du même sujet. */
  topic?: string
}

/** Résultat d'un envoi : `gone` si l'abonnement n'existe plus (à oublier). */
export type PushResult = { ok: true } | { ok: false; gone: boolean; status: number; message: string }

export async function sendPush(sub: Subscription, payload: unknown, keys: VapidKeys, subject: string, opts: PushOptions = {}): Promise<PushResult> {
  if (!allowedEndpoint(sub.endpoint)) return { ok: false, gone: true, status: 0, message: 'service de notification inconnu' }
  const body = encryptPayload(sub, Buffer.from(JSON.stringify(payload)))
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(sub.endpoint, keys, subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(opts.ttl ?? 3600),
        Urgency: opts.urgency ?? 'high',
        ...(opts.topic ? { Topic: pushTopic(opts.topic) } : {})
      },
      body,
      signal: AbortSignal.timeout(10_000)
    })
    if (res.ok) return { ok: true }
    const text = (await res.text().catch(() => '')).slice(0, 200)
    return { ok: false, gone: res.status === 404 || res.status === 410, status: res.status, message: text || res.statusText }
  } catch (err) {
    return { ok: false, gone: false, status: 0, message: err instanceof Error ? err.message : String(err) }
  }
}
