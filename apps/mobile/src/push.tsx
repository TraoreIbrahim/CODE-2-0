import { useCallback, useEffect, useState } from 'react'
import type { Code } from '@code/ui'

/**
 * Notifications du téléphone : rappels et briefing du matin, même app fermée.
 * Sur iPhone : iOS 16.4 ou plus, et seulement dans l'app ajoutée à l'écran d'accueil.
 */

export type PushState =
  /** Navigateur sans Web Push (ni iPhone à installer) : la cloche n'apparaît pas. */
  | 'indisponible'
  /** iPhone dans Safari : il faut d'abord ajouter CODE à l'écran d'accueil. */
  | 'ecran_accueil'
  | 'bloque'
  | 'inactif'
  | 'en_cours'
  | 'actif'

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
const standalone = () => (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** L'abonnement a été fait avec la clé actuelle du serveur (elle change si le trousseau est réinitialisé). */
function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const key = sub.options.applicationServerKey
  if (!key) return false
  const a = new Uint8Array(key)
  const b = keyBytes(publicKey)
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function toJson(sub: PushSubscription) {
  const j = sub.toJSON()
  return { endpoint: j.endpoint ?? sub.endpoint, keys: { p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '' } }
}

/** Appelé avant que la connexion existe (`code` nul) : les hooks gardent le même ordre. */
export function usePush(code: Code | null) {
  const client = code?.client ?? null
  const state = code?.state ?? null
  const publicKey = state?.push.publicKey ?? null
  const connected = state?.connection === 'connecte'
  const [local, setLocal] = useState<PushState>(() =>
    !supported() ? (isIos() && !standalone() ? 'ecran_accueil' : 'indisponible') : Notification.permission === 'denied' ? 'bloque' : 'inactif'
  )
  const [message, setMessage] = useState('')

  const subscribe = useCallback(async () => {
    if (!client || !publicKey) throw new Error('Le serveur n’a pas encore de clé de notification.')
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (sub && !sameKey(sub, publicKey)) {
      await sub.unsubscribe().catch(() => {})
      sub = null
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
    client.subscribePush(toJson(sub))
  }, [client, publicKey])

  // À chaque connexion : l'abonnement existant est redonné au serveur (base réinitialisée, clé changée).
  useEffect(() => {
    if (!connected || !publicKey || !supported() || Notification.permission !== 'granted') return
    setLocal('en_cours')
    subscribe().catch(() => setLocal('inactif'))
  }, [connected, publicKey, subscribe])

  // Réponse du serveur à l'abonnement ou à l'essai.
  useEffect(() => {
    const r = state?.pushResult
    if (!r) return
    setLocal(r.ok ? 'actif' : 'inactif')
    if (r.message) setMessage(r.message)
  }, [state?.pushResult])

  // Un rappel « fait » ou reporté depuis l'app : sa notification quitte l'écran verrouillé.
  const ringing = (state?.rappels ?? []).filter((r) => r.etat === 'sonne').map((r) => `rappel-${r.id}`).join(',')
  useEffect(() => {
    if (!supported() || Notification.permission !== 'granted') return
    void navigator.serviceWorker.ready
      .then((reg) => reg.getNotifications())
      .then((list) => {
        const keep = new Set(ringing.split(','))
        for (const n of list) if (n.tag.startsWith('rappel-') && !keep.has(n.tag)) n.close()
      })
      .catch(() => {})
  }, [ringing])

  /** Toucher la cloche : la demande d'autorisation doit partir directement du geste (exigence d'iOS). */
  const enable = useCallback(async () => {
    setMessage('')
    if (local === 'ecran_accueil') {
      setMessage('Sur iPhone, les notifications passent par l’app de l’écran d’accueil : dans Safari, touchez Partager puis « Sur l’écran d’accueil », et ouvrez CODE 2.0 depuis son icône.')
      return
    }
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setLocal(permission === 'denied' ? 'bloque' : 'inactif')
      if (permission === 'denied') setMessage('Notifications refusées. Pour les rétablir : Réglages → Notifications → CODE 2.0.')
      return
    }
    setLocal('en_cours')
    try {
      await subscribe()
    } catch (err) {
      setLocal('inactif')
      setMessage(`Abonnement impossible : ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [local, subscribe])

  const disable = useCallback(async () => {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      client?.unsubscribePush(sub.endpoint)
      await sub.unsubscribe().catch(() => {})
    }
    setLocal('inactif')
    setMessage('Notifications désactivées sur ce téléphone.')
  }, [client])

  return { state: local, message, clearMessage: () => setMessage(''), enable, disable, test: () => client?.testPush() }
}

export function BellIcon({ on, off }: { on: boolean; off: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
      {on && <path d="M3 9.5a9 9 0 0 1 2.2-4.6M21 9.5a9 9 0 0 0-2.2-4.6" />}
      {off && <path d="M4 3.5l16 17" />}
    </svg>
  )
}

/** Dans l'assistant et les Réglages : l'abonnement de ce téléphone (le réglage « notifications » vaut pour tous). */
export function PushSetting({ push }: { push: ReturnType<typeof usePush> }) {
  const label: Record<PushState, string> = {
    actif: 'Ce téléphone reçoit les notifications.',
    en_cours: 'Abonnement en cours…',
    inactif: 'Ce téléphone ne reçoit pas encore les notifications.',
    bloque: 'Notifications refusées : Réglages → Notifications → CODE 2.0.',
    ecran_accueil: 'Sur iPhone, ajoutez d’abord CODE 2.0 à l’écran d’accueil.',
    indisponible: 'Ce navigateur ne reçoit pas de notifications.'
  }
  return (
    <div className="rg-row">
      {push.state === 'actif' ? (
        <button type="button" className="rg-mini" onClick={push.test}>
          Essai
        </button>
      ) : (
        (push.state === 'inactif' || push.state === 'ecran_accueil') && (
          <button type="button" className="rg-mini" onClick={() => void push.enable()}>
            Activer sur ce téléphone
          </button>
        )
      )}
      <small className="rg-hint">{push.message || label[push.state]}</small>
    </div>
  )
}
