import { useMemo, type CSSProperties } from 'react'
import type { ConfirmRequest } from '@code/protocol'
import { useCountdown } from './hooks.ts'

type Props = {
  request: ConfirmRequest
  onConfirm: () => void
  onCancel: () => void
  /** `ligne` : sous l'orbe du Mac, plus large ; `pile` : téléphone et miniature. Même ordre de lecture. */
  layout?: 'pile' | 'ligne'
}

/** Les lignes « À … », « Depuis … », « Objet : … » d'un résumé : le cadre de l'action, pas son contenu. */
const META = /^(?:à|a|depuis|de|objet|cc|pour)(?=\s|\s*:)/i

/** Le résumé en deux parties : le cadre (destinataire, objet) et le contenu (le message), mis à part. */
export function splitSummary(summary: string): { meta: string[]; body: string } {
  const lines = summary.split('\n').map((l) => l.trim()).filter(Boolean)
  const meta: string[] = []
  while (lines.length > 1 && META.test(lines[0]!)) meta.push(lines.shift()!)
  return { meta, body: lines.join('\n') }
}

/** Carte ambre d'une action sensible en attente de « oui » (spec 6.2). */
export function ConfirmCard({ request, onConfirm, onCancel, layout = 'pile' }: Props) {
  const left = useCountdown(request.expiresAt)
  const { meta, body } = splitSummary(request.summary)
  // Durée restante à l'affichage de cette action-là, une fois (le filet se vide en CSS, sans saccade).
  const remaining = useMemo(() => Math.max(0, request.expiresAt - Date.now()), [request.actionId, request.expiresAt])
  return (
    <section className={`code-confirm code-confirm--${layout}`} aria-live="polite" aria-label="Action à valider">
      <div className="code-confirm__head">
        <svg className="code-confirm__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M12 3 2 20h20L12 3z" />
          <path d="M12 10v4M12 17v.5" />
        </svg>
        <span className="code-mono code-confirm__tag">ACTION À VALIDER</span>
        <span className="code-mono code-confirm__left" aria-label={`${left} secondes pour répondre`}>
          {left} s
        </span>
      </div>
      <strong className="code-confirm__title">{request.title}</strong>
      {meta.length > 0 && (
        <ul className="code-confirm__meta">
          {meta.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {body && <p className={meta.length ? 'code-confirm__quote' : 'code-confirm__summary'}>{body}</p>}
      <div className="code-confirm__foot">
        <span className="code-confirm__hint">Ou dites « oui » ou « je valide ». Sans réponse claire, rien ne part.</span>
        <div className="code-confirm__actions">
          <button type="button" className="code-btn code-btn--ambre-ghost" onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="code-btn code-btn--ambre" onClick={onConfirm}>
            Valider
          </button>
        </div>
      </div>
      {/* Le temps qui reste, en filet sous la carte. */}
      <span key={request.actionId} className="code-confirm__timer" style={{ '--ms': `${remaining}ms` } as CSSProperties} aria-hidden="true" />
    </section>
  )
}
