import { useEffect, useRef, useState } from 'react'
import type { Code } from './hooks.ts'

/**
 * Le bandeau d'une réunion sur cet appareil : pendant l'enregistrement, le temps écoulé, le témoin du micro
 * et « Terminer » ; ensuite l'envoi des derniers morceaux. Sans enregistrement ici, il montre la transcription
 * en cours côté serveur, puis disparaît. Tant qu'il est rouge, tout ce qui se dit est enregistré.
 */

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
  return `${h ? `${h}:` : ''}${m}:${String(s % 60).padStart(2, '0')}`
}

const BARRES = 5

/** Le témoin du micro : cinq barres qui suivent le volume, lues à chaque image sans passer par l'état. */
function Niveau({ client }: { client: Code['client'] }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let image = 0
    let lisse = 0
    const tick = () => {
      lisse = Math.max(client.niveauReunion(), lisse * 0.86)
      ref.current?.querySelectorAll('i').forEach((b, k) => {
        const seuil = (k + 0.5) / BARRES
        ;(b as HTMLElement).style.transform = `scaleY(${Math.max(0.18, Math.min(1, lisse / seuil))})`
      })
      image = requestAnimationFrame(tick)
    }
    image = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(image)
  }, [client])
  return (
    <span className="reub-niveau" ref={ref} aria-hidden="true">
      {Array.from({ length: BARRES }, (_, k) => (
        <i key={k} />
      ))}
    </span>
  )
}

function Bandeau({ code }: { code: Code }) {
  const { state, client } = code
  const r = state.reunion
  const [, setTic] = useState(0)
  const [abandon, setAbandon] = useState(false)
  const enCours = r?.etat === 'enregistrement'
  useEffect(() => {
    if (!enCours) return
    const t = setInterval(() => setTic((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [enCours])
  useEffect(() => setAbandon(false), [r?.etat])

  const proposee = state.reunionProposee
  if (!r && proposee) {
    return (
      <div className="reub reub--proposition" role="alertdialog" aria-label={`Enregistrer la réunion ${proposee.titre} ?`}>
        <span className="reub-point" aria-hidden="true" />
        <span className="reub-texte">
          <strong>{proposee.titre}</strong>
          <small>
            {proposee.heure}
            {proposee.service ? ` · ${proposee.service}` : ''} · l’enregistrer ? Prévenez les participants.
          </small>
        </span>
        <button type="button" className="reub-bouton reub-bouton--fin" onClick={() => client.repondreReunionProposee(true)}>
          Enregistrer
        </button>
        <button type="button" className="reub-bouton" onClick={() => client.repondreReunionProposee(false)}>
          Non
        </button>
      </div>
    )
  }

  if (!r) {
    // Rien ici : la transcription qui se termine sur le serveur, s'il y en a une.
    const t = (state.reunions ?? []).find((x) => x.etat === 'transcription')
    if (!t) return null
    const p = t.progression
    return (
      <div className="reub reub--transcription" role="status">
        <span className="reub-point" aria-hidden="true" />
        <span className="reub-texte">
          <strong>Transcription de la réunion</strong>
          <small className="code-mono">{p && p.recus ? `${p.transcrits} / ${p.recus}` : '…'}</small>
        </span>
      </div>
    )
  }

  if (r.etat === 'erreur') {
    return (
      <div className="reub reub--erreur" role="alert">
        <span className="reub-texte">
          <strong>{r.source === 'fichier' ? 'Import impossible' : 'Enregistrement impossible'}</strong>
          <small>{r.erreur}</small>
        </span>
        <button type="button" className="reub-bouton" onClick={() => client.annulerReunion()}>
          Fermer
        </button>
      </div>
    )
  }

  // La pause est tenue par le serveur : tous les écrans (bandeau, miniature, téléphone) montrent le même état.
  const enPause = enCours && !!r.id && !!(state.reunions ?? []).find((x) => x.id === r.id)?.enPause
  const reste = r.decoupes - r.envoyes
  const titre =
    r.etat === 'ouverture' ? (r.source === 'fichier' ? 'Ouverture du fichier…' : 'Ouverture du micro…') : r.etat === 'preparation' ? 'Lecture du fichier…' : r.etat === 'envoi' ? 'Envoi de l’enregistrement…' : 'Réunion enregistrée'
  return (
    <div className={`reub reub--${r.etat}${enPause ? ' reub--pause' : ''}`} role="status" aria-label={enPause ? 'Enregistrement de la réunion en pause' : enCours ? 'Enregistrement de la réunion en cours' : titre}>
      <span className="reub-point" aria-hidden="true" />
      <span className="reub-texte">
        <strong>
          {enCours ? (
            <>
              <span className="reub-rec code-mono">{enPause ? 'PAUSE' : 'REC'}</span> <time className="code-mono">{mmss(Date.now() - r.debut)}</time>
            </>
          ) : (
            titre
          )}
        </strong>
        <small>
          {enPause
            ? 'Rien n’est capté jusqu’à la reprise.'
            : r.enAttente
            ? 'Connexion perdue : l’envoi reprendra tout seul, rien n’est perdu.'
            : enCours && r.son === 'micro'
              ? 'Micro seul : le son de l’ordinateur n’est pas capté. Autorisez l’app dans Réglages Système › Confidentialité › Enregistrement de l’écran et de l’audio système, puis relancez-la.'
              : enCours && r.son
                ? `Micro et son de l’ordinateur${r.service ? ` · transcrite par ${r.service}` : ''}.`
            : enCours
              ? r.service
                ? `Transcrite au fur et à mesure par ${r.service}${r.tarif ? `, environ ${(r.tarif * 100).toFixed(0)} centimes de dollar l’heure` : ''}.`
                : r.titre
              : r.etat === 'envoi' || r.etat === 'preparation'
                ? r.decoupes
                  ? `${r.envoyes} morceau${r.envoyes > 1 ? 'x' : ''} sur ${r.decoupes}${reste > 0 ? '' : ' : terminé'}`
                  : r.titre
                : r.titre}
        </small>
      </span>
      {enCours && !enPause && <Niveau client={client} />}
      {enCours && r.id && (
        <button type="button" className="reub-pause" onClick={() => client.pauseReunion(r.id!, !enPause)} aria-label={enPause ? 'Reprendre l’enregistrement' : 'Mettre l’enregistrement en pause'} title={enPause ? 'Reprendre' : 'Pause'}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            {enPause ? <path d="M8 5.5v13l11-6.5z" /> : <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />}
          </svg>
        </button>
      )}
      {enCours && (
        <button type="button" className="reub-bouton reub-bouton--fin" onClick={() => client.arreterReunion()}>
          Terminer
        </button>
      )}
      {abandon ? (
        <>
          <button type="button" className="reub-bouton reub-bouton--alerte" onClick={() => client.annulerReunion()}>
            Tout effacer
          </button>
          <button type="button" className="reub-bouton" onClick={() => setAbandon(false)}>
            Garder
          </button>
        </>
      ) : (
        <button type="button" className="reub-fermer" onClick={() => setAbandon(true)} aria-label={enCours ? 'Abandonner l’enregistrement' : 'Abandonner l’envoi'}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  )
}

/** Le bandeau, ancré en haut de l'écran (rien s'il n'y a ni enregistrement ni transcription en cours). */
export function ReunionBarre({ code }: { code: Code }) {
  const { reunion, reunions, reunionProposee } = code.state
  if (!reunion && !reunionProposee && !(reunions ?? []).some((r) => r.etat === 'transcription')) return null
  return (
    <div className="reub-ancre">
      <Bandeau code={code} />
    </div>
  )
}

/** Le bouton qui lance un enregistrement (à poser dans l'en-tête ou la barre d'un écran). */
export function BoutonReunion({ code, className, avecTexte = false }: { code: Code; className?: string; avecTexte?: boolean }) {
  const { state, client } = code
  const occupe = !!state.reunion && state.reunion.etat !== 'erreur'
  return (
    <button
      type="button"
      className={className}
      disabled={occupe || state.connection !== 'connecte'}
      onClick={() => client.demarrerReunion()}
      aria-label="Enregistrer une réunion : elle sera transcrite, puis résumée à la demande"
      title="Enregistrer une réunion"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
      </svg>
      {avecTexte && <span>Réunion</span>}
    </button>
  )
}
