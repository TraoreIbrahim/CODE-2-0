import '@code/ui/theme.css'
import './styles.css'
import { Component, StrictMode, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfirmCard, Orb, conversationHere, conversationOn, nomDe, useCode, viewOf, type Code } from '@code/ui'
import { bridge, useServerConfig } from './config.ts'

/** Taille de la fenêtre pour chaque forme de la miniature . */
const SIZES = { pastille: [112, 112], pilule: [360, 104], reunion: [372, 104], carte: [400, 260], rappel: [400, 168] } as const
/** Délai pour reconnaître un double-clic (ouvrir l'app) d'un simple clic (parler). */
const DOUBLE_CLICK_MS = 260

/**
 * Glisser pour déplacer la miniature ; un appui sans mouvement reste un clic (`onTap`).
 * Les boutons à l'intérieur (orbe, arrêt…) gardent leur clic : on ne commence pas à glisser sur eux,
 * sauf `dragFromButtons` (la pastille, qui est elle-même un grand bouton).
 */
function useMiniDrag(onTap?: () => void, dragFromButtons = false) {
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const end = () => {
    drag.current = null
    document.body.classList.remove('mini--dragging')
  }
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      if (!dragFromButtons && (e.target as HTMLElement).closest('button')) return
      drag.current = { x: e.screenX, y: e.screenY, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current
      if (!d) return
      const dx = e.screenX - d.x
      const dy = e.screenY - d.y
      // Quelques pixels de tolérance : un clic qui tremble reste un clic.
      if (!d.moved && Math.hypot(dx, dy) < 4) return
      d.moved = true
      d.x = e.screenX
      d.y = e.screenY
      document.body.classList.add('mini--dragging')
      bridge.moveMini(dx, dy)
    },
    onPointerUp: () => {
      const tapped = drag.current && !drag.current.moved
      end()
      if (tapped) onTap?.()
    },
    onPointerCancel: end
  }
}

/** « 12:40 », « 1:02:05 ». */
const chrono = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(t / 3600)
  const m = String(Math.floor((t % 3600) / 60)).padStart(h ? 2 : 1, '0')
  return `${h ? `${h}:` : ''}${m}:${String(t % 60).padStart(2, '0')}`
}

/** L'orbe d'une réunion : une respiration lente (le micro qui enregistre est celui de la fenêtre de l'app). */
const souffle = () => 0.1 + 0.08 * Math.abs(Math.sin(Date.now() / 900))

/** Le temps écoulé depuis `debut`, rafraîchi chaque seconde. */
function Chrono({ debut }: { debut: number }) {
  const [, tic] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tic((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return <time className="code-mono">{chrono(Date.now() - debut)}</time>
}

/** Le mode conversation tient le micro d'un écran de l'ordinateur (l'app ou la miniature). */
const macConversation = (client: Code['client']) => conversationOn(client.getState(), ['mac', 'mini'])

function Mini() {
  const { url, token } = useServerConfig()
  // Le jeton du serveur peut arriver après coup (premier démarrage) : la miniature repart avec.
  return <MiniView key={token ?? ''} url={url} token={token} />
}

function MiniView({ url, token }: { url: string | null; token: string | null }) {
  // Sans compte sur cet ordinateur, la miniature n'affiche pas de connexion : un clic ouvre l'app.
  const code = useCode(url, token, 'mini', { nom: 'Ordinateur', onToken: (t) => bridge.setToken(t), pont: bridge.pont })
  const view = code ? viewOf(code.state, code.status, 'mac') : null
  const pending = code?.state.pending ?? null
  // Un rappel qui sonne passe avant tout, sauf une validation en attente ou une conversation en cours.
  const ringing = code?.state.rappels.find((r) => r.etat === 'sonne') ?? null
  const talking = !!view && ['ecoute', 'reflexion', 'parole'].includes(view.state)
  // Une réunion s'enregistre (dans la fenêtre de l'app, même fermée) : la miniature le montre tant que ça dure.
  const reunion = code?.state.reunions?.find((r) => r.etat === 'enregistrement') ?? null
  const shape: keyof typeof SIZES = pending ? 'carte' : talking ? 'pilule' : ringing ? 'rappel' : reunion ? 'reunion' : 'pastille'

  useEffect(() => {
    const [w, h] = SIZES[shape]
    bridge.resizeMini(w, h)
  }, [shape])

  // Mode conversation tenu par l'app du Mac : c'est son micro qui écoute ; la miniature n'en ouvre pas un second.
  const elsewhere = (c: Code) => macConversation(c.client) && !conversationHere(c.state)
  useEffect(() => {
    if (!code) return
    return bridge.onToggleVoice(() => !elsewhere(code) && void code.voice.toggle())
  }, [code])
  // Veille ou écran verrouillé : le mode conversation du Mac se coupe (pas celui du téléphone).
  useEffect(() => {
    if (!code) return
    return bridge.onSleep(() => macConversation(code.client) && void code.voice.setConversation(false))
  }, [code])

  useEffect(() => {
    if (!code) return
    return bridge.onPresence(() => code.client.send({ type: 'presence', voice: true }))
  }, [code])

  // Un clic : parler (ou arrêter). Un double-clic : ouvrir l'app. On attend un instant après le premier
  // clic pour savoir s'il y en a un second (sinon le double-clic ouvrait le micro, puis tombait sur la pilule).
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onTap = () => {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current)
      tapTimer.current = null
      bridge.openMain()
      return
    }
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null
      if (code?.state.connection === 'auth') bridge.openMain()
      else if (code && !elsewhere(code)) void code.voice.toggle()
    }, DOUBLE_CLICK_MS)
  }
  const puckDrag = useMiniDrag(onTap, true)
  const panelDrag = useMiniDrag()

  if (!code || !view) {
    return (
      <div className="mini mini--pastille">
        <div className="mini__puck" {...panelDrag}>
          <Orb mode="injoignable" size={78} label="Assistant injoignable" />
        </div>
      </div>
    )
  }

  const { voice, client, state } = code
  const nom = nomDe(code)
  const toggle = () => !elsewhere(code) && void voice.toggle()
  const conversing = conversationOn(state, ['mac', 'mini'])

  if (shape === 'carte' && pending) {
    return (
      <div className="mini mini--carte">
        <div className="mini__card">
          <div className="mini__card-head" {...panelDrag}>
            <Orb mode="validation" size={40} label={`${nom} attend votre accord`} />
            <button type="button" className="code-icon-btn mini__open" aria-label="Ouvrir en plein écran" onClick={() => bridge.openMain()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
              </svg>
            </button>
          </div>
          <ConfirmCard
            request={pending}
            onConfirm={() => client.send({ type: 'confirm', actionId: pending.actionId })}
            onCancel={() => client.send({ type: 'cancel', actionId: pending.actionId })}
          />
        </div>
      </div>
    )
  }

  if (shape === 'rappel' && ringing) {
    const others = state.rappels.filter((r) => r.etat === 'sonne').length - 1
    return (
      <div className="mini mini--rappel">
        <div className="mini__ring" role="alert" {...panelDrag}>
          <div className="mini__ring-orb">
            <Orb mode="alerte" size={44} label={ringing.retard ? `${nom} : rappel en retard` : `${nom} : rappel`} />
          </div>
          <div className="mini__ring-text">
            <span className="mini__ring-kicker">
              RAPPEL{ringing.retard ? ' · EN RETARD' : ''} · {ringing.recurrence ?? ringing.heure}
              {others > 0 ? ` · +${others}` : ''}
            </span>
            <strong>{ringing.texte}</strong>
          </div>
          <div className="mini__ring-actions">
            <button type="button" className="ring__btn ring__btn--main" onClick={() => client.reminderAction(ringing.id, 'fait')}>
              Fait
            </button>
            <button type="button" className="ring__btn" onClick={() => client.reminderAction(ringing.id, 'reporter', 10)}>
              +10 min
            </button>
            <button type="button" className="ring__btn" onClick={() => client.reminderAction(ringing.id, 'reporter', 60)}>
              +1 h
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (shape === 'reunion' && reunion) {
    return (
      <div className={`mini mini--pilule mini--reunion${reunion.enPause ? ' mini--reunion-pause' : ''}`}>
        <div className="mini__pill" role="status" aria-label={reunion.enPause ? 'Enregistrement de la réunion en pause' : 'Réunion en cours d’enregistrement'} {...panelDrag}>
          <button type="button" className="mini__orb mini__orb--rec" aria-label={`Parler à ${nom} (double-clic : ouvrir l’app)`} onClick={(e) => (e.detail === 0 ? toggle() : onTap())}>
            <Orb mode="ecoute" size={60} level={souffle} label="En réunion" />
          </button>
          <div className="mini__text">
            <span className="code-state-label mini__label mini__label--rec">
              <i aria-hidden="true" /> {reunion.enPause ? 'EN PAUSE' : 'EN RÉUNION'}
            </span>
            <span className="mini__line">
              {reunion.enPause ? 'Rien n’est capté' : 'Enregistrement'} · <Chrono debut={reunion.debut ?? Date.now()} />
            </span>
          </div>
          <button type="button" className="mini__stop mini__stop--pause" aria-label={reunion.enPause ? 'Reprendre l’enregistrement' : 'Mettre l’enregistrement en pause'} title={reunion.enPause ? 'Reprendre' : 'Pause'} onClick={() => client.pauseReunion(reunion.id, !reunion.enPause)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              {reunion.enPause ? <path d="M8 5.5v13l11-6.5z" /> : <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />}
            </svg>
          </button>
          <button type="button" className="mini__stop mini__stop--rec" aria-label="Terminer l’enregistrement de la réunion" title="Terminer l’enregistrement" onClick={() => client.demanderArretReunion(reunion.id)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  if (shape === 'pilule') {
    return (
      <div className={`mini mini--pilule${reunion ? ' mini--enregistre' : ''}`}>
        <div className="mini__pill" {...panelDrag}>
          <button
            type="button"
            className="mini__orb"
            aria-label={view.state === 'parole' ? `Interrompre ${nom} (double-clic : ouvrir l’app)` : conversing ? `Parler à ${nom}, mode conversation (double-clic : ouvrir l’app)` : 'Arrêter l’écoute (double-clic : ouvrir l’app)'}
            onClick={(e) => (e.detail === 0 ? toggle() : onTap())}
          >
            <Orb mode={view.orb} size={60} level={voice.level} label={view.label} />
          </button>
          <div className="mini__text">
            <span className={`code-state-label mini__label tone-${view.tone}`}>{view.label}</span>
            <span className="mini__line">{state.partial || (view.state === 'parole' ? state.reply : state.lastUser) || view.sub}</span>
          </div>
          <button
            type="button"
            className="mini__stop"
            aria-label={conversing && view.state === 'ecoute' ? 'Arrêter le mode conversation' : 'Arrêter'}
            title={conversing && view.state === 'ecoute' ? 'Arrêter le mode conversation' : undefined}
            onClick={() => (conversing && view.state === 'ecoute' ? void voice.setConversation(false) : toggle())}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mini mini--pastille">
      <button
        type="button"
        className="mini__puck"
        aria-label={view.state === 'veille' ? `Parler à ${nom} (⌘⇧Espace) — glisser pour déplacer` : view.label}
        {...puckDrag}
        // Souris : géré par puckDrag (clic, double-clic ou glisser). Clavier (Entrée, Espace) : clic classique.
        onClick={(e) => e.detail === 0 && toggle()}
        // Pas « disabled » : un bouton désactivé ne reçoit plus la souris, on ne pourrait plus déplacer
        // la miniature. Le contrôleur vocal ignore déjà le toucher hors connexion ou à l'arrêt.
        aria-disabled={state.connection !== 'connecte' || state.serverState === 'arret'}
      >
        <Orb mode={view.orb} size={78} level={voice.level} label={view.label} />
      </button>
    </div>
  )
}

/**
 * Une erreur de la miniature démontait toute la page : la fenêtre, transparente, restait là mais invisible.
 * La pastille reste affichée (CODE injoignable) ; un clic recharge la miniature.
 */
class MiniGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error('Miniature : erreur, pastille de secours affichée.', error)
    bridge.resizeMini(...SIZES.pastille)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="mini mini--pastille">
        <button type="button" className="mini__puck" aria-label="L’assistant a rencontré une erreur — cliquer pour recharger" onClick={() => location.reload()}>
          <Orb mode="injoignable" size={78} label="L’assistant a rencontré une erreur" />
        </button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MiniGuard>
      <Mini />
    </MiniGuard>
  </StrictMode>
)
