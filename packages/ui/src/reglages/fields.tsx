import { useEffect, useState, type ReactNode } from 'react'
import { NOM_ASSISTANT_DEFAUT, ORBES, PLAFONDS_JOUR, THEMES, VITESSE_VOIX, WIDGET_NOMS, type ConnecteurInfo, type Reglages, type OrbeId, type ThemeId, type UtilisateurInfo, type WidgetPlace } from '@code/protocol'
import type { Code } from '../hooks.ts'
import { Orb, type OrbMode } from '../Orb.tsx'
import { ORBE_NOMS } from '../orbes.ts'
import { BrandMark } from '../Logo.tsx'
import { paletteOf } from '../palette.ts'
import { GoogleGuide } from './google.tsx'

/**
 * Les réglages, champ par champ : communs à l'assistant de premier lancement et au panneau Réglages.
 * Chaque changement part aussitôt au serveur (`setReglages`) et s'affiche sur tous les appareils.
 */

type FieldProps = { code: Code }

/** Ce que dit CODE, au registre choisi : `t('vous', 'tu')`. */
export const registre = (u: UtilisateurInfo | null) => (vous: string, tu: string) => (u?.reglages.tutoiement ? tu : vous)

export const reglagesOf = (code: Code): Reglages | null => code.state.utilisateur?.reglages ?? null

/** Le message d'erreur du serveur pour ce champ, s'il a refusé le dernier changement. */
export function FieldError({ code, field }: FieldProps & { field: keyof Reglages }) {
  const msg = code.state.reglagesErreurs?.[field]
  return msg ? (
    <p className="rg-error" role="alert">
      {msg}
    </p>
  ) : null
}

/** Un libellé discret au-dessus d'un groupe de choix. */
export function Label({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="rg-label">
      <span>{children}</span>
      {aside}
    </div>
  )
}


/** Le nom de l'assistant tel que la personne l'a choisi (« Nova » tant qu'elle n'a rien changé). */
export const nomDe = (code: Code) => code.state.utilisateur?.reglages.nomAssistant || NOM_ASSISTANT_DEFAUT
// ── Appellation et registre ──────────────────────────────────────────────

export function AppellationField({ code }: FieldProps) {
  const u = code.state.utilisateur
  const current = u?.reglages.appellation ?? ''
  const nom = u?.nom || ''
  const prenom = u?.prenom || ''
  const suggestions = [...new Set([prenom, nom, nom && `Monsieur ${nom}`, nom && `Madame ${nom}`].filter(Boolean))]
  // La valeur affichée : l'appellation choisie, sinon le nom de famille (celui que CODE utilise par défaut).
  const shown = current || u?.appellation || ''
  const custom = !suggestions.includes(shown)
  const [draft, setDraft] = useState(custom ? shown : '')
  const [editing, setEditing] = useState(custom && shown !== '')
  useEffect(() => {
    if (custom) setDraft(shown)
  }, [shown, custom])
  const save = (v: string) => {
    const clean = v.replace(/\s+/g, ' ').trim()
    if (clean !== current) code.client.setReglages({ appellation: clean })
  }
  return (
    <div className="rg-field">
      <div className="rg-chips" role="radiogroup" aria-label="Appellation">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={shown === s && !editing}
            className="rg-chip"
            onClick={() => {
              setEditing(false)
              save(s)
            }}
          >
            {s}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={editing} className="rg-chip rg-chip--ghost" onClick={() => setEditing(true)}>
          Autre…
        </button>
      </div>
      {editing && (
        <form
          className="rg-inline"
          onSubmit={(e) => {
            e.preventDefault()
            save(draft)
          }}
        >
          <input
            className="rg-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => save(draft)}
            placeholder="Chef, Tonton Ibra…"
            maxLength={40}
            autoFocus
            aria-label="Appellation"
          />
          <button type="submit" className="rg-mini">
            OK
          </button>
        </form>
      )}
      <FieldError code={code} field="appellation" />
    </div>
  )
}

export function RegistreField({ code }: FieldProps) {
  const u = code.state.utilisateur
  const tu = u?.reglages.tutoiement ?? false
  const name = u?.reglages.appellation || u?.appellation || u?.prenom || ''
  return (
    <div className="rg-field">
      <div className="rg-duo" role="radiogroup" aria-label="Registre">
        {([false, true] as const).map((v) => (
          <button key={String(v)} type="button" role="radio" aria-checked={tu === v} className="rg-duo__opt" onClick={() => tu !== v && code.client.setReglages({ tutoiement: v })}>
            <strong>{v ? 'TU' : 'VOUS'}</strong>
            <span>{v ? 'Tutoiement' : 'Vouvoiement'}</span>
          </button>
        ))}
      </div>
      <p className="rg-quote" aria-live="polite" data-nom={nomDe(code)}>
        « {tu ? `${name}, tu veux que je te lise tes rappels du jour ?` : `${name}, voulez-vous que je vous lise vos rappels du jour ?`} »
      </p>
    </div>
  )
}

// ── Thème ────────────────────────────────────────────────────────────────

export function ThemeField({ code }: FieldProps) {
  const theme = reglagesOf(code)?.theme ?? 'cyan'
  return (
    <div className="rg-field">
      <div className="rg-themes" role="radiogroup" aria-label="Couleur principale">
        {THEMES.map((id) => {
          const p = paletteOf(id)
          return (
            <button key={id} type="button" role="radio" aria-checked={theme === id} className="rg-theme" style={{ ['--swatch' as string]: p.accent }} onClick={() => theme !== id && code.client.setReglages({ theme: id })}>
              <Orb mode={theme === id ? 'parole' : 'repos'} size={58} theme={id} label={p.nom} />
              <span>{p.nom}</span>
            </button>
          )
        })}
      </div>
      <FieldError code={code} field="theme" />
    </div>
  )
}

const ETATS_ORBE: [OrbMode, string][] = [
  ['repos', 'Veille'],
  ['ecoute', 'Écoute'],
  ['reflexion', 'Réflexion'],
  ['parole', 'Parole'],
  ['validation', 'Validation'],
  ['alerte', 'Alerte']
]

/** La forme de l'orbe : treize au choix, toutes aux couleurs du thème ; on les essaie dans chacun des six états. */
export function OrbeField({ code }: FieldProps) {
  const r = reglagesOf(code)
  const orbe: OrbeId = r?.orbe ?? 'nebule'
  const [etat, setEtat] = useState<OrbMode>('ecoute')
  return (
    <div className="rg-field">
      <div className="rg-chips rg-etats" role="radiogroup" aria-label="État montré">
        {ETATS_ORBE.map(([m, nom]) => (
          <button key={m} type="button" role="radio" aria-checked={etat === m} className="rg-chip" onClick={() => setEtat(m)}>
            {nom}
          </button>
        ))}
      </div>
      <div className="rg-orbes" role="radiogroup" aria-label="Forme de l’orbe">
        {ORBES.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={orbe === id} className="rg-orbe" title={ORBE_NOMS[id].desc} onClick={() => orbe !== id && code.client.setReglages({ orbe: id })}>
            <Orb mode={etat} size={56} forme={id} label={ORBE_NOMS[id].nom} />
            <span>{ORBE_NOMS[id].nom}</span>
          </button>
        ))}
      </div>
      <p className="rg-orbe__desc">{ORBE_NOMS[orbe].desc}</p>
      <FieldError code={code} field="orbe" />
    </div>
  )
}

/** Aperçu du thème appliqué : la marque et le nom de l'assistant, et un fragment d'interface (rappel, alerte, bouton). */
export function ThemePreview({ theme, nom = NOM_ASSISTANT_DEFAUT }: { theme: ThemeId; nom?: string }) {
  const p = paletteOf(theme)
  return (
    <div className="rg-preview" aria-label={`Aperçu du thème ${p.nom}`}>
      <div className="rg-preview__bar">
        <span className="code-logo">
          <BrandMark size={22} />
          <span className="code-brand code-logo__name">{nom}</span>
        </span>
        <span className="rg-preview__chip code-mono">
          <i /> EN LIGNE
        </span>
      </div>
      <div className="rg-preview__row">
        <span className="rg-preview__time code-mono">09:30</span>
        <span className="rg-preview__text">
          <strong>Appeler le chef de poste</strong>
          <small>Bellecour · dans 25 min</small>
        </span>
        <span className="rg-preview__btn">FAIT</span>
      </div>
      <div className="rg-preview__meter" aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} style={{ height: `${20 + Math.round(70 * Math.abs(Math.sin(i * 0.7 + 1)))}%` }} />
        ))}
      </div>
    </div>
  )
}

// ── Voix de CODE ─────────────────────────────────────────────────────────

const speedLabel = (v: number) => (v < 0.95 ? 'Posée' : v > 1.05 ? 'Vive' : 'Normale')
const num = (v: number) => v.toFixed(2).replace(/0$/, '').replace('.', ',')

export function VoixField({ code }: FieldProps) {
  const { state, voice, client } = code
  const r = reglagesOf(code)
  const [speed, setSpeed] = useState(r?.vitesseVoix ?? 1)
  useEffect(() => setSpeed(r?.vitesseVoix ?? 1), [r?.vitesseVoix])
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => {
    if (!code.status.playing) setPlaying(null)
  }, [code.status.playing])
  if (!r) return null
  // Les voix de son compte ElevenLabs d'abord (françaises, souvent) ; les voix de base ensuite.
  const compte = state.voixChoix.filter((v) => v.source === 'compte')
  const base = state.voixChoix.filter((v) => v.source !== 'compte')
  const groupes = [
    ...(compte.length ? [{ titre: 'Votre compte ElevenLabs', voix: compte }] : []),
    { titre: compte.length ? 'Voix de base (anglophones)' : 'Voix de base', voix: base }
  ]
  const listen = (id: string, v = speed) => {
    setPlaying(id)
    void voice.preview(id, v)
  }
  const commitSpeed = () => {
    if (speed === r.vitesseVoix) return
    client.setReglages({ vitesseVoix: speed })
    listen(r.voix, speed)
  }
  return (
    <div className="rg-field">
      {!state.synthese && <p className="rg-note">Pas encore de voix : ajoutez une clé ElevenLabs, OpenAI, Deepgram ou Gemini dans Clés API. D’ici là, les réponses sont écrites ; le choix sera gardé.</p>}
      {groupes.map((g) => (
        <div key={g.titre} className="rg-voices__groupe">
          {groupes.length > 1 && <Label>{g.titre}</Label>}
          <ul className="rg-voices" role="radiogroup" aria-label={`${g.titre} : voix de ${nomDe(code)}`}>
            {g.voix.map((v) => {
              const on = r.voix === v.id
              const live = playing === v.id && code.status.playing
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`rg-voice${live ? ' is-live' : ''}`}
                    onClick={() => {
                      if (!on) client.setReglages({ voix: v.id })
                      if (state.synthese) listen(v.id)
                    }}
                  >
                    <span className="rg-voice__wave" aria-hidden="true">
                      {Array.from({ length: 5 }, (_, i) => (
                        <span key={i} style={{ animationDelay: `${i * 110}ms` }} />
                      ))}
                    </span>
                    <span className="rg-voice__text">
                      <strong>{v.nom}</strong>
                      <small>{v.description}</small>
                    </span>
                    <span className="rg-voice__play code-mono">{live ? 'ÉCOUTE…' : state.synthese ? 'ÉCOUTER' : ''}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <Label aside={<span className="code-mono rg-value">{`${speedLabel(speed).toUpperCase()} · ×${num(speed)}`}</span>}>Vitesse</Label>
      <input
        className="rg-range"
        type="range"
        min={VITESSE_VOIX.min}
        max={VITESSE_VOIX.max}
        step={VITESSE_VOIX.pas}
        value={speed}
        aria-label="Vitesse de la voix"
        onChange={(e) => setSpeed(Number(e.target.value))}
        onPointerUp={commitSpeed}
        onKeyUp={commitSpeed}
        style={{ ['--fill' as string]: `${((speed - VITESSE_VOIX.min) / (VITESSE_VOIX.max - VITESSE_VOIX.min)) * 100}%` }}
      />
      <div className="rg-range__ticks code-mono" aria-hidden="true">
        <span>POSÉE</span>
        <span>NORMALE</span>
        <span>VIVE</span>
      </div>
      <FieldError code={code} field="voix" />
      <FieldError code={code} field="vitesseVoix" />
    </div>
  )
}

// ── Empreinte vocale ─────────────────────────────────────────────────────

/** Texte à lire pendant l'enregistrement : varié, naturel, avec des noms propres d'ici. */
export const enrollText = (nom: string, ville: string, assistant = NOM_ASSISTANT_DEFAUT) =>
  `Bonjour ${assistant}. Je m’appelle ${nom}, je travaille à ${ville}. Ce matin, j’ai rendez-vous avec Mme Martin à la mairie, puis je passe au bureau. ` +
  'Rappelle-moi d’appeler le fournisseur avant dix-huit heures, et prépare le briefing de demain. ' +
  'Quand je parle, c’est moi qui décide ; quand quelqu’un d’autre parle, tu ne l’écoutes pas.'

const APPAREILS: Record<string, string> = { mac: 'Mac', mobile: 'téléphone', ancien: 'première empreinte' }

/** « Empreintes : téléphone · Mac » : une par appareil, chacune comparée à son micro. */
export const voicePrintDevices = (appareils: string[]) =>
  appareils.length ? `Empreinte${appareils.length > 1 ? 's' : ''} : ${appareils.map((a) => APPAREILS[a] ?? a).join(' · ')}` : ''

/** L'enregistrement existant du cockpit (« VOTRE VOIX »), réutilisé tel quel : même message, même fin à 100 %. */
export function VoicePrintField({ code }: FieldProps) {
  const { state, voice, client } = code
  const { speaker, enroll, enrollMessage } = state
  const t = registre(state.utilisateur)
  const [confirmForget, setConfirmForget] = useState(false)
  if (!speaker.available) {
    return <p className="rg-note">La reconnaissance de voix n’est pas installée sur ce serveur (modèle absent). {nomDe(code)} écoute toute voix ; vous pourrez l’activer plus tard.</p>
  }
  if (enroll) {
    return (
      <div className="rg-field">
        <p className="rg-note">{t(`Lisez à voix haute, normalement, là où vous parlez d’habitude à ${nomDe(code)} (le bruit de fond aide)\u00a0:`, `Lis à voix haute, normalement, là où tu parles d’habitude à ${nomDe(code)} (le bruit de fond aide)\u00a0:`)}</p>
        <blockquote className="rg-read">{enrollText(state.utilisateur?.appellation ?? '…', state.utilisateur?.reglages.ville ?? '…', nomDe(code))}</blockquote>
        <div className="rg-progress" role="progressbar" aria-valuenow={enroll.percentage} aria-valuemin={0} aria-valuemax={100} aria-label="Progression de l’enregistrement">
          <span style={{ width: `${enroll.percentage}%` }} />
        </div>
        <div className="rg-row">
          <span className="code-mono rg-value">{enroll.percentage} %</span>
          <button type="button" className="rg-mini" onClick={() => void voice.cancelEnrollment()}>
            Annuler
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="rg-field">
      {enrollMessage && (
        <p className={`rg-status${enrollMessage.ok ? ' is-ok' : ' is-ko'}`} role="status">
          {enrollMessage.text}
        </p>
      )}
      {speaker.enrolled ? (
        <>
          <p className="rg-state is-ok">
            <i aria-hidden="true" />
            {t(`Votre voix est enregistrée : seule elle commande ${nomDe(code)}.`, `Ta voix est enregistrée : seule elle commande ${nomDe(code)}.`)}
          </p>
          <p className="rg-note">{voicePrintDevices(speaker.appareils)}</p>
          <div className="rg-row">
            <button type="button" className="rg-mini" onClick={() => void voice.startEnrollment()}>
              Enregistrer sur cet appareil
            </button>
            {confirmForget ? (
              <button type="button" className="rg-mini rg-mini--warn" onClick={() => (client.send({ type: 'speaker.reset' }), setConfirmForget(false))}>
                Confirmer l’oubli
              </button>
            ) : (
              <button type="button" className="rg-link" onClick={() => setConfirmForget(true)}>
                Oublier ma voix
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="rg-note">
            {t(
              `Trente secondes de lecture, et ${nomDe(code)} n’obéira qu’à vous : les autres voix de la pièce seront ignorées.`,
              `Trente secondes de lecture, et ${nomDe(code)} n’obéira qu’à toi : les autres voix de la pièce seront ignorées.`
            )}
          </p>
          <button type="button" className="rg-action" onClick={() => void voice.startEnrollment()} disabled={state.connection !== 'connecte'}>
            <span className="rg-action__dot" aria-hidden="true" />
            Enregistrer ma voix
          </button>
        </>
      )}
    </div>
  )
}

// ── Connecteurs ──────────────────────────────────────────────────────────

/** `device` : Google ne se connecte que depuis le Mac pour l'instant (la page s'ouvre sur le Mac du serveur). */
export function ConnecteursField({ code, device }: FieldProps & { device: 'mac' | 'mobile' }) {
  const { google, utilisateur } = code.state
  const [changer, setChanger] = useState(false)
  // Identifiants remplacés : le guide se referme.
  useEffect(() => {
    if (code.state.googleIdentifiants?.ok) setChanger(false)
  }, [code.state.googleIdentifiants?.ok])
  const services = [
    { id: 'gmail', nom: 'Gmail', on: google.gmail },
    { id: 'agenda', nom: 'Agenda', on: google.agenda },
    { id: 'drive', nom: 'Drive', on: google.drive }
  ]
  // Serveur sur l'ordinateur : Google revient sur une boucle locale, la connexion se fait depuis l'app de bureau.
  const peutConnecter = device === 'mac' || google.mode === 'heberge'
  const configure = google.etat !== 'non_configure'
  return (
    <div className="rg-field rg-connect">
      {!configure || changer ? (
        <GoogleGuide code={code} />
      ) : (
        <div className="rg-connect__item">
          <span className={`rg-connect__mark${google.etat === 'connecte' ? ' is-on' : ''}`} aria-hidden="true">
            G
          </span>
          <span className="rg-connect__body">
            <strong>Google</strong>
            <span className="rg-connect__services">
              {services.map((s) => (
                <span key={s.id} className={s.on ? 'is-on' : ''}>
                  <i aria-hidden="true" />
                  {s.nom}
                </span>
              ))}
            </span>
            {google.etat === 'connexion' ? (
              <small>
                {google.message}
                {google.url && (
                  <>
                    {' '}
                    <a href={google.url} target="_blank" rel="noreferrer">
                      Ouvrir la page Google
                    </a>
                  </>
                )}
              </small>
            ) : google.etat === 'connecte' || peutConnecter ? (
              <small>{(google.etat === 'deconnecte' && code.state.googleIdentifiants?.ok && code.state.googleIdentifiants.message) || google.message || 'Mails importants, rendez-vous du jour et fichiers.'}</small>
            ) : (
              <small>La connexion à Google se fait depuis l’ordinateur qui fait tourner le serveur : Réglages, puis Connecteurs.</small>
            )}
            {utilisateur?.proprietaire && google.identifiants === 'reglages' && google.etat !== 'connexion' && (
              <button type="button" className="rg-link gg__changer" onClick={() => (code.client.oublierGoogleIdentifiants(), setChanger(true))}>
                Changer le client Google
              </button>
            )}
          </span>
          {google.etat !== 'connexion' && (google.etat === 'connecte' || peutConnecter) && (
            <button type="button" className="rg-mini" disabled={code.state.connection !== 'connecte'} onClick={() => (google.etat === 'connecte' ? code.client.disconnectGoogle() : code.client.connectGoogle())}>
              {google.etat === 'connecte' ? 'Déconnecter' : google.etat === 'expire' ? 'Reconnecter' : 'Connecter'}
            </button>
          )}
        </div>
      )}
      {changer && (
        <button type="button" className="rg-mini gg__annuler" onClick={() => setChanger(false)}>
          Garder le client actuel
        </button>
      )}
      <BoitesField code={code} />
    </div>
  )
}

// ── Boîtes mail IMAP ─────────────────────────────────────────────────────

/**
 * Les boîtes mail reliées en plus de Gmail (adresse pro chez Orange, autre fournisseur) et l'ajout d'une
 * boîte : adresse et mot de passe ; les serveurs sont devinés par le serveur, à saisir seulement s'il ne les
 * trouve pas. Le mot de passe part une fois au serveur, qui teste la connexion avant d'enregistrer.
 */
function BoitesField({ code }: FieldProps) {
  const { boites, boiteAjout } = code.state
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<number | null>(null)
  const [form, setForm] = useState({ libelle: '', email: '', motDePasse: '', imapHote: '', imapPort: '993', smtpHote: '', smtpPort: '465' })
  const manual = boiteAjout?.manuel === true
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  // Boîte reliée : le formulaire se referme et le mot de passe est effacé de l'écran.
  useEffect(() => {
    if (boiteAjout?.ok) {
      setOpen(false)
      setForm({ libelle: '', email: '', motDePasse: '', imapHote: '', imapPort: '993', smtpHote: '', smtpPort: '465' })
    }
  }, [boiteAjout?.ok])
  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    if (boiteAjout?.busy || !form.email.trim() || !form.motDePasse) return
    code.client.ajouterBoite({
      libelle: form.libelle.trim(),
      email: form.email.trim(),
      motDePasse: form.motDePasse,
      ...(manual && form.imapHote.trim() ? { imapHote: form.imapHote.trim(), imapPort: Number(form.imapPort) || 993, smtpHote: form.smtpHote.trim(), smtpPort: Number(form.smtpPort) || 465 } : {})
    })
  }
  return (
    <>
      {(boites ?? []).map((b) => (
        <div key={b.id} className="rg-connect__item">
          <span className="rg-connect__mark is-on" aria-hidden="true">
            @
          </span>
          <span className="rg-connect__body">
            <strong>
              {b.libelle}
              {b.defaut && <em className="rg-boite__defaut code-mono"> · ENVOI PAR DÉFAUT</em>}
            </strong>
            <small>
              {b.email} · {b.fournisseur}
            </small>
          </span>
          {confirm === b.id ? (
            <span className="rg-row">
              <button type="button" className="rg-mini rg-mini--warn" onClick={() => (code.client.retirerBoite(b.id), setConfirm(null))}>
                Retirer
              </button>
              <button type="button" className="rg-mini" onClick={() => setConfirm(null)}>
                Garder
              </button>
            </span>
          ) : (
            <span className="rg-row">
              {!b.defaut && (boites?.length ?? 0) > 1 && (
                <button type="button" className="rg-mini" onClick={() => code.client.boiteParDefaut(b.id)} title="Les nouveaux messages partiront de cette boîte">
                  Par défaut
                </button>
              )}
              <button type="button" className="rg-mini" onClick={() => setConfirm(b.id)} aria-label={`Retirer la boîte ${b.email}`}>
                Retirer
              </button>
            </span>
          )}
        </div>
      ))}
      {open ? (
        <form className="rg-boite-form" onSubmit={submit} autoComplete="off">
          <p className="rg-note">Adresse pro ou d’un autre fournisseur (Yahoo, iCloud, OVHcloud…). Outlook et Hotmail ne sont pas encore pris en charge. Le mot de passe est chiffré sur le serveur et ne s’affiche plus ensuite.</p>
          <label className="rg-boite-form__field">
            <span>Adresse</span>
            <input className="rg-input" type="email" value={form.email} onChange={set('email')} placeholder="prenom.nom@entreprise.com" autoCapitalize="off" spellCheck={false} required />
          </label>
          <label className="rg-boite-form__field">
            <span>Mot de passe de la messagerie</span>
            <input className="rg-input" type="password" value={form.motDePasse} onChange={set('motDePasse')} autoComplete="new-password" required />
          </label>
          <label className="rg-boite-form__field">
            <span>Nom court (facultatif)</span>
            <input className="rg-input" value={form.libelle} onChange={set('libelle')} placeholder="Pro" maxLength={24} />
          </label>
          {manual && (
            <div className="rg-boite-form__servers">
              <label className="rg-boite-form__field">
                <span>Serveur de lecture (IMAP)</span>
                <input className="rg-input" value={form.imapHote} onChange={set('imapHote')} placeholder="imap.exemple.fr" autoCapitalize="off" spellCheck={false} />
              </label>
              <label className="rg-boite-form__field rg-boite-form__port">
                <span>Port</span>
                <input className="rg-input" inputMode="numeric" value={form.imapPort} onChange={set('imapPort')} />
              </label>
              <label className="rg-boite-form__field">
                <span>Serveur d’envoi (SMTP)</span>
                <input className="rg-input" value={form.smtpHote} onChange={set('smtpHote')} placeholder="smtp.exemple.fr" autoCapitalize="off" spellCheck={false} />
              </label>
              <label className="rg-boite-form__field rg-boite-form__port">
                <span>Port</span>
                <input className="rg-input" inputMode="numeric" value={form.smtpPort} onChange={set('smtpPort')} />
              </label>
            </div>
          )}
          {boiteAjout?.message && !boiteAjout.busy && <p className={boiteAjout.ok ? 'rg-note' : 'rg-error'} role="alert">{boiteAjout.message}</p>}
          <div className="rg-row">
            <button type="submit" className="rg-mini" disabled={!!boiteAjout?.busy || !form.email.trim() || !form.motDePasse}>
              {boiteAjout?.busy ? 'Vérification de la connexion…' : 'Relier la boîte'}
            </button>
            <button type="button" className="rg-mini" onClick={() => (setOpen(false), code.client.oublierAjoutBoite())} disabled={!!boiteAjout?.busy}>
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <div className="rg-connect__item">
          <span className="rg-connect__mark" aria-hidden="true">
            +
          </span>
          <span className="rg-connect__body">
            <strong>Boîte mail</strong>
            <small>{boiteAjout?.ok && boiteAjout.message ? boiteAjout.message : 'Adresse pro ou autre messagerie, en plus de Gmail (plusieurs possibles).'}</small>
          </span>
          <button type="button" className="rg-mini" onClick={() => (code.client.oublierAjoutBoite(), setOpen(true))} disabled={code.state.connection !== 'connecte'}>
            Ajouter
          </button>
        </div>
      )}
    </>
  )
}

// ── Plafond de dépense ───────────────────────────────────────────────────

/** Plafond par jour : au-delà, CODE passe sur le modèle rapide jusqu'à minuit (notification à 80 % et 100 %). */
export function PlafondField({ code }: FieldProps) {
  const r = reglagesOf(code)
  if (!r) return null
  const autre = r.plafondJour !== null && !(PLAFONDS_JOUR as readonly number[]).includes(r.plafondJour)
  const depense = code.state.usage?.jour.total.cout ?? 0
  return (
    <div className="rg-field">
      <Label>Plafond par jour</Label>
      <div className="rg-chips" role="radiogroup" aria-label="Plafond de dépense par jour">
        {PLAFONDS_JOUR.map((v) => (
          <button key={v} type="button" role="radio" aria-checked={r.plafondJour === v} className="rg-chip" onClick={() => code.client.setReglages({ plafondJour: v })}>
            {v} $
          </button>
        ))}
        {autre && (
          <button type="button" role="radio" aria-checked className="rg-chip">
            {String(r.plafondJour).replace('.', ',')} $
          </button>
        )}
        <button type="button" role="radio" aria-checked={r.plafondJour === null} className="rg-chip" onClick={() => code.client.setReglages({ plafondJour: null })}>
          Sans plafond
        </button>
      </div>
      <small className="rg-hint">
        {r.plafondJour === null
          ? 'Aucune limite : le modèle puissant reste disponible toute la journée.'
          : depense >= r.plafondJour
            ? `Plafond atteint aujourd’hui : ${nomDe(code)} répond avec le modèle rapide jusqu’à minuit.`
            : `Au-delà, ${nomDe(code)} répond avec le modèle rapide jusqu’à minuit. Une notification prévient à 80 % puis à 100 %.`}
      </small>
      <FieldError code={code} field="plafondJour" />
    </div>
  )
}

// ── Développement : connecteurs MCP (GitHub, Vercel, Figma…) ─────────────

const ETATS: Record<ConnecteurInfo['etat'], string> = { connecte: 'RELIÉ', a_autoriser: 'À AUTORISER', erreur: 'ERREUR', inactif: '…' }

/** Le monogramme d'un service : « GH », « V », « Fi »… lisible dans un rond de 40 px. */
const monogramme = (nom: string) => (/^[A-Z][a-z]/.test(nom) && nom.length > 6 ? nom.slice(0, 2) : nom.slice(0, 1)).toUpperCase()

/**
 * Les services de développement reliés, puis l'ajout : on choisit un service, on colle son jeton (avec où le
 * créer) ou on se connecte dans la page du service. Le jeton part une fois au serveur, qui le chiffre et teste
 * la connexion avant de la garder ; il ne revient jamais à l'écran.
 */
export function DeveloppementField({ code }: FieldProps) {
  const { connecteurs, catalogue, connecteurAction: action, connection } = code.state
  const [choix, setChoix] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<number | null>(null)
  const [form, setForm] = useState({ jeton: '', url: '', libelle: '', complement: '' })
  /** Le connecteur relié dont on saisit le jeton complémentaire. */
  const [complementDe, setComplementDe] = useState<number | null>(null)
  const [complement, setComplement] = useState('')
  useEffect(() => {
    if (connection === 'connecte' && connecteurs === null) code.client.requestConnecteurs()
  }, [connection, connecteurs === null])
  // Relié : le formulaire se referme et le jeton est effacé de l'écran ; une page OAuth ouverte le garde.
  useEffect(() => {
    if (action?.ok && !action.url) {
      setChoix(null)
      setForm({ jeton: '', url: '', libelle: '', complement: '' })
      setComplementDe(null)
      setComplement('')
    }
  }, [action?.ok, action?.url])
  const service = catalogue.find((s) => s.id === choix) ?? (choix === 'mcp' ? { id: 'mcp', nom: 'Autre serveur MCP', description: 'Un serveur MCP distant (Streamable HTTP), avec un jeton ou une connexion.', acces: 'les_deux' as const, urlLibre: true } : null)
  const relies = new Set((connecteurs ?? []).map((c) => c.service))
  const proposes = catalogue.filter((s) => !relies.has(s.id))
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const busy = !!action?.busy
  const avecJeton = service && (service.acces === 'jeton' || service.acces === 'les_deux')
  const avecConnexion = service && (service.acces === 'oauth' || service.acces === 'les_deux' || service.acces === 'aucun')
  const relier = (jeton: boolean) => {
    if (!service || busy) return
    code.client.ajouterConnecteur({
      service: service.id,
      ...(jeton && form.jeton.trim() ? { jeton: form.jeton.trim() } : {}),
      ...(service.urlLibre ? { url: form.url.trim() } : {}),
      ...(service.id === 'mcp' && form.libelle.trim() ? { libelle: form.libelle.trim() } : {}),
      ...(service.complement && form.complement.trim() ? { complement: form.complement.trim() } : {})
    })
  }
  const urlOk = !service?.urlLibre || /^https?:\/\/./.test(form.url.trim())
  const resultat = action && !action.busy && action.service === choix ? action : null
  return (
    <div className="rg-field rg-connect">
      {connecteurs === null && <p className="rg-note">Chargement des connecteurs…</p>}
      {(connecteurs ?? []).map((c) => {
        const enCours = action?.busy && action.service === c.service
        const info = catalogue.find((s) => s.id === c.service)
        return (
          <div key={c.id} className="rg-connect__item">
            <span className={`rg-connect__mark${c.etat === 'connecte' ? ' is-on' : ''}`} aria-hidden="true">
              {monogramme(c.libelle)}
            </span>
            <span className="rg-connect__body">
              <strong>
                {c.libelle} <em className={`rg-dev__etat rg-dev__etat--${c.etat} code-mono`}>· {ETATS[c.etat]}</em>
              </strong>
              <small>
                {c.etat === 'connecte'
                  ? `${c.outils} outil${c.outils > 1 ? 's' : ''}${c.actions ? ` · ${c.actions} avec votre validation` : ' · lecture seule'}`
                  : c.etat === 'a_autoriser'
                    ? 'Connexion à terminer dans la page du service.'
                    : c.message || 'Connexion en cours…'}
              </small>
              {action?.service === c.service && action.url && !action.busy && (
                <small>
                  <a href={action.url} target="_blank" rel="noreferrer">
                    Ouvrir la page d’autorisation
                  </a>
                </small>
              )}
              {complementDe === c.id && info?.complement && (
                <form
                  className="rg-connect__complement"
                  autoComplete="off"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (complement.trim()) code.client.complementConnecteur(c.id, c.service, complement.trim())
                  }}
                >
                  <small>
                    {info.complement.aide}
                    {info.complement.lien && (
                      <>
                        {' '}
                        <a href={info.complement.lien} target="_blank" rel="noreferrer">
                          Créer le jeton
                        </a>
                      </>
                    )}
                  </small>
                  <input className="rg-input" type="password" value={complement} onChange={(e) => setComplement(e.target.value)} placeholder={info.complement.libelle} autoComplete="new-password" spellCheck={false} aria-label={info.complement.libelle} />
                  <span className="rg-row">
                    <button type="submit" className="rg-mini" disabled={enCours || !complement.trim()}>
                      {enCours ? 'Vérification…' : 'Enregistrer le jeton'}
                    </button>
                    <button type="button" className="rg-mini" onClick={() => (setComplementDe(null), setComplement(''))}>
                      Annuler
                    </button>
                  </span>
                </form>
              )}
              {action?.service === c.service && !action.busy && action.message && !action.url && complementDe === c.id && (
                <small className={action.ok ? undefined : 'rg-error'} role="alert">
                  {action.message}
                </small>
              )}
            </span>
            {confirm === c.id ? (
              <span className="rg-row">
                <button type="button" className="rg-mini rg-mini--warn" onClick={() => (code.client.retirerConnecteur(c.id), setConfirm(null))}>
                  Retirer
                </button>
                <button type="button" className="rg-mini" onClick={() => setConfirm(null)}>
                  Garder
                </button>
              </span>
            ) : (
              <span className="rg-row">
                {c.etat === 'a_autoriser' && (
                  <button type="button" className="rg-mini" disabled={enCours} onClick={() => code.client.autoriserConnecteur(c.id, c.service)}>
                    {enCours ? 'Ouverture…' : 'Autoriser'}
                  </button>
                )}
                {info?.complement && complementDe !== c.id && (
                  <button
                    type="button"
                    className="rg-mini"
                    disabled={enCours}
                    onClick={() => (c.complement ? code.client.complementConnecteur(c.id, c.service, '') : (code.client.oublierActionConnecteur(), setComplementDe(c.id)))}
                  >
                    {c.complement ? 'Retirer le jeton' : 'Ajouter un jeton'}
                  </button>
                )}
                <button type="button" className="rg-mini" onClick={() => setConfirm(c.id)} aria-label={`Retirer ${c.libelle}`}>
                  Retirer
                </button>
              </span>
            )}
          </div>
        )
      })}
      {service ? (
        <form
          className="rg-boite-form"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault()
            relier(true)
          }}
        >
          <div className="rg-dev__head">
            <span className="rg-connect__mark is-on" aria-hidden="true">
              {service.id === 'mcp' ? '+' : monogramme(service.nom)}
            </span>
            <span className="rg-connect__body">
              <strong>{service.nom}</strong>
              <small>{service.description}</small>
            </span>
          </div>
          {service.aide && (
            <p className="rg-note">
              {service.aide}
              {service.lien && (
                <>
                  {' '}
                  <a href={service.lien} target="_blank" rel="noreferrer">
                    Créer le jeton
                  </a>
                </>
              )}
            </p>
          )}
          {service.urlLibre && (
            <label className="rg-boite-form__field">
              <span>{service.id === 'homeassistant' ? 'Adresse de Home Assistant' : 'Adresse du serveur MCP'}</span>
              <input
                className="rg-input"
                type="url"
                value={form.url}
                onChange={set('url')}
                placeholder={service.id === 'homeassistant' ? 'http://homeassistant.local:8123' : service.id === 'coolify' ? 'https://coolify.exemple.com/mcp' : 'https://…/mcp'}
                autoCapitalize="off"
                spellCheck={false}
                required
              />
            </label>
          )}
          {service.id === 'mcp' && (
            <label className="rg-boite-form__field">
              <span>Nom court (facultatif)</span>
              <input className="rg-input" value={form.libelle} onChange={set('libelle')} placeholder="Mon serveur" maxLength={24} />
            </label>
          )}
          {avecJeton && (
            <label className="rg-boite-form__field">
              <span>{service.acces === 'jeton' ? 'Jeton' : 'Jeton (facultatif)'}</span>
              <input className="rg-input" type="password" value={form.jeton} onChange={set('jeton')} autoComplete="new-password" spellCheck={false} required={service.acces === 'jeton'} />
            </label>
          )}
          {service.complement && (
            <label className="rg-boite-form__field">
              <span>{service.complement.libelle}</span>
              <input className="rg-input" type="password" value={form.complement} onChange={set('complement')} autoComplete="new-password" spellCheck={false} />
              <small className="rg-note">
                {service.complement.aide}
                {service.complement.lien && (
                  <>
                    {' '}
                    <a href={service.complement.lien} target="_blank" rel="noreferrer">
                      Créer le jeton
                    </a>
                  </>
                )}
              </small>
            </label>
          )}
          {resultat?.message && (
            <p className={resultat.ok ? 'rg-note' : 'rg-error'} role="alert">
              {resultat.message}
              {resultat.url && (
                <>
                  {' '}
                  <a href={resultat.url} target="_blank" rel="noreferrer">
                    Ouvrir la page
                  </a>
                </>
              )}
            </p>
          )}
          <div className="rg-row">
            {avecJeton && (
              <button type="submit" className="rg-mini" disabled={busy || !form.jeton.trim() || !urlOk}>
                {busy ? 'Vérification…' : 'Relier avec le jeton'}
              </button>
            )}
            {avecConnexion && (
              <button type="button" className="rg-mini" disabled={busy || !urlOk} onClick={() => relier(false)}>
                {busy && !avecJeton ? 'Connexion…' : service.acces === 'aucun' ? 'Relier' : `Se connecter à ${service.nom}`}
              </button>
            )}
            <button type="button" className="rg-mini" onClick={() => (setChoix(null), code.client.oublierActionConnecteur())} disabled={busy}>
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <div className="rg-dev__catalogue">
          {proposes.map((s) => (
            <button key={s.id} type="button" className="rg-dev__service" title={s.description} disabled={connection !== 'connecte'} onClick={() => (code.client.oublierActionConnecteur(), setForm({ jeton: '', url: '', libelle: '', complement: '' }), setChoix(s.id))}>
              <i aria-hidden="true">{monogramme(s.nom)}</i>
              <span>
                <strong>{s.nom}</strong>
                <small>{s.acces === 'jeton' ? 'Jeton' : s.acces === 'oauth' ? 'Connexion' : s.acces === 'aucun' ? 'Sans compte' : 'Jeton ou connexion'}</small>
              </span>
            </button>
          ))}
          <button type="button" className="rg-dev__service rg-dev__service--autre" disabled={connection !== 'connecte'} onClick={() => (code.client.oublierActionConnecteur(), setForm({ jeton: '', url: '', libelle: '', complement: '' }), setChoix('mcp'))}>
            <i aria-hidden="true">+</i>
            <span>
              <strong>Autre serveur</strong>
              <small>MCP, par son adresse</small>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

// ── Habitudes ────────────────────────────────────────────────────────────

const RETOURS = [
  { v: 30, label: '30 min' },
  { v: 60, label: '1 h' },
  { v: 120, label: '2 h' },
  { v: 240, label: '4 h' }
]

/** Un interrupteur : oui ou non, avec son libellé. */
export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="rg-switch" onClick={() => onChange(!on)}>
      <span className="rg-switch__text">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <span className="rg-switch__track" aria-hidden="true">
        <span />
      </span>
    </button>
  )
}

/** Une heure (HH:MM), enregistrée quand elle est complète. */
function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      className="rg-time code-mono"
      type="time"
      step={300}
      value={draft}
      aria-label={label}
      onChange={(e) => {
        setDraft(e.target.value)
        if (/^\d{2}:\d{2}$/.test(e.target.value) && e.target.value !== value) onChange(e.target.value)
      }}
    />
  )
}

/** Heure du briefing, point du retour, heures de silence, notifications. `phone` : ce qui est propre à l'appareil (abonnement, association). */
export function HabitudesField({ code, phone }: FieldProps & { phone?: ReactNode }) {
  const r = reglagesOf(code)
  const t = registre(code.state.utilisateur)
  if (!r) return null
  const set = (patch: Partial<Reglages>) => code.client.setReglages(patch)
  const retourCustom = !RETOURS.some((x) => x.v === r.retourApresMinutes)
  return (
    <div className="rg-field rg-habits">
      <div className="rg-habit">
        <Label>Briefing du matin</Label>
        <div className="rg-row">
          <TimeInput value={r.briefing} label="Heure du briefing" onChange={(v) => set({ briefing: v })} />
          <small className="rg-hint">{t('Agenda, mails importants et rappels, dits à voix haute.', 'Agenda, mails importants et rappels, dits à voix haute.')}</small>
        </div>
        <FieldError code={code} field="briefing" />
      </div>

      <div className="rg-habit">
        <Label>Point du retour</Label>
        <div className="rg-chips" role="radiogroup" aria-label="Point du retour après">
          {RETOURS.map((x) => (
            <button key={x.v} type="button" role="radio" aria-checked={r.retourApresMinutes === x.v} className="rg-chip" onClick={() => set({ retourApresMinutes: x.v })}>
              {x.label}
            </button>
          ))}
          {retourCustom && (
            <button type="button" role="radio" aria-checked className="rg-chip">
              {r.retourApresMinutes} min
            </button>
          )}
        </div>
        <small className="rg-hint">{t(`Après une absence de cette durée, ${nomDe(code)} vous résume ce qui s’est passé.`, `Après une absence de cette durée, ${nomDe(code)} te résume ce qui s’est passé.`)}</small>
        <FieldError code={code} field="retourApresMinutes" />
      </div>

      <div className="rg-habit">
        <Toggle
          on={r.silence !== null}
          onChange={(on) => set({ silence: on ? { de: '22:00', a: r.briefing < '06:30' ? r.briefing : '06:30' } : null })}
          label="Heures de silence"
          hint="Ni voix ni notification pendant ces heures."
        />
        {r.silence && (
          <div className="rg-row rg-span">
            <span className="rg-hint">de</span>
            <TimeInput value={r.silence.de} label="Début du silence" onChange={(v) => set({ silence: { de: v, a: r.silence!.a } })} />
            <span className="rg-span__line" aria-hidden="true" />
            <span className="rg-hint">à</span>
            <TimeInput value={r.silence.a} label="Fin du silence" onChange={(v) => set({ silence: { de: r.silence!.de, a: v } })} />
          </div>
        )}
        <FieldError code={code} field="silence" />
      </div>

      <div className="rg-habit">
        <Toggle on={r.reunionsAgenda} onChange={(v) => set({ reunionsAgenda: v })} label="Proposer d’enregistrer mes réunions" hint="Quand une réunion en visio de votre agenda commence. Rien ne s’enregistre sans votre réponse." />
      </div>

      <div className="rg-habit">
        <Toggle on={r.notifications} onChange={(v) => set({ notifications: v })} label="Notifications sur le téléphone" hint="Rappels, briefing, résultats des tâches, alertes de la veille." />
        {phone}
      </div>
    </div>
  )
}

/** Ville et fuseau horaire (heures du cockpit, des rappels et du briefing). */
export const FUSEAUX = [
  { tz: 'Africa/Abidjan', label: 'Abidjan (GMT)' },
  { tz: 'Africa/Lagos', label: 'Lagos, Douala (GMT+1)' },
  { tz: 'Europe/Paris', label: 'Paris (heure d’Europe centrale)' },
  { tz: 'Europe/London', label: 'Londres' },
  { tz: 'America/New_York', label: 'New York' },
  { tz: 'Asia/Dubai', label: 'Dubaï' }
]

// ── Cartes du cockpit ────────────────────────────────────────────────────

/**
 * Les cartes : affichées ou non, dans quel ordre, et sur le Mac de quel côté de l'orbe. Chaque geste
 * s'enregistre aussitôt et vaut pour tous les appareils.
 */
export function WidgetsField({ code, device }: FieldProps & { device: 'mac' | 'mobile' }) {
  const list = code.state.utilisateur?.reglages.widgets ?? []
  const save = (next: WidgetPlace[]) => code.client.setReglages({ widgets: next })
  const patch = (i: number, p: Partial<WidgetPlace>) => save(list.map((w, k) => (k === i ? { ...w, ...p } : w)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    save(next)
  }
  return (
    <div className="rg-field">
      <ol className="rg-widgets">
        {list.map((w, i) => (
          <li key={w.id} className={w.visible ? '' : 'is-off'}>
            <span className="rg-widgets__n code-mono">{String(i + 1).padStart(2, '0')}</span>
            <span className="rg-widgets__name">{WIDGET_NOMS[w.id]}</span>
            {device === 'mac' && (
              <span className="rg-widgets__side" role="radiogroup" aria-label={`Côté de la carte ${WIDGET_NOMS[w.id]}`}>
                {(['gauche', 'droite'] as const).map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={w.colonne === c} className={w.colonne === c ? 'is-on' : ''} onClick={() => patch(i, { colonne: c })} disabled={!w.visible}>
                    {c === 'gauche' ? 'Gauche' : 'Droite'}
                  </button>
                ))}
              </span>
            )}
            <span className="rg-widgets__order">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Monter ${WIDGET_NOMS[w.id]}`}>
                ↑
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Descendre ${WIDGET_NOMS[w.id]}`}>
                ↓
              </button>
            </span>
            <button type="button" role="switch" aria-checked={w.visible} aria-label={`Afficher ${WIDGET_NOMS[w.id]}`} className="rg-widgets__switch" onClick={() => patch(i, { visible: !w.visible })}>
              <span />
            </button>
          </li>
        ))}
      </ol>
      {device === 'mobile' && <p className="rg-note">La météo s’affiche en haut de l’écran ; les autres cartes forment la réglette du bas, dans cet ordre.</p>}
    </div>
  )
}

export function LieuField({ code }: FieldProps) {
  const r = reglagesOf(code)
  const [ville, setVille] = useState(r?.ville ?? '')
  useEffect(() => setVille(r?.ville ?? ''), [r?.ville])
  if (!r) return null
  const known = FUSEAUX.some((f) => f.tz === r.fuseau)
  return (
    <div className="rg-field rg-lieu">
      <label className="rg-lieu__col">
        <Label>Ville</Label>
        <input className="rg-input" value={ville} maxLength={60} onChange={(e) => setVille(e.target.value)} onBlur={() => ville.trim() && ville.trim() !== r.ville && code.client.setReglages({ ville: ville.trim() })} />
      </label>
      <label className="rg-lieu__col">
        <Label>Fuseau horaire</Label>
        <select className="rg-input" value={r.fuseau} onChange={(e) => code.client.setReglages({ fuseau: e.target.value })}>
          {!known && <option value={r.fuseau}>{r.fuseau}</option>}
          {FUSEAUX.map((f) => (
            <option key={f.tz} value={f.tz}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <FieldError code={code} field="ville" />
      <FieldError code={code} field="fuseau" />
    </div>
  )
}
