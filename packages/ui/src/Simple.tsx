import { useEffect, useState } from 'react'
import type { ChatMessage } from './client.ts'
import { ConfirmCard } from './ConfirmCard.tsx'
import { Horizon } from './Horizon.tsx'
import type { Code } from './hooks.ts'
import { useNow } from './holo/Rappels.tsx'
import { Orb } from './Orb.tsx'
import { nomDe } from './reglages/comptes.tsx'
import { viewOf } from './view.ts'

/**
 * L'écran simplifié (Réglages › Assistant), pour un usage tout à la voix : l'heure en grand, l'orbe à toucher,
 * ce que fait l'assistant, et le dernier échange en sous-titres. Une action à valider ou un rappel qui sonne
 * prennent la place des sous-titres, avec de grands boutons. Ni cartes ni menus : un seul bouton, Réglages.
 */
export function EcranSimple({ code, device, onReglages }: { code: Code; device: 'mac' | 'mobile'; onReglages: () => void }) {
  const { state, status, voice, client } = code
  const now = useNow(15_000)
  const taille = useTailleOrbe(device)
  const view = viewOf(state, status, device)
  const nom = nomDe(code)
  const connected = state.connection === 'connecte'
  const halted = state.serverState === 'arret'
  const tz = state.utilisateur?.reglages.fuseau
  const heure = new Date(now).toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
  const jour = new Date(now).toLocaleDateString('fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' })
  const sonne = state.rappels.find((r) => r.etat === 'sonne')
  const { vous, lui } = dernierEchange(state.thread)
  const parle = view.state === 'ecoute' || view.state === 'parole'

  return (
    <div className="simple code-grid-bg">
      <header className="simple__haut">
        <p className="simple__horloge">
          <time className="simple__heure">{heure}</time>
          <span className="simple__jour">
            {jour}
            {state.utilisateur?.reglages.ville && <span className="simple__ville"> · {state.utilisateur.reglages.ville}</span>}
          </span>
        </p>
        <div className="simple__droite">
          <span className="simple__nom">{nom}</span>
          <button type="button" className="simple__reglages" onClick={onReglages}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="10" cy="17" r="2" />
            </svg>
            Réglages
          </button>
        </div>
      </header>

      <main className="simple__centre">
        <div className="simple__scene" style={{ width: taille, height: taille }}>
          <Horizon variant={device === 'mac' ? 'mac' : 'phone'} />
          <button
            type="button"
            className="simple__orbe horizon-float"
            aria-label={parle ? `Interrompre ${nom}` : `Parler à ${nom} (${view.label.toLowerCase()})`}
            disabled={!connected || halted}
            onClick={() => void voice.toggle()}
          >
            <Orb mode={view.orb} size={taille} level={voice.level} label={view.label} />
          </button>
        </div>
        <p className="simple__etat" role="status">
          <span className={`code-state-label tone-${view.tone}`}>{view.label}</span>
          {/* Un rappel qui sonne est déjà écrit en grand dessous. */}
          {!sonne && <span className="simple__aide">{view.sub}</span>}
        </p>
        {halted && (
          <button type="button" className="simple__bouton simple__bouton--oui" disabled={!connected} onClick={() => client.send({ type: 'resume' })}>
            Reprendre
          </button>
        )}
      </main>

      <section className="simple__bas" aria-live="polite">
        {state.pending ? (
          <div className="simple__accord">
            <ConfirmCard
              layout="ligne"
              request={state.pending}
              onConfirm={() => client.send({ type: 'confirm', actionId: state.pending!.actionId })}
              onCancel={() => client.send({ type: 'cancel', actionId: state.pending!.actionId })}
            />
          </div>
        ) : sonne ? (
          <div className="simple__rappel" role="alert">
            <small className="code-mono">RAPPEL{sonne.retard ? ' · EN RETARD' : ''} · {sonne.recurrence ?? sonne.heure}</small>
            <strong>{sonne.texte}</strong>
            <span className="simple__boutons">
              <button type="button" className="simple__bouton simple__bouton--oui" onClick={() => client.reminderAction(sonne.id, 'fait')}>
                C’est fait
              </button>
              <button type="button" className="simple__bouton" onClick={() => client.reminderAction(sonne.id, 'reporter', 10)}>
                Dans 10 min
              </button>
            </span>
          </div>
        ) : (
          (vous || lui) && (
            <div className="simple__soustitres">
              {vous && (
                <p className="simple__vous">
                  <span className="code-mono">VOUS</span> {queue(vous.text, 140)}
                </p>
              )}
              {lui && (
                <p className={`simple__lui${lui.streaming ? ' is-direct' : ''}`}>
                  <span className="simple__qui code-mono">{nom.toUpperCase()}</span>
                  {queue(lui.text, 280)}
                </p>
              )}
            </div>
          )
        )}
        {(state.error || status.micError) && (
          <p className="simple__erreur" role="alert">
            {state.error ?? status.micError}
          </p>
        )}
      </section>
    </div>
  )
}

/** Le dernier échange : la dernière phrase dite, et la réponse qui la suit (absente tant qu'elle n'est pas venue). */
export function dernierEchange(thread: readonly ChatMessage[]): { vous?: ChatMessage; lui?: ChatMessage } {
  const last = thread[thread.length - 1]
  if (!last) return {}
  if (last.role === 'user') return { vous: last }
  const avant = thread[thread.length - 2]
  return { lui: last, ...(avant?.role === 'user' ? { vous: avant } : {}) }
}

/** La fin d'un texte trop long pour l'écran, à partir d'un début de phrase : on lit ce qui se dit maintenant. */
export function queue(text: string, max: number): string {
  if (text.length <= max) return text
  const debut = text.slice(text.length - max)
  const phrase = debut.search(/[.!?…]\s+\S/)
  return `… ${phrase >= 0 ? debut.slice(phrase + 1).trimStart() : debut.slice(debut.indexOf(' ') + 1)}`
}

/** La taille de l'orbe, selon la fenêtre : grande, sans pousser les sous-titres hors de l'écran. */
function useTailleOrbe(device: 'mac' | 'mobile'): number {
  const calcule = () => Math.round(Math.max(180, Math.min(window.innerWidth * (device === 'mobile' ? 0.72 : 0.42), window.innerHeight * 0.4, 440)))
  const [taille, setTaille] = useState(calcule)
  useEffect(() => {
    const maj = () => setTaille(calcule())
    window.addEventListener('resize', maj)
    return () => window.removeEventListener('resize', maj)
  }, [device])
  return taille
}
