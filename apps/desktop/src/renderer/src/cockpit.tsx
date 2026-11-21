import '@code/ui/theme.css'
import '@code/ui/holo.css'
import './styles.css'
import { StrictMode, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatComposer, ChatThread, ConfirmCard, Demarrage, ReunionBarre, EcranSimple, HoloStage, Horizon, Login, Onboarding, Orb, Settings, chatState, conversationOn, enrollText, useCode, voicePrintDevices, useMeteoRefresh, useOnboarding, useStoredToggle, viewOf, nomDe, type Code, type SettingsSection } from '@code/ui'
import { sonSysteme } from './son-systeme.ts'
import type { UsageResume } from '@code/protocol'
import { PairDialog } from './pair.tsx'
import { EcheancesPanel, MailsPanel, MeteoPanel, RemindersPanel, TasksPanel, TodayPanel, usePersoRefresh } from './perso.tsx'
import { bridge, useServerConfig } from './config.ts'

function Clock({ tz, ville }: { tz: string; ville: string }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  const day = now.toLocaleDateString('fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'short' }).replace('.', '')
  const time = now.toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
  return <span className="cockpit__date code-mono">{`${day} · ${time} · ${ville}`.toUpperCase()}</span>
}

type Service = { id: string; label: string; on: boolean; detail: string }

/**
 * Les voyants de CODE en un seul bouton : une rangée de points et, seulement
 * quand quelque chose ne va pas, le nom de ce qui manque. Le détail s'ouvre au clic.
 */
/** Un menu déroulant : se ferme d'un clic ailleurs (hors de `selector`) ou avec Échap. */
function usePopover(selector: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && (e.target as Element).closest(selector)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open, selector])
  return [open, setOpen]
}

function StatusDock({ nom, services, onOpen, children }: { nom: string; services: Service[]; onOpen?: () => void; children?: ReactNode }) {
  const [open, setOpen] = usePopover('.status-dock')
  const off = services.filter((s) => !s.on)
  const summary = off.length === 0 ? 'Tout est en ligne' : off.length === 1 ? off[0]!.label : `${off.length} à vérifier`
  return (
    <div className="status-dock">
      <button type="button" className={`status-dock__btn${off.length ? ' status-dock__btn--warn' : ''}`} aria-expanded={open} aria-label={`État de ${nom} : ${summary.toLowerCase()}`}
        onClick={() => {
          // À l'ouverture : le compteur de coûts est demandé (puis tenu à jour par le serveur).
          if (!open) onOpen?.()
          setOpen(!open)
        }}
      >
        <span className="status-dock__dots" aria-hidden="true">
          {services.map((s) => (
            <span key={s.id} className={`status-dock__dot${s.on ? '' : ' is-off'}`} />
          ))}
        </span>
        <span className="status-dock__label">{summary}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d={open ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
        </svg>
      </button>
      {open && (
        <ul className="status-dock__menu" role="list">
          {services.map((s) => (
            <li key={s.id} className={s.on ? '' : 'is-off'}>
              <span className="status-dock__dot" aria-hidden="true" />
              <strong>{s.label}</strong>
              <small>{s.detail}</small>
            </li>
          ))}
          {children && <li className="status-dock__extra">{children}</li>}
        </ul>
      )}
    </div>
  )
}

const dollars = (n: number) => `${n < 10 ? n.toFixed(2) : n.toFixed(0)} $`.replace('.', ',')

/** Compteur discret : coût du jour et du mois ; par personne pour le premier utilisateur. */
function UsageLine({ usage }: { usage: UsageResume | null }) {
  if (!usage) return <span className="usage__line">Coût : calcul…</span>
  const appels = usage.jour.total.appels
  return (
    <>
      <span className="usage__line" title={`${appels} appel${appels > 1 ? 's' : ''} aujourd’hui · ${usage.mois.total.appels} ce mois`}>
        <span>Aujourd’hui</span> <b>{dollars(usage.jour.total.cout)}</b>
        <span>Ce mois</span> <b>{dollars(usage.mois.total.cout)}</b>
      </span>
      {usage.parPersonne && usage.parPersonne.length > 1 && (
        <span className="usage__people">
          {usage.parPersonne.map((p) => (
            <span key={p.utilisateurId}>
              {p.nom} <b>{dollars(p.jour)}</b> · {dollars(p.mois)}
            </span>
          ))}
        </span>
      )}
    </>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2 className="panel__title">{title}</h2>
      {children}
    </section>
  )
}

function Soon({ children }: { children: React.ReactNode }) {
  return <p className="panel__empty">{children}</p>
}

/** Après un enregistrement réussi, la carte reste le temps de lire la confirmation. */
const VOIX_CONFIRMATION_MS = 6000

function VoicePanel({ code }: { code: Code }) {
  const { state, voice, client } = code
  const { speaker, enroll, enrollMessage } = state
  const [confirmForget, setConfirmForget] = useState(false)
  // La voix de cet ordinateur est enregistrée : la carte n'a plus rien à demander et s'efface (la refaire ou
  // l'oublier se fait dans Réglages › Votre voix). Elle reste pendant un enregistrement, et après un échec.
  const faite = speaker.available && speaker.enrolled && speaker.appareils.includes('mac') && !enroll
  const [confirmation, setConfirmation] = useState(false)
  useEffect(() => {
    if (!enrollMessage?.ok) return setConfirmation(false)
    setConfirmation(true)
    const t = setTimeout(() => setConfirmation(false), VOIX_CONFIRMATION_MS)
    return () => clearTimeout(t)
  }, [enrollMessage])
  if (faite && !confirmation && (!enrollMessage || enrollMessage.ok)) return null
  if (!speaker.available) {
    return (
      <Panel title="Votre voix">
        <Soon>Le modèle de reconnaissance manque sur le serveur (« node scripts/modele-voix.mjs ») : {nomDe(code)} écoute toute voix.</Soon>
      </Panel>
    )
  }
  if (enroll) {
    return (
      <Panel title="Votre voix · enregistrement">
        <p className="voice__read">Lisez à voix haute, normalement, là où vous parlez d’habitude à {nomDe(code)} (le bruit de fond aide) :</p>
        <blockquote className="voice__text">{enrollText(state.utilisateur?.appellation ?? '…', state.utilisateur?.reglages.ville ?? '', nomDe(code))}</blockquote>
        <div className="voice__bar" role="progressbar" aria-valuenow={enroll.percentage} aria-valuemin={0} aria-valuemax={100} aria-label="Progression de l’enregistrement">
          <span style={{ width: `${enroll.percentage}%` }} />
        </div>
        <div className="voice__row">
          <span className="code-mono voice__pct">{enroll.percentage} %</span>
          <button type="button" className="code-btn code-btn--ghost" onClick={() => void voice.cancelEnrollment()}>
            Annuler
          </button>
        </div>
      </Panel>
    )
  }
  return (
    <Panel title="Votre voix">
      {enrollMessage && (
        <p className={`voice__msg${enrollMessage.ok ? '' : ' voice__msg--ko'}`} role="status">
          {enrollMessage.text}
        </p>
      )}
      {speaker.enrolled ? (
        <>
          <p className="panel__empty">{speaker.enabled ? 'Seule votre voix est écoutée. Les autres voix sont ignorées.' : 'Empreinte enregistrée, mais la vérification est désactivée dans la configuration.'}</p>
          <p className="panel__empty">{voicePrintDevices(speaker.appareils)}</p>
          <div className="voice__row">
            <button type="button" className="code-btn code-btn--ghost" onClick={() => void voice.startEnrollment()}>
              {speaker.appareils.includes('mac') ? 'Réenregistrer sur cet ordinateur' : 'Enregistrer sur cet ordinateur'}
            </button>
            {confirmForget ? (
              <button type="button" className="code-btn code-btn--ambre-ghost" onClick={() => (client.send({ type: 'speaker.reset' }), setConfirmForget(false))}>
                Confirmer l’oubli
              </button>
            ) : (
              <button type="button" className="link-btn" onClick={() => setConfirmForget(true)}>
                Oublier ma voix
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="panel__empty">{nomDe(code)} écoute encore tout le monde. Enregistrez votre voix (30 secondes environ) pour qu’il n’obéisse qu’à vous.</p>
          <button type="button" className="code-btn code-btn--ghost" onClick={() => void voice.startEnrollment()} disabled={state.connection !== 'connecte'}>
            Enregistrer ma voix
          </button>
        </>
      )}
    </Panel>
  )
}

function TextForm({ code }: { code: Code }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (code.client.send({ type: 'text', text })) setText('')
  }
  if (!open)
    return (
      <button type="button" className="link-btn" onClick={() => setOpen(true)}>
        Écrire à {nomDe(code)} plutôt que parler
      </button>
    )
  return (
    <form className="text-form" onSubmit={submit}>
      <label htmlFor="code-text" className="sr-only">
        Message à {nomDe(code)}
      </label>
      <input id="code-text" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Votre message…" autoComplete="off" />
      <button type="submit" className="code-btn code-btn--ghost" disabled={!text.trim()}>
        Envoyer
      </button>
    </form>
  )
}

type Show = (tool: string, args: Record<string, unknown>, id: string) => void

/** Les cartes d'une colonne, dans l'ordre et la place choisis dans les Réglages (section « Cartes »). */
function Widgets({ code, show, colonne }: { code: Code; show: Show; colonne: 'gauche' | 'droite' }) {
  const list = (code.state.utilisateur?.reglages.widgets ?? []).filter((w) => w.visible && w.colonne === colonne)
  return (
    <>
      {list.map((w) => {
        switch (w.id) {
          case 'meteo':
            return <MeteoPanel key={w.id} code={code} show={show} />
          case 'aujourdhui':
            return <TodayPanel key={w.id} code={code} show={show} />
          case 'rappels':
            return <RemindersPanel key={w.id} code={code} show={show} />
          case 'echeances':
            return <EcheancesPanel key={w.id} code={code} show={show} />
          case 'mails':
            return <MailsPanel key={w.id} code={code} show={show} />
          case 'taches':
            return <TasksPanel key={w.id} code={code} show={show} />
        }
      })}
    </>
  )
}

type MenuItem = { id: string; label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; detail?: string }

/**
 * Le menu « … » : les boutons secondaires du header (Réglages, téléphone, miniature) y passent sur un
 * écran moyen (sur un grand écran, ils restent à côté, voir styles.css) ; l'arrêt d'urgence, peu servi,
 * y est toujours, en dernier.
 */
function MoreMenu({ items, danger }: { items: MenuItem[]; danger?: MenuItem }) {
  const [open, setOpen] = usePopover('.more-menu')
  return (
    <div className={`more-menu${danger ? '' : ' more-menu--extras'}`}>
      <button type="button" className="code-icon-btn" aria-label="Plus d’options" title="Plus d’options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open && (
        <ul className="more-menu__list" role="menu">
          {[...items, ...(danger ? [danger] : [])].map((it) => (
            <li key={it.id} role="none" className={it === danger ? 'more-menu__danger' : 'more-menu__extra'}>
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false)
                  it.onClick()
                }}
              >
                {it.icon}
                <span className="more-menu__text">
                  <span>{it.label}</span>
                  {it.detail && <small>{it.detail}</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function App() {
  const { url, token } = useServerConfig()
  // Le jeton du serveur peut arriver après coup (premier démarrage) : l'écran repart avec.
  return <Screen key={token ?? ''} url={url} token={token} />
}

function Screen({ url, token }: { url: string | null; token: string | null }) {
  const code = useCode(url, token, 'mac', { nom: 'Ordinateur', onToken: (t) => bridge.setToken(t), pont: bridge.pont, sonSysteme })
  // L'écran de démarrage reste par-dessus, d'un écran à l'autre, jusqu'à ce que le serveur réponde.
  return (
    <>
      <Ecran code={code} />
      <Demarrage connexion={code?.state.connection} taille={300} />
    </>
  )
}

function Ecran({ code }: { code: Code | null }) {
  // Après la connexion, tant que la configuration n'est pas finie : l'assistant de premier lancement.
  const [onboarding, closeOnboarding] = useOnboarding(code)
  const [pairing, setPairing] = useState(false)

  if (!code) {
    return (
      <div className="cockpit code-grid-bg cockpit--boot">
        <Orb mode="injoignable" size={320} label="Démarrage" />
        <p className="boot__text">Connexion au serveur…</p>
      </div>
    )
  }
  if (code.state.connection === 'auth') {
    return (
      <div className="cockpit code-grid-bg cockpit--login">
        <Login
          compact
          auth={code.state.auth}
          onLogin={(id, mdp) => code.client.login(id, mdp)}
          onPair={(c) => code.client.claimPair(c)}
          onInvitation={(c, prenom, id, mdp) => code.client.joinInvitation(c, prenom, id, mdp)}
        />
      </div>
    )
  }

  if (onboarding) {
    return (
      <>
        <Onboarding code={code} device="mac" phone={<PhoneButton code={code} onPair={() => setPairing(true)} />} onDone={closeOnboarding} />
        {pairing && <PairDialog code={code} onClose={() => setPairing(false)} />}
      </>
    )
  }
  return <Cockpit code={code} />
}

/** Sur l'ordinateur, le téléphone s'associe par QR : le bouton qui ouvre la boîte d'association. */
function PhoneButton({ code, onPair }: { code: Code; onPair: () => void }) {
  const phones = code.state.push.abonnes
  return (
    <div className="rg-row">
      <button type="button" className="rg-mini" onClick={onPair} disabled={code.state.connection !== 'connecte'}>
        Associer un téléphone
      </button>
      <small className="rg-hint">{phones ? `${phones} téléphone${phones > 1 ? 's' : ''} abonné${phones > 1 ? 's' : ''} aux notifications.` : 'Scannez le QR avec le téléphone, puis activez les notifications.'}</small>
    </div>
  )
}

function Cockpit({ code }: { code: Code }) {
  const { state, status, client, voice } = code
  const view = viewOf(state, status, 'mac')
  const halted = state.serverState === 'arret'
  const connected = state.connection === 'connecte'
  const nom = nomDe(code)
  const outcome = state.lastOutcome && Date.now() - state.lastOutcome.at < 8_000 ? state.lastOutcome.outcome : null
  const [showInterface, toggleInterface] = useStoredToggle('code.interface', true)
  // Mode chat (endroit bruyant) : on écrit, CODE répond par écrit, sans voix.
  const [chat, toggleChat] = useStoredToggle('code.chat', false)
  const [pairing, setPairing] = useState(false)
  // Réglages ouverts, et sur quelle section (« widgets » depuis le lien sous les cartes).
  const [settings, setSettings] = useState<false | SettingsSection>(false)
  // Mode conversation demandé sans empreinte vocale : on dit pourquoi il est refusé et comment l'enregistrer.
  const [needVoicePrint, setNeedVoicePrint] = useState(false)
  const conversing = conversationOn(state, ['mac', 'mini'])
  const toggleConversation = () => {
    if (conversing) return void voice.setConversation(false)
    if (!state.speaker.enabled) return setNeedVoicePrint(true)
    setNeedVoicePrint(false)
    void voice.setConversation(true)
  }
  useEffect(() => {
    if (!needVoicePrint) return
    const timer = setTimeout(() => setNeedVoicePrint(false), 12_000)
    return () => clearTimeout(timer)
  }, [needVoicePrint])
  const user = state.utilisateur
  // La couleur de l'orbe dit déjà qui parle : l'écran ne montre que ce que CODE fait.
  const holo = showInterface && state.views.some((v) => !v.masque)
  const talk = chatState(code)
  usePersoRefresh(code)
  const widgets = user?.reglages.widgets ?? []
  useMeteoRefresh(code, widgets.some((w) => w.id === 'meteo' && w.visible))
  useEffect(() => bridge.onPresence(() => client.send({ type: 'presence', voice: !chat })), [client, chat])
  // Un clic dans « Aujourd'hui » ou « Mails importants » : la vue détaillée s'ouvre dans l'interface, sans Claude.
  const show = (tool: string, args: Record<string, unknown>, id: string) => {
    if (!showInterface) toggleInterface()
    client.uiPage(id, 'cockpit', tool, args)
  }

  // Boutons secondaires : à côté sur grand écran, dans le menu « … » sur écran moyen.
  const extras: MenuItem[] = [
    {
      id: 'reglages',
      label: 'Réglages',
      onClick: () => setSettings('assistant'),
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="10" cy="17" r="2" />
        </svg>
      )
    },
    {
      id: 'reunion',
      label: 'Enregistrer une réunion',
      disabled: !connected || (!!state.reunion && state.reunion.etat !== 'erreur'),
      onClick: () => client.demarrerReunion(),
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
        </svg>
      )
    },
    {
      id: 'telephone',
      label: 'Associer un téléphone',
      disabled: !connected,
      onClick: () => setPairing(true),
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="7" y="2.5" width="10" height="19" rx="2" />
          <path d="M11 18.5h2" />
        </svg>
      )
    },
    {
      id: 'miniature',
      label: 'Réduire en miniature',
      onClick: () => bridge.toMini(),
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
        </svg>
      )
    }
  ]
  // Écran simplifié (Réglages › Assistant) : l'orbe, l'heure et le dernier échange, sans cartes ni menus.
  if (user?.reglages.ecranSimple) {
    return (
      <>
        <EcranSimple code={code} device="mac" onReglages={() => setSettings('assistant')} />
        {settings && <Settings code={code} device="mac" phone={<PhoneButton code={code} onPair={() => setPairing(true)} />} onClose={() => setSettings(false)} section={settings} />}
        {pairing && <PairDialog code={code} onClose={() => setPairing(false)} />}
      </>
    )
  }
  const halt: MenuItem = {
    id: 'arret',
    label: 'Arrêt d’urgence',
    detail: 'Couper micro, outils et rappels',
    disabled: !connected,
    onClick: () => client.send({ type: 'halt' }),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
    )
  }
  return (
    <div className={`cockpit code-grid-bg${holo ? ' cockpit--holo' : ''}`}>
      <ReunionBarre code={code} />
      <header className="cockpit__header">
        <div className="cockpit__brand">
          <span className="cockpit__nom">{nom}</span>
          <Clock tz={user?.reglages.fuseau ?? Intl.DateTimeFormat().resolvedOptions().timeZone} ville={user?.reglages.ville ?? ''} />
        </div>
        <div className="cockpit__tools">
          <StatusDock
            nom={nom}
            services={[
              { id: 'mac', label: 'Serveur', on: connected, detail: connected ? 'L’ordinateur est relié au serveur' : 'Serveur injoignable' },
              { id: 'micro', label: 'Micro', on: !halted && !status.micError, detail: halted ? 'Coupé par l’arrêt' : status.micError ? 'Micro indisponible' : status.micOn ? `Ouvert, ${nom} écoute` : 'Prêt' },
              { id: 'voix', label: 'Voix protégée', on: state.speaker.enabled, detail: state.speaker.enabled ? `${nom} n’obéit qu’à votre voix` : `Toute voix peut commander ${nom}` },
              { id: 'gmail', label: 'Gmail', on: state.google.gmail, detail: state.google.gmail ? 'Connecté' : 'Non connecté' },
              { id: 'agenda', label: 'Agenda', on: state.google.agenda, detail: state.google.agenda ? 'Connecté' : 'Non connecté' },
              { id: 'drive', label: 'Drive', on: state.google.drive, detail: state.google.drive ? 'Connecté' : 'Non autorisé' }
            ]}
            onOpen={connected ? () => client.requestUsage() : undefined}
          >
            <UsageLine usage={state.usage} />
            <span className="status-dock__account">
              <span>{user ? [user.prenom, user.nom].filter(Boolean).join(' ') : ''}</span>
              <button type="button" className="status-dock__link" onClick={() => client.logout()}>
                Se déconnecter
              </button>
            </span>
          </StatusDock>
          <div className="mode-switch" role="group" aria-label="Affichage">
          <button
            type="button"
            className={`iface-btn${showInterface ? ' iface-btn--on' : ''}`}
            aria-pressed={showInterface}
            aria-label="Afficher l’interface des outils"
            title="Interface des outils"
            onClick={toggleInterface}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 7.5 12 3l9 4.5-9 4.5z" />
              <path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" />
            </svg>
            <span className="iface-btn__label">Interface</span>
          </button>
          <button
            type="button"
            className={`iface-btn${chat ? ' iface-btn--on' : ''}`}
            aria-pressed={chat}
            aria-label={`Mode chat : écrire à ${nom}, réponses sans voix`}
            title="Mode chat"
            onClick={() => {
              // En passant à l'écrit, on coupe le micro et la voix en cours, et le mode conversation.
              if (!chat && conversing) void voice.setConversation(false)
              if (!chat && (status.micOn || status.playing)) void voice.toggle()
              toggleChat()
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 5h16v11H9l-5 4z" />
              <path d="M8 9.5h8M8 12.5h5" />
            </svg>
            <span className="iface-btn__label">Écrit</span>
          </button>
          <button
            type="button"
            className={`iface-btn${conversing ? ' iface-btn--on' : ''}`}
            aria-pressed={conversing}
            aria-label={conversing ? 'Mode conversation actif : le couper' : 'Mode conversation : parler sans cliquer'}
            title={conversing ? 'Mode conversation actif · « arrête d’écouter » ou clic pour le couper' : 'Mode conversation : micro ouvert, sans cliquer'}
            disabled={!connected || halted || chat}
            onClick={toggleConversation}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M6 11a6 6 0 0 0 12 0M12 17v4M2.5 9v4M21.5 9v4" />
            </svg>
            <span className="iface-btn__label">Conversation</span>
          </button>
          </div>
          <span className="cockpit__inline">
            {extras.map((it) => (
              <button key={it.id} type="button" className="code-icon-btn" aria-label={it.label} title={it.label} disabled={it.disabled} onClick={it.onClick}>
                {it.icon}
              </button>
            ))}
          </span>
          {/* À l'arrêt, « Reprendre » est en vue ; sinon l'arrêt d'urgence attend dans le menu. */}
          <MoreMenu items={extras} danger={halted ? undefined : halt} />
          {halted && (
            <>
              <span className="cockpit__sep" aria-hidden="true" />
              <button type="button" className="halt-btn halt-btn--resume" aria-label={`Reprendre ${nom}`} disabled={!connected} onClick={() => client.send({ type: 'resume' })}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5.5v13l10.5-6.5z" />
                </svg>
                Reprendre
              </button>
            </>
          )}
        </div>
      </header>

      {settings && <Settings code={code} device="mac" phone={<PhoneButton code={code} onPair={() => setPairing(true)} />} onClose={() => setSettings(false)} section={settings} />}
      {pairing && <PairDialog code={code} onClose={() => setPairing(false)} />}

      {halted && (
        <div className="halt-banner" role="status">
          <strong>{nom} est à l’arrêt sur tous vos appareils.</strong>
          <span>Micro coupé, outils bloqués, rappels suspendus. Rien ne reprend sans vous.</span>
        </div>
      )}

      <main className="cockpit__main">
        <aside className="cockpit__side">
          <VoicePanel code={code} />
          <Widgets code={code} show={show} colonne="gauche" />
        </aside>

        <section className="cockpit__center">
          <div className={`stage${chat ? ' stage--chat' : ''}`}>
            {chat ? (
              <div className="chat-column">
                <div className="chat-column__head">
                  <Orb mode={view.orb} size={44} level={voice.level} label={view.label} />
                  <span className={`code-state-label tone-${view.tone}`}>{view.label}</span>
                  <span className="chat-column__hint">Réponses écrites, sans voix</span>
                </div>
                <ChatThread messages={talk.messages} thinking={talk.thinking} activity={talk.activity} nom={nom} />
                <ChatComposer onSend={talk.send} busy={talk.busy} onStop={talk.stop} disabled={talk.disabled} nom={nom} autoFocus onDocument={talk.document} envoi={talk.envoi} onOublierEnvoi={talk.oublierEnvoi} />
              </div>
            ) : (
            <div className="orb-stage">
              {!holo && <Horizon variant="mac" />}
              <button
                type="button"
                className="orb-btn horizon-float"
                aria-label={view.state === 'parole' ? `Interrompre ${nom}` : status.micOn ? 'Arrêter l’écoute' : `Parler à ${nom} (${view.label.toLowerCase()})`}
                disabled={!connected || halted}
                onClick={() => void voice.toggle()}
              >
                <Orb mode={view.orb} size={holo ? 300 : 440} level={voice.level} label={view.label} />
              </button>
              {!holo && (
                <p className="state">
                  <span className={`state__label code-state-label tone-${view.tone}`}>{view.label}</span>
                  <span className="state__sub">{view.sub}</span>
                </p>
              )}
            </div>
            )}
            {holo && (
              <HoloStage
                views={state.views}
                pile={state.pile}
                onRestore={(turnId) => client.restoreViews(turnId)}
                onClose={() => client.clearViews()}
                onAction={(action, chemin) => client.uiAction(action, chemin)}
                resolveUrl={(path) => client.httpUrl(path)}
                onAsk={(text) => client.send({ type: 'text', text, voice: !chat })}
                onPage={(viewId, turnId, tool, args) => client.uiPage(viewId, turnId, tool, args)}
                onReminder={(id, action, minutes) => client.reminderAction(id, action, minutes)}
                onTask={(id, action) => client.taskAction(id, action)}
                onListe={(liste, element, coche) => client.listeCocher(liste, element, coche)}
                onMaison={(entite) => client.maisonBasculer(entite)}
                onCamera={(entite) => client.cameraActualiser(entite)}
                onReunion={{ enregistrer: () => client.demarrerReunion(), importer: (f) => client.importerReunion(f) }}
                nomAssistant={nomDe(code)}
              />
            )}
          </div>

          <div className="notices">
            {state.pending && (
              <ConfirmCard
                layout="ligne"
                request={state.pending}
                onConfirm={() => client.send({ type: 'confirm', actionId: state.pending!.actionId })}
                onCancel={() => client.send({ type: 'cancel', actionId: state.pending!.actionId })}
              />
            )}
            {outcome && (
              <p className={`outcome outcome--${outcome}`} role="status">
                {outcome === 'valide' ? 'Action validée' : outcome === 'expire' ? 'Délai dépassé · rien n’est fait' : 'Action annulée · rien n’est fait'}
              </p>
            )}
            {needVoicePrint && !state.speaker.enabled && (
              <p className="error" role="alert">
                Le mode conversation demande votre empreinte vocale : sans elle, je répondrais à toutes les voix de la pièce.{' '}
                <button type="button" className="link-btn" onClick={() => (setNeedVoicePrint(false), setSettings('empreinte'))}>
                  Enregistrer ma voix
                </button>
              </p>
            )}
            {(state.error || status.micError) && (
              <p className="error" role="alert">
                {state.error ?? status.micError}
              </p>
            )}
            {connected && !halted && !chat && <TextForm code={code} />}
          </div>
        </section>

        <aside className="cockpit__side">
          <Widgets code={code} show={show} colonne="droite" />
          <button type="button" className="widgets__manage" onClick={() => setSettings('widgets')}>
            Gérer les cartes
          </button>
        </aside>
      </main>
    </div>
  )
}

const root = createRoot(document.getElementById('root')!)
// Atelier (navigateur, développement) : `?lab=cockpit`, le cockpit avec un faux client, sans serveur ni connexion.
if (import.meta.env.DEV && new URLSearchParams(location.search).get('lab') === 'cockpit') {
  void import('@code/ui/lab').then(({ useLabCode }) => {
    function CockpitLab() {
      return <Cockpit code={useLabCode({ configure: true, device: 'mac' })} />
    }
    root.render(
      <StrictMode>
        <CockpitLab />
      </StrictMode>
    )
  })
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
