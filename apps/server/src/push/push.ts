import type { PushInfo } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import { db, userIndex } from '../db.ts'
import { getSecret, setSecret } from '../secrets.ts'
import type { PushMessage } from './messages.ts'
import { allowedEndpoint, generateVapidKeys, sendPush, vapidPublicKey, type PushOptions, type Subscription, type VapidKeys } from './webpush.ts'

/**
 * Notifications sur le téléphone, même app fermée : abonnements en base, clé VAPID dans le trousseau.
 * Le contenu est chiffré pour le téléphone : Apple ou Google ne font que le transporter.
 * Un abonnement appartient à un utilisateur : une notification ne part que vers ses téléphones.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS push_abonnements (
    endpoint TEXT PRIMARY KEY,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    cree INTEGER NOT NULL,
    echecs INTEGER NOT NULL DEFAULT 0
  );
`)
userIndex('push_abonnements')

type Row = { endpoint: string; p256dh: string; auth: string; echecs: number }

const q = {
  all: db.prepare('SELECT endpoint, p256dh, auth, echecs FROM push_abonnements WHERE utilisateur_id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM push_abonnements WHERE utilisateur_id = ?'),
  get: db.prepare('SELECT endpoint, p256dh, auth, echecs FROM push_abonnements WHERE utilisateur_id = ? AND endpoint = ?'),
  // Un téléphone qui change d'utilisateur (déconnexion, autre compte) passe au nouveau : un même abonnement n'a qu'un propriétaire.
  upsert: db.prepare(
    `INSERT INTO push_abonnements (utilisateur_id, endpoint, p256dh, auth, cree) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET utilisateur_id = excluded.utilisateur_id, p256dh = excluded.p256dh, auth = excluded.auth, echecs = 0`
  ),
  remove: db.prepare('DELETE FROM push_abonnements WHERE utilisateur_id = ? AND endpoint = ?'),
  failed: db.prepare('UPDATE push_abonnements SET echecs = echecs + 1 WHERE utilisateur_id = ? AND endpoint = ?'),
  sent: db.prepare('UPDATE push_abonnements SET echecs = 0 WHERE utilisateur_id = ? AND endpoint = ?')
}

/** Après 20 échecs d'affilée (service injoignable, clé refusée), l'abonnement est oublié. */
const MAX_FAILURES = 20

let keys: VapidKeys | null = null

/** Charge la clé VAPID, ou la crée au premier démarrage. Sans trousseau, elle ne vit que le temps du serveur. */
export async function initPush(): Promise<void> {
  const stored = await getSecret('PUSH_VAPID')
  if (stored) {
    try {
      keys = JSON.parse(stored) as VapidKeys
      return
    } catch {
      console.warn('[push] Clé PUSH_VAPID illisible : une nouvelle est créée, le téléphone se réabonnera.')
    }
  }
  keys = generateVapidKeys()
  await setSecret('PUSH_VAPID', JSON.stringify(keys)).catch(() => {
    console.warn('[push] Trousseau indisponible : la clé des notifications ne survivra pas au redémarrage.')
  })
}

export function pushInfo(uid: number): PushInfo {
  return { publicKey: keys ? vapidPublicKey(keys) : null, abonnes: (q.count.get(uid) as { n: number }).n }
}

/** Valide et enregistre l'abonnement d'un téléphone pour cet utilisateur. `nouveau` : premier enregistrement pour lui. */
export function subscribe(uid: number, raw: unknown): { erreur: string } | { nouveau: boolean; sub: Subscription } {
  const s = raw as Partial<Subscription> | null
  const endpoint = typeof s?.endpoint === 'string' ? s.endpoint : ''
  const p256dh = typeof s?.keys?.p256dh === 'string' ? s.keys.p256dh : ''
  const auth = typeof s?.keys?.auth === 'string' ? s.keys.auth : ''
  if (!allowedEndpoint(endpoint)) return { erreur: 'Service de notification inconnu.' }
  if (Buffer.from(p256dh, 'base64url').length !== 65 || Buffer.from(auth, 'base64url').length !== 16) return { erreur: 'Abonnement illisible.' }
  const nouveau = !q.get.get(uid, endpoint)
  q.upsert.run(uid, endpoint, p256dh, auth, Date.now())
  return { nouveau, sub: { endpoint, keys: { p256dh, auth } } }
}

export function unsubscribe(uid: number, endpoint: string): void {
  q.remove.run(uid, endpoint)
}

/** Envoie à un abonnement ; oublie ceux qui n'existent plus. Renvoie `true` si le service a accepté. */
async function deliver(uid: number, sub: Subscription, msg: PushMessage, opts: PushOptions): Promise<boolean> {
  if (!keys) return false
  const res = await sendPush(sub, msg, keys, codeConfig.push.subject, opts)
  if (res.ok) {
    q.sent.run(uid, sub.endpoint)
    return true
  }
  const row = q.get.get(uid, sub.endpoint) as Row | undefined
  if (res.gone || (row && row.echecs + 1 >= MAX_FAILURES)) {
    q.remove.run(uid, sub.endpoint)
    console.warn(`[push] Abonnement oublié (${res.status || 'réseau'}) : ${res.message}`)
  } else {
    q.failed.run(uid, sub.endpoint)
    console.warn(`[push] Échec de l'envoi (${res.status || 'réseau'}) : ${res.message}`)
  }
  return false
}

/** Notifie tous les téléphones de cet utilisateur. Renvoie le nombre de notifications acceptées. */
export async function notifyAll(uid: number, msg: PushMessage, opts: PushOptions = {}): Promise<number> {
  const rows = q.all.all(uid) as Row[]
  const results = await Promise.all(rows.map((r) => deliver(uid, { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, msg, { topic: msg.tag, ...opts })))
  return results.filter(Boolean).length
}

export async function notifyOne(uid: number, sub: Subscription, msg: PushMessage, opts: PushOptions = {}): Promise<boolean> {
  return deliver(uid, sub, msg, { topic: msg.tag, ...opts })
}
