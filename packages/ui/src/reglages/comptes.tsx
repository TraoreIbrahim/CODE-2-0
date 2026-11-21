import { useEffect, useState, type FormEvent } from 'react'
import { BRIEFING_NOMS, CLES_API, CLE_NOMS, FOURNISSEUR_INFOS, NOM_ASSISTANT_DEFAUT, PROFILS, PROFIL_DETAILS, PROFIL_NOMS, WIDGET_NOMS, cartesDuProfil, memesCartes, type CleApi } from '@code/protocol'
import type { Code } from '../hooks.ts'
import { FieldError, Label, Toggle, nomDe, registre } from './fields.tsx'

/**
 * Ce qui touche au compte : le nom de l'assistant et le profil, le coffre de clés API, l'identifiant et le
 * mot de passe, et pour le propriétaire les comptes de l'installation. Communs à l'assistant de premier
 * lancement et aux Réglages.
 */

type FieldProps = { code: Code }

export { nomDe }

// ── Nom de l'assistant et profil ─────────────────────────────────────────

const NOMS_PROPOSES = [NOM_ASSISTANT_DEFAUT, 'Aya', 'Iris', 'Max', 'Orion']

export function NomAssistantField({ code }: FieldProps) {
  const nom = nomDe(code)
  const [draft, setDraft] = useState(nom)
  useEffect(() => setDraft(nom), [nom])
  const save = (v: string) => {
    const clean = v.replace(/\s+/g, ' ').trim()
    if (clean && clean !== nom) code.client.setReglages({ nomAssistant: clean })
  }
  return (
    <div className="rg-field">
      <form
        className="rg-inline"
        onSubmit={(e) => {
          e.preventDefault()
          save(draft)
        }}
      >
        <input className="rg-input rg-input--nom" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => save(draft)} maxLength={24} aria-label="Nom de l’assistant" spellCheck={false} />
        <button type="submit" className="rg-mini" disabled={!draft.trim() || draft.trim() === nom}>
          OK
        </button>
      </form>
      <div className="rg-chips" role="radiogroup" aria-label="Noms proposés">
        {NOMS_PROPOSES.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={nom === n} className="rg-chip" onClick={() => save(n)}>
            {n}
          </button>
        ))}
      </div>
      <small className="rg-hint">C’est aussi le mot qui l’appelle : « {nom}, quels sont mes rendez-vous ? »</small>
      <FieldError code={code} field="nomAssistant" />
    </div>
  )
}

/** Les noms d'une liste, liés comme on les dit : « a, b et c ». */
const enMots = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}` : (l[0] ?? ''))

/**
 * Le profil, et ce qu'il change en clair : les outils sous la main, les cartes, le briefing du matin. Les
 * cartes suivent le profil tant que la personne ne les a pas rangées elle-même (serveur, `validateReglages`) ;
 * sinon, un bouton les reprend. En dessous, l'écran simplifié, pour un usage tout à la voix.
 */
export function ProfilField({ code }: FieldProps) {
  const u = code.state.utilisateur
  const profil = u?.reglages.profil ?? 'general'
  const d = PROFIL_DETAILS[profil]
  const t = registre(u)
  const cartes = d.cartes.filter((c) => c.visible).map((c) => WIDGET_NOMS[c.id].replace(/ \(.*\)$/, ''))
  const rangees = u ? !memesCartes(u.reglages.widgets, cartesDuProfil(profil)) : false
  const heure = u?.reglages.briefing.replace(/^0/, '').replace(':', ' h ')
  return (
    <div className="rg-field">
      <div className="rg-profils" role="radiogroup" aria-label="Profil">
        {PROFILS.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={profil === p} className="rg-profil" onClick={() => profil !== p && code.client.setReglages({ profil: p })}>
            <strong>{PROFIL_NOMS[p].nom}</strong>
            <span>{PROFIL_NOMS[p].description}</span>
          </button>
        ))}
      </div>
      <dl className="rg-profil-fiche" aria-live="polite" aria-label={`Ce que change le profil ${PROFIL_NOMS[profil].nom}`}>
        <div>
          <dt>Sous la main</dt>
          <dd>{d.outils}</dd>
        </div>
        <div>
          <dt>Cartes</dt>
          <dd>
            {cartes.join(' · ')}
            {rangees && (
              <span className="rg-profil-fiche__note">
                {t('Les vôtres sont rangées à votre façon.', 'Les tiennes sont rangées à ta façon.')}{' '}
                <button type="button" className="rg-link" onClick={() => code.client.setReglages({ widgets: cartesDuProfil(profil) })}>
                  Prendre celles du profil
                </button>
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Briefing{heure ? ` · ${heure.replace(/ h 00$/, ' h')}` : ''}</dt>
          <dd>{enMots(d.briefing.map((b) => BRIEFING_NOMS[b]))}</dd>
        </div>
      </dl>
      <FieldError code={code} field="profil" />
      <Toggle
        on={u?.reglages.ecranSimple ?? false}
        onChange={(v) => code.client.setReglages({ ecranSimple: v })}
        label="Écran simplifié"
        hint="Tout à la voix : l’orbe, l’heure et ce qui vient d’être dit, en grand. Ni cartes ni menus."
      />
    </div>
  )
}

// ── Coffre de clés API ───────────────────────────────────────────────────

/**
 * Une ligne par service : d'où vient la clé (la sienne, celle du serveur, aucune) et ses quatre derniers
 * caractères. La clé collée part une fois au serveur, qui la chiffre ; elle ne revient jamais à l'écran.
 */
export function ClesField({ code }: FieldProps) {
  const { cles, cleAction: action, connection, utilisateur } = code.state
  const [ouverte, setOuverte] = useState<CleApi | null>(null)
  const [valeur, setValeur] = useState('')
  const [confirm, setConfirm] = useState<CleApi | null>(null)
  const connected = connection === 'connecte'
  const t = registre(utilisateur)
  useEffect(() => {
    if (connected) code.client.requestCles()
  }, [connected, code.client])
  // Enregistrée : le formulaire se ferme et la clé quitte la mémoire de l'écran.
  useEffect(() => {
    if (action && !action.busy && action.ok) {
      setOuverte(null)
      setValeur('')
    }
  }, [action])
  if (!cles) return <p className="rg-note">Chargement…</p>
  // Une clé de moteur suffit pour répondre (Ollama, sans clé, se règle sur le serveur).
  const moteur = cles.some((c) => c.source && Object.values(FOURNISSEUR_INFOS).some((f) => f.cle === c.nom))
  const submit = (e: FormEvent, nom: CleApi) => {
    e.preventDefault()
    if (valeur.trim()) code.client.setCle(nom, valeur.trim())
  }
  return (
    <div className="rg-field rg-cles">
      {!moteur && (
        <p className="rg-note rg-cles__alerte">
          {t(
            'Sans clé d’un moteur, votre assistant ne peut pas répondre. Pour commencer : Anthropic, OpenAI, Gemini ou Mistral pour la conversation (à choisir ensuite dans Moteurs), OpenAI pour la voix.',
            'Sans clé d’un moteur, ton assistant ne peut pas répondre. Pour commencer : Anthropic, OpenAI, Gemini ou Mistral pour la conversation (à choisir ensuite dans Moteurs), OpenAI pour la voix.'
          )}
        </p>
      )}
      {CLES_API.map((nom) => {
        const c = cles.find((x) => x.nom === nom)
        const info = CLE_NOMS[nom]
        const enCours = action?.nom === nom && action.busy
        return (
          <div key={nom} className="rg-connect__item">
            <span className={`rg-connect__mark${c?.source ? ' is-on' : ''}`} aria-hidden="true">
              {info.nom.slice(0, 1)}
            </span>
            <span className="rg-connect__body">
              <strong>
                {info.nom}{' '}
                <em className="rg-dev__etat code-mono">
                  · {c?.source === 'coffre' ? `•••• ${c.fin}` : c?.source === 'serveur' ? 'CLÉ DU SERVEUR' : 'AUCUNE'}
                </em>
              </strong>
              <small>{info.usage}</small>
              {ouverte === nom && (
                <form className="rg-connect__complement" autoComplete="off" onSubmit={(e) => submit(e, nom)}>
                  <small>
                    Collez la clé telle que {info.nom} la donne.{' '}
                    <a href={info.ou} target="_blank" rel="noreferrer">
                      Créer une clé
                    </a>
                  </small>
                  <input className="rg-input" type="password" value={valeur} onChange={(e) => setValeur(e.target.value)} placeholder={nom} autoComplete="new-password" spellCheck={false} aria-label={`Clé ${info.nom}`} autoFocus />
                  <span className="rg-row">
                    <button type="submit" className="rg-mini" disabled={enCours || !valeur.trim() || !connected}>
                      {enCours ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                    <button type="button" className="rg-mini" onClick={() => (setOuverte(null), setValeur(''))}>
                      Annuler
                    </button>
                  </span>
                </form>
              )}
              {action?.nom === nom && !action.busy && action.message && (
                <small className={action.ok ? undefined : 'rg-error'} role="alert">
                  {action.message}
                </small>
              )}
            </span>
            {ouverte !== nom &&
              (confirm === nom ? (
                <span className="rg-row">
                  <button type="button" className="rg-mini rg-mini--warn" onClick={() => (code.client.setCle(nom, ''), setConfirm(null))}>
                    Retirer
                  </button>
                  <button type="button" className="rg-mini" onClick={() => setConfirm(null)}>
                    Garder
                  </button>
                </span>
              ) : (
                <span className="rg-row">
                  <button type="button" className="rg-mini" disabled={!connected} onClick={() => (setOuverte(nom), setValeur(''), setConfirm(null))}>
                    {c?.source === 'coffre' ? 'Remplacer' : 'Ajouter'}
                  </button>
                  {c?.source === 'coffre' && (
                    <button type="button" className="rg-mini" onClick={() => setConfirm(nom)} aria-label={`Retirer la clé ${info.nom}`}>
                      Retirer
                    </button>
                  )}
                </span>
              ))}
          </div>
        )
      })}
      <small className="rg-hint">
        {utilisateur?.proprietaire
          ? 'Chiffrées sur votre serveur, jamais affichées. Les clés du serveur (npm run secrets) ne servent qu’à vous ; les vôtres passent avant.'
          : 'Chiffrées sur le serveur, jamais affichées ni partagées : chaque compte utilise ses propres clés.'}
      </small>
    </div>
  )
}

// ── Prénom et nom ────────────────────────────────────────────────────────

/** Son prénom (obligatoire) et son nom : l'appellation et le récapitulatif s'en servent. */
export function NomPersonneField({ code }: FieldProps) {
  const u = code.state.utilisateur
  const action = code.state.compteAction
  const [prenom, setPrenom] = useState(u?.prenom ?? '')
  const [nom, setNom] = useState(u?.nom ?? '')
  useEffect(() => setPrenom(u?.prenom ?? ''), [u?.prenom])
  useEffect(() => setNom(u?.nom ?? ''), [u?.nom])
  if (!u) return null
  const save = () => {
    const p = prenom.replace(/\s+/g, ' ').trim()
    const n = nom.replace(/\s+/g, ' ').trim()
    if (p && (p !== u.prenom || n !== u.nom)) code.client.setNom(p, n)
  }
  const refus = action && !action.busy && !action.ok && (action.champ === 'prenom' || action.champ === 'nom') ? action.message : null
  return (
    <div className="rg-field rg-lieu">
      <label className="rg-lieu__col">
        <Label>Prénom</Label>
        <input className="rg-input" value={prenom} maxLength={40} autoComplete="given-name" onChange={(e) => setPrenom(e.target.value)} onBlur={save} />
      </label>
      <label className="rg-lieu__col">
        <Label>Nom (facultatif)</Label>
        <input className="rg-input" value={nom} maxLength={40} autoComplete="family-name" onChange={(e) => setNom(e.target.value)} onBlur={save} />
      </label>
      {refus && (
        <p className="rg-error" role="alert">
          {refus}
        </p>
      )}
    </div>
  )
}

// ── Identifiant et mot de passe ──────────────────────────────────────────

export function IdentifiantsField({ code }: FieldProps) {
  const u = code.state.utilisateur
  const action = code.state.compteAction
  const [identifiant, setIdentifiant] = useState(u?.identifiant ?? '')
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [ancien, setAncien] = useState('')
  const [ouvert, setOuvert] = useState(!u?.identifiant)
  useEffect(() => setIdentifiant(u?.identifiant ?? ''), [u?.identifiant])
  useEffect(() => () => code.client.oublierCompteAction(), [code.client])
  // Enregistré : les mots de passe quittent l'écran, le formulaire se referme.
  useEffect(() => {
    if (action && !action.busy && action.ok) {
      setMotDePasse('')
      setConfirmation('')
      setAncien('')
      setOuvert(false)
    }
  }, [action])
  if (!u) return null
  const differents = confirmation !== '' && confirmation !== motDePasse
  const pret = identifiant.trim().length >= 3 && motDePasse.length >= 8 && confirmation === motDePasse && (!u.identifiant || ancien !== '')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (pret && !action?.busy) code.client.setIdentifiants(identifiant.trim(), motDePasse, u.identifiant ? ancien : undefined)
  }
  if (!ouvert) {
    return (
      <div className="rg-field">
        <p className="st__account">
          <span className="code-mono">IDENTIFIANT</span>
          <strong>{u.identifiant}</strong>
        </p>
        {action?.ok && action.message && <small className="rg-hint">{action.message}</small>}
        <div className="rg-row">
          <button type="button" className="rg-mini" onClick={() => (code.client.oublierCompteAction(), setOuvert(true))}>
            Changer l’identifiant ou le mot de passe
          </button>
        </div>
      </div>
    )
  }
  const erreur = (champ: string) =>
    action && !action.busy && !action.ok && action.champ === champ ? (
      <small className="rg-error" role="alert">
        {action.message}
      </small>
    ) : null
  return (
    <form className="rg-field rg-boite-form" onSubmit={submit}>
      <label className="rg-boite-form__field">
        <span>Identifiant</span>
        <input className="rg-input" value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} autoComplete="username" autoCapitalize="off" spellCheck={false} maxLength={64} placeholder="prenom.nom" />
        {erreur('identifiant')}
      </label>
      {u.identifiant && (
        <label className="rg-boite-form__field">
          <span>Mot de passe actuel</span>
          <input className="rg-input" type="password" value={ancien} onChange={(e) => setAncien(e.target.value)} autoComplete="current-password" />
          {erreur('ancien')}
        </label>
      )}
      <label className="rg-boite-form__field">
        <span>{u.identifiant ? 'Nouveau mot de passe' : 'Mot de passe'} · 8 caractères au moins</span>
        <input className="rg-input" type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} autoComplete="new-password" />
        {erreur('motDePasse')}
      </label>
      <label className="rg-boite-form__field">
        <span>Confirmation</span>
        <input className="rg-input" type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="new-password" />
        {differents && <small className="rg-error">Les deux mots de passe diffèrent.</small>}
      </label>
      {action && !action.busy && !action.ok && !action.champ && (
        <p className="rg-error" role="alert">
          {action.message}
        </p>
      )}
      <div className="rg-row">
        <button type="submit" className="rg-mini" disabled={!pret || action?.busy || code.state.connection !== 'connecte'}>
          {action?.busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {u.identifiant && (
          <button type="button" className="rg-link" onClick={() => setOuvert(false)}>
            Annuler
          </button>
        )}
      </div>
      <small className="rg-hint">Pour vous connecter depuis un autre appareil. Le mot de passe n’est jamais gardé en clair.</small>
    </form>
  )
}

// ── Comptes de l'installation (propriétaire) ─────────────────────────────

const date = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })

/**
 * Les personnes qui utilisent ce serveur : chacune a son compte, ses données, ses clés. Le propriétaire invite
 * (un code valable sept jours), désactive ou réactive un compte ; il ne voit jamais leurs données.
 */
export function ComptesField({ code }: FieldProps) {
  const { comptes, invitations, invitationCreee: creee, connection } = code.state
  const [prenom, setPrenom] = useState('')
  const [confirm, setConfirm] = useState<number | null>(null)
  const [copie, setCopie] = useState(false)
  const connected = connection === 'connecte'
  useEffect(() => {
    if (connected) code.client.requestComptes()
  }, [connected, code.client])
  useEffect(() => () => code.client.oublierInvitation(), [code.client])
  if (!comptes) return <p className="rg-note">Chargement…</p>
  const copier = (texte: string) => {
    void navigator.clipboard?.writeText(texte).then(() => {
      setCopie(true)
      setTimeout(() => setCopie(false), 2000)
    })
  }
  return (
    <div className="rg-field rg-comptes">
      <ul className="st-devices">
        {comptes.map((c) => (
          <li key={c.id} className={c.proprietaire ? 'is-current' : c.actif ? '' : 'is-off'}>
            <span className="rg-connect__mark is-on" aria-hidden="true">
              {(c.prenom || c.identifiant || '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="st-devices__text">
              <strong>{[c.prenom, c.nom].filter(Boolean).join(' ') || c.identifiant || `Compte ${c.id}`}</strong>
              <small className="code-mono">
                {c.proprietaire ? 'PROPRIÉTAIRE' : c.actif ? 'MEMBRE' : 'DÉSACTIVÉ'}
                {c.identifiant ? ` · ${c.identifiant.toUpperCase()}` : ''}
              </small>
            </span>
            {!c.proprietaire &&
              (confirm === c.id ? (
                <span className="rg-row">
                  <button type="button" className="rg-mini rg-mini--warn" onClick={() => (code.client.setCompteActif(c.id, false), setConfirm(null))}>
                    Désactiver
                  </button>
                  <button type="button" className="rg-link" onClick={() => setConfirm(null)}>
                    Annuler
                  </button>
                </span>
              ) : c.actif ? (
                <button type="button" className="rg-mini" onClick={() => setConfirm(c.id)}>
                  Désactiver
                </button>
              ) : (
                <button type="button" className="rg-mini" onClick={() => code.client.setCompteActif(c.id, true)}>
                  Réactiver
                </button>
              ))}
          </li>
        ))}
      </ul>

      {creee ? (
        <div className="rg-invitation" role="status">
          <small className="code-mono">INVITATION POUR {creee.prenom.toUpperCase()}</small>
          <b className="rg-invitation__code code-mono">{creee.code}</b>
          <p className="rg-note">
            {creee.url ? 'Envoyez-lui ce lien : il ouvre la création de son compte.' : 'Donnez-lui ce code : il le saisit sur l’écran de connexion, à « J’ai une invitation ».'} Valable jusqu’au {date(creee.expire)}, une seule fois.
          </p>
          <div className="rg-row">
            <button type="button" className="rg-mini" onClick={() => copier(creee.url ?? creee.code)}>
              {copie ? 'Copié' : creee.url ? 'Copier le lien' : 'Copier le code'}
            </button>
            <button type="button" className="rg-link" onClick={() => code.client.oublierInvitation()}>
              Fermer
            </button>
          </div>
        </div>
      ) : (
        <form
          className="rg-inline"
          onSubmit={(e) => {
            e.preventDefault()
            if (prenom.trim()) code.client.inviter(prenom.trim())
            setPrenom('')
          }}
        >
          <input className="rg-input" value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder="Prénom de la personne" maxLength={40} aria-label="Prénom de la personne à inviter" />
          <button type="submit" className="rg-mini" disabled={!prenom.trim() || !connected}>
            Inviter
          </button>
        </form>
      )}

      {invitations.length > 0 && (
        <>
          <Label>Invitations en attente</Label>
          <ul className="rg-invitations">
            {invitations.map((i) => (
              <li key={i.id}>
                <span>{i.prenom}</span>
                <small className="code-mono">JUSQU’AU {date(i.expire).toUpperCase()}</small>
                <button type="button" className="rg-link" onClick={() => code.client.annulerInvitation(i.id)}>
                  Annuler
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <small className="rg-hint">Chaque compte a ses propres données et ses propres clés API ; vous ne voyez que sa consommation.</small>
    </div>
  )
}
