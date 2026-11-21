import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { nomDe, type Code } from '@code/ui'
import { bridge } from './config.ts'

/** Étapes affichées quand Tailscale n'est pas prêt, dans l'ordre où on les rencontre. */
const STEPS: Record<string, { titre: string; texte: string }> = {
  sans_tailscale: { titre: 'Installer Tailscale', texte: 'Installez Tailscale sur cet ordinateur et sur le téléphone, puis connectez-vous avec le même compte.' },
  deconnecte: { titre: 'Connecter Tailscale', texte: 'Ouvrez l’app Tailscale sur cet ordinateur et connectez-vous.' },
  sans_https: { titre: 'Activer HTTPS', texte: 'Dans la console Tailscale, onglet DNS : activez MagicDNS, puis HTTPS Certificates. Le téléphone a besoin de HTTPS pour le micro.' },
  sans_serve: { titre: 'Publier le serveur', texte: 'Lancez cette commande sur l’ordinateur du serveur, une seule fois : il devient joignable par vos appareils Tailscale, et par eux seuls.' }
}

/** Code à usage unique du lien (`#p=…`), affiché en groupes de cinq pour être recopié. */
const pairCodeOf = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get('p') ?? ''

/** Associer un téléphone : QR code du lien d'association, ou l'étape Tailscale qui manque ; les appareils reliés. */
export function PairDialog({ code, onClose }: { code: Code; onClose: () => void }) {
  const { state, client } = code
  const info = state.pair
  const [svg, setSvg] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [copyError, setCopyError] = useState(false)

  useEffect(() => {
    client.requestPair()
    client.requestDevices()
  }, [client])

  useEffect(() => {
    if (!info?.url) return setSvg('')
    // Modules sombres sur fond clair : lisible par tous les appareils photo.
    void QRCode.toString(info.url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#04070bff', light: '#e6f4faff' } }).then(setSvg)
  }, [info?.url])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = (what: string, text: string) => {
    setCopyError(false)
    bridge.copyText(text).then(
      () => {
        setCopied(what)
        setTimeout(() => setCopied(null), 2500)
      },
      () => setCopyError(true)
    )
  }
  const step = info && info.status !== 'pret' ? STEPS[info.status] : null

  return (
    <div className="pair-overlay" onClick={onClose}>
      <section className="pair-dialog" role="dialog" aria-modal="true" aria-labelledby="pair-title" onClick={(e) => e.stopPropagation()}>
        <header className="pair-dialog__head">
          <span className="pair-dialog__kicker">Associer un téléphone</span>
          <h2 id="pair-title">{nomDe(code)} sur votre téléphone</h2>
          <button type="button" className="code-icon-btn pair-dialog__close" aria-label="Fermer" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        {!info && <p className="pair-dialog__text">Vérification de Tailscale…</p>}

        {info?.status === 'pret' && (
          <div className="pair-dialog__ready">
            <div className="pair-qr" aria-label="QR code d’association" role="img" dangerouslySetInnerHTML={{ __html: svg }} />
            <ol className="pair-dialog__steps">
              <li>Ouvrez l’appareil photo du téléphone et visez le code.</li>
              <li>Touchez le lien : {nomDe(code)} s’ouvre dans le navigateur et s’associe tout seul, à votre compte.</li>
              <li>
                Pour l’avoir comme une app : Partager, puis « Sur l’écran d’accueil ». Sur iPhone, cette app ne voit pas ce que Safari a retenu : à sa première ouverture, connectez-vous ou touchez « J’ai un code d’association » et saisissez le code ci-dessous.
              </li>
            </ol>
            <p className="pair-dialog__code code-mono" aria-label="Code d’association">
              {pairCodeOf(info.url!).replace(/(.{5})(?=.)/g, '$1 ')}
            </p>
            <div className="pair-dialog__actions">
              <button type="button" className="code-btn code-btn--ghost" onClick={() => copy('code', pairCodeOf(info.url!))}>
                {copied === 'code' ? 'Code copié ✓' : 'Copier le code'}
              </button>
              <button type="button" className="code-btn code-btn--ghost" onClick={() => copy('lien', info.url!)}>
                {copied === 'lien' ? 'Lien copié ✓' : 'Copier le lien'}
              </button>
            </div>
            {copied && (
              <p className="pair-dialog__text pair-dialog__hint" role="status">
                Entre un Mac et un iPhone sur le même compte Apple, le presse-papiers passe de l’un à l’autre (Wi-Fi, Bluetooth et Handoff activés).
              </p>
            )}
            {copyError && <p className="pair-dialog__warn" role="alert">La copie a échoué : réessayez.</p>}
            <p className="pair-dialog__host code-mono">{info.host}</p>
            <p className="pair-dialog__warn">Ce code ouvre votre assistant, une seule fois, pendant dix minutes : ne le montrez qu’à vos propres appareils. Il faut que le téléphone soit connecté à Tailscale.</p>
          </div>
        )}

        {step && (
          <div className="pair-dialog__todo">
            <span className="pair-dialog__step">{step.titre.toUpperCase()}</span>
            <p className="pair-dialog__text">{step.texte}</p>
            {info?.command && (
              <div className="pair-cmd">
                <code>{info.command}</code>
                <button type="button" className="code-btn code-btn--ghost" onClick={() => copy('commande', info.command!)}>
                  {copied === 'commande' ? 'Copiée ✓' : 'Copier'}
                </button>
              </div>
            )}
            {info?.host && <p className="pair-dialog__host code-mono">{info.host}</p>}
          </div>
        )}

        {state.appareils && state.appareils.length > 0 && (
          <div className="pair-devices">
            <span className="pair-dialog__step">Appareils reliés</span>
            <ul>
              {state.appareils.map((d) => (
                <li key={d.id}>
                  <strong>{d.nom}</strong>
                  <small className="code-mono">{d.id === state.appareilId ? 'CET APPAREIL' : d.vuLe ? `VU ${new Date(d.vuLe).toLocaleDateString('fr-FR')}` : 'JAMAIS VU'}</small>
                  {d.id !== state.appareilId && (
                    <button type="button" className="code-btn code-btn--ghost" onClick={() => client.revokeDevice(d.id)}>
                      Retirer
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <footer className="pair-dialog__foot">
          <button type="button" className="code-btn code-btn--ghost" onClick={() => client.requestPair()}>
            Vérifier à nouveau
          </button>
        </footer>
      </section>
    </div>
  )
}
