import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { DeviceKind } from '@code/protocol'
import { CodeClient, type ClientState, type PontClient } from './client.ts'
import { VoiceController, type VoiceStatus } from './voice.ts'
import { applyOrbe, applyTheme } from './palette.ts'
import { setMapTrace } from './holo/map-trace.ts'

export type Code = {
  client: CodeClient
  voice: VoiceController
  state: ClientState
  status: VoiceStatus
}

/**
 * Connecte l'écran au serveur et branche la voix. Un seul appel par fenêtre.
 * Sans jeton, le client attend la connexion (écran de connexion) ; `onToken` garde le jeton obtenu
 * ou l'efface quand il n'est plus valable. Le jeton n'est lu qu'à la création : en changer ne reconnecte pas.
 */
export function useCode(url: string | null, token: string | null, device: DeviceKind, opts: { nom?: string; onToken?: (token: string | null) => void; pont?: PontClient; sonSysteme?: () => Promise<MediaStream | null> } = {}): Code | null {
  const [pair, setPair] = useState<{ client: CodeClient; voice: VoiceController } | null>(null)
  const initial = useRef({ token, opts })
  initial.current = { token: initial.current.token, opts }

  useEffect(() => {
    if (!url) return
    const client = new CodeClient({ url, token: initial.current.token, device, nom: initial.current.opts.nom, onToken: (t) => initial.current.opts.onToken?.(t), ...(initial.current.opts.pont ? { pont: initial.current.opts.pont } : {}), ...(initial.current.opts.sonSysteme ? { sonSysteme: () => initial.current.opts.sonSysteme!() } : {}) })
    const voice = new VoiceController(client)
    client.connect()
    setPair({ client, voice })
    // Erreurs de l'écran (rendu, promesses) : leur texte seul part au journal technique de l'appareil, pour
    // diagnostiquer un écran figé à distance. Jamais de contenu ; une même erreur une fois par minute.
    const seen = new Map<string, number>()
    const report = (what: string) => {
      const msg = what.replace(/\s+/g, ' ').slice(0, 240)
      if (Date.now() - (seen.get(msg) ?? 0) < 60_000) return
      seen.set(msg, Date.now())
      client.send({ type: 'client.log', message: `erreur de l’écran : ${msg}` })
    }
    // Les cartes notent leurs étapes au même journal (une carte noire sur un téléphone ne dit rien).
    setMapTrace((step) => client.send({ type: 'client.log', message: step }))
    const onError = (e: ErrorEvent) => report(`${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`)
    const onRejection = (e: PromiseRejectionEvent) => report(`promesse : ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      setMapTrace(null)
      void voice.dispose()
      client.close()
      setPair(null)
    }
  }, [url, device])

  const noop = useMemo(() => ({ sub: () => () => {}, get: () => null }), [])
  const state = useSyncExternalStore(pair?.client.subscribe ?? noop.sub, pair?.client.getState ?? noop.get)
  const status = useSyncExternalStore(pair?.voice.subscribe ?? noop.sub, pair?.voice.getStatus ?? noop.get)
  // Le thème de l'utilisateur, sur chaque écran (et aussitôt qu'il change sur un autre appareil).
  const theme = state?.utilisateur?.reglages.theme
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])
  const orbe = state?.utilisateur?.reglages.orbe
  useEffect(() => {
    if (orbe) applyOrbe(orbe)
  }, [orbe])
  // Le titre de la fenêtre : le nom de l'assistant une fois connecté (celui de l'app, CODE 2.0, avant).
  const nomAssistant = state?.utilisateur?.reglages.nomAssistant
  useEffect(() => {
    if (nomAssistant && device !== 'mini') document.title = nomAssistant
  }, [nomAssistant, device])
  if (!pair || !state || !status) return null
  return { ...pair, state, status }
}

/** Secondes restantes avant l'échéance (se met à jour chaque seconde). */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!until) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [until])
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0
}

/** Un interrupteur mémorisé sur l'appareil (ex. « interface affichée »). */
export function useStoredToggle(key: string, initial: boolean): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    try {
      const v = localStorage.getItem(key)
      return v === null ? initial : v === '1'
    } catch {
      return initial
    }
  })
  const toggle = () =>
    setOn((prev) => {
      try {
        localStorage.setItem(key, prev ? '0' : '1')
      } catch {}
      return !prev
    })
  return [on, toggle]
}
