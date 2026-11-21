import { useState, type FormEvent, type ReactNode } from 'react'
import type { AuthState } from './client.ts'
import { Orb } from './Orb.tsx'

type Props = {
  auth: AuthState
  /** Connexion à un compte de l'installation : identifiant et mot de passe, envoyés une fois. */
  onLogin: (identifiant: string, motDePasse: string) => void
  /** Association par le code du QR affiché sur un appareil déjà connecté (absent : pas proposé). */
  onPair?: (code: string) => void
  /** Création d'un compte avec l'invitation du propriétaire (absent : pas proposé). */
  onInvitation?: (code: string, prenom: string, identifiant: string, motDePasse: string) => void
  /** Code d'invitation apporté par un lien (`#i=…`) : l'écran s'ouvre sur la création du compte. */
  invitation?: string | null
  /** Ligne sous le titre (ex. « Avec votre compte »). */
  intro?: ReactNode
  /** Bouton secondaire (ex. « Plus tard » quand le compte est déjà ouvert). */
  extra?: ReactNode
  /** Mise en page : plein écran (mobile) ou panneau compact (fenêtre du Mac). */
  compact?: boolean
  /** Seulement le formulaire, sans orbe ni titre : dans un écran qui a déjà les siens (assistant de premier lancement). */
  bare?: boolean
}

/** Un identifiant qui ressemble à un numéro : clavier numérique et autocomplétion « tel ». */
const looksLikePhone = (v: string) => /^[+\d][\d\s.-]*$/.test(v.trim()) && v.replace(/\D/g, '').length >= 4

/**
 * Écran de connexion commun à l'ordinateur et au téléphone : le compte de la personne ouvre son assistant
 * à elle. Le mot de passe ne reste pas ici : il part au serveur, qui renvoie le jeton de l'appareil.
 */
export function Login({ auth, onLogin, onPair, onInvitation, invitation, intro, extra, compact = false, bare = false }: Props) {
  const [mode, setMode] = useState<'compte' | 'code' | 'invitation'>(invitation && onInvitation ? 'invitation' : 'compte')
  const [identifiant, setIdentifiant] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [code, setCode] = useState('')
  const [invite, setInvite] = useState({ code: invitation ?? '', prenom: '' })
  const [voir, setVoir] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (auth.busy) return
    if (mode === 'code') {
      const c = code.replace(/[^a-z0-9]/gi, '')
      if (c) onPair?.(c)
      return
    }
    if (mode === 'invitation') {
      if (!invite.code.trim() || !invite.prenom.trim() || !identifiant.trim() || motDePasse.length < 8) return
      onInvitation?.(invite.code.trim(), invite.prenom.trim(), identifiant.trim(), motDePasse)
      return
    }
    if (!identifiant.trim() || !motDePasse) return
    onLogin(identifiant.trim(), motDePasse)
    // Le mot de passe n'a plus rien à faire à l'écran une fois envoyé.
    setMotDePasse('')
  }

  const phone = looksLikePhone(identifiant)
  const ready =
    mode === 'code'
      ? code.replace(/[^a-z0-9]/gi, '').length >= 6
      : mode === 'invitation'
        ? invite.code.replace(/[^a-z0-9]/gi, '').length >= 12 && invite.prenom.trim() !== '' && identifiant.trim().length >= 3 && motDePasse.length >= 8
        : identifiant.trim() !== '' && motDePasse !== ''
  /** Le champ refusé par le serveur (invitation) : souligné jusqu'à la prochaine saisie. */
  const fautif = (champ: string) => (auth.error?.champ === champ ? ' login__input--error' : '')
  const titre = mode === 'code' ? 'Associer cet appareil' : mode === 'invitation' ? 'Créer votre compte' : 'Connexion'
  const intro2 =
    mode === 'code'
      ? 'Sur l’ordinateur, cliquez sur « Associer un téléphone » et saisissez le code affiché sous le QR.'
      : mode === 'invitation'
        ? 'Avec le code d’invitation reçu. Votre assistant, vos données et vos clés : rien qu’à vous.'
        : (intro ?? 'Avec votre compte.')

  const form = (
    <form className={`login__panel${bare ? ' login__panel--bare' : ''}`} onSubmit={submit} aria-busy={auth.busy} noValidate>
      {!bare && (
        <>
          <span className="login__marque">code</span>
          <h1 className="login__title">{titre}</h1>
          <p className="login__intro">{intro2}</p>
        </>
      )}

      {mode === 'invitation' && (
        <>
          <label className="login__field">
            <span className="login__label">Code d’invitation</span>
            <input
              className="login__input login__input--code"
              name="invitation"
              value={invite.code}
              onChange={(e) => setInvite({ ...invite, code: e.target.value.toUpperCase() })}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={16}
              disabled={auth.busy}
              autoFocus={!invitation}
            />
          </label>
          <label className="login__field">
            <span className="login__label">Votre prénom</span>
            <input
              className={`login__input${fautif('prenom')}`}
              name="prenom"
              value={invite.prenom}
              onChange={(e) => setInvite({ ...invite, prenom: e.target.value })}
              autoComplete="given-name"
              maxLength={40}
              disabled={auth.busy}
              autoFocus={!!invitation}
            />
          </label>
        </>
      )}

      {mode !== 'code' ? (
        <>
          <label className="login__field">
            <span className="login__label">{mode === 'invitation' ? 'Identifiant choisi' : 'Identifiant'}</span>
            <input
              className={`login__input${fautif('identifiant')}`}
              name="identifiant"
              value={identifiant}
              onChange={(e) => setIdentifiant(e.target.value)}
              autoComplete="username"
              inputMode={phone ? 'tel' : 'email'}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={auth.busy}
              autoFocus={mode === 'compte'}
            />
          </label>
          <label className="login__field">
            <span className="login__label">{mode === 'invitation' ? 'Mot de passe · 8 caractères au moins' : 'Mot de passe'}</span>
            <span className="login__secret">
              <input
                className={`login__input${fautif('motDePasse')}`}
                name="motDePasse"
                type={voir ? 'text' : 'password'}
                value={motDePasse}
                onChange={(e) => setMotDePasse(e.target.value)}
                autoComplete={mode === 'invitation' ? 'new-password' : 'current-password'}
                disabled={auth.busy}
              />
              <button type="button" className="login__reveal" onClick={() => setVoir((v) => !v)} aria-pressed={voir} aria-label={voir ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
                {voir ? 'Masquer' : 'Voir'}
              </button>
            </span>
          </label>
        </>
      ) : (
        <label className="login__field">
          <span className="login__label">Code d’association</span>
          <input
            className="login__input login__input--code"
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={14}
            disabled={auth.busy}
            autoFocus
          />
        </label>
      )}

      {auth.error && (
        <p className="login__error" role="alert">
          {auth.error.message}
        </p>
      )}

      <button type="submit" className="login__submit" disabled={!ready || auth.busy}>
        <span>
          {auth.busy
            ? mode === 'code'
              ? 'Association…'
              : mode === 'invitation'
                ? 'Création…'
                : 'Vérification…'
            : mode === 'code'
              ? 'Associer'
              : mode === 'invitation'
                ? 'Créer mon compte'
                : 'Se connecter'}
        </span>
      </button>

      <div className="login__foot">
        {mode !== 'compte' && (
          <button type="button" className="login__switch" onClick={() => setMode('compte')} disabled={auth.busy}>
            Se connecter avec son compte
          </button>
        )}
        {onPair && mode !== 'code' && (
          <button type="button" className="login__switch" onClick={() => setMode('code')} disabled={auth.busy}>
            J’ai un code d’association
          </button>
        )}
        {onInvitation && mode !== 'invitation' && (
          <button type="button" className="login__switch" onClick={() => setMode('invitation')} disabled={auth.busy}>
            J’ai une invitation
          </button>
        )}
        {extra}
      </div>
      <p className="login__note">Le mot de passe n’est pas gardé · seul cet appareil est relié</p>
    </form>
  )
  if (bare) return form
  return (
    <div className={`login${compact ? ' login--compact' : ''}`}>
      <div className="login__halo" aria-hidden="true">
        <Orb mode={auth.busy ? 'reflexion' : 'repos'} size={compact ? 150 : 170} />
      </div>
      {form}
    </div>
  )
}
