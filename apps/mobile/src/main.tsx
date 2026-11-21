import '@code/ui/theme.css'
import '@code/ui/holo.css'
import './styles.css'
import { StrictMode, useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BoutonDocument, BoutonReunion, Demarrage, ReunionBarre, ChatComposer, ChatThread, EnvoiDocument, ConfirmCard, EcranSimple, EdgeSwarm, HoloStage, Horizon, Login, Onboarding, Orb, Settings, SkyIcon, chatState, conversationHere, useCode, useMeteoRefresh, useOnboarding, useStoredToggle, viewOf, nomDe, type Code, type SettingsSection } from '@code/ui'
import type { UiAgenda, UiEcheancier, UiMails, UiRappels, UiTaches } from '@code/protocol'
import { BellIcon, PushSetting, usePush } from './push.tsx'
import { Dock } from './dock.tsx'

const TOKEN_KEY = 'code.token'

/** « Bonjour » de 5 h à 18 h, « Bonsoir » ensuite. */
function greeting(): string {
  const h = new Date().getHours()
  return h >= 5 && h < 18 ? 'Bonjour' : 'Bonsoir'
}

/**
 * Le jeton d'appareil reste sur le téléphone après la connexion. Un ancien lien d'association (`#t=…`)
 * l'apporte encore directement ; le QR de l'ordinateur porte un code à usage unique (`#p=…`).
 */
function initialToken(): string | null {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('t')
  try {
    if (fromLink) {
      localStorage.setItem(TOKEN_KEY, fromLink)
      history.replaceState(null, '', location.pathname)
    }
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return fromLink
  }
}

/** Code d'association du QR, lu une fois puis retiré de l'adresse. */
function initialPairCode(): string | null {
  const code = new URLSearchParams(location.hash.slice(1)).get('p')
  if (code) history.replaceState(null, '', location.pathname)
  return code
}

/** Code d'invitation du lien envoyé par le propriétaire (`#i=…`), lu une fois puis retiré de l'adresse. */
function initialInvitation(): string | null {
  const code = new URLSearchParams(location.hash.slice(1)).get('i')
  if (code) history.replaceState(null, '', location.pathname)
  return code
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {}
}

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

/**
 * Garde l'écran allumé pendant une conversation : un téléphone qui se verrouille pendant que CODE
 * répond coupe la connexion (« serveur injoignable ») et la fin de la réponse.
 */
function useWakeLock(active: boolean) {
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
    if (!active || !api) return
    let lock: { release: () => Promise<void> } | null = null
    let cancelled = false
    const take = () =>
      void api
        .request('screen')
        .then((l) => (cancelled ? void l.release() : (lock = l)))
        .catch(() => {})
    take()
    // Le verrou tombe quand la page passe en arrière-plan : on le reprend au retour.
    const onVisible = () => !document.hidden && take()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
    }
  }, [active])
}

/** Ce qu'ouvre une notification touchée : le résultat d'une tâche (`#resultat=12`), dès que le serveur répond. */
type Target = { tool: string; args: Record<string, unknown>; id: string }
function targetFrom(url: string): Target | null {
  const params = new URLSearchParams(url.split('#')[1] ?? '')
  const id = Number(params.get('resultat'))
  return Number.isInteger(id) && id > 0 ? { tool: 'tache_resultat', args: { execution: id }, id: `notification-${id}` } : null
}

function useOpenFromNotification(code: ReturnType<typeof useCode>, showInterface: () => void) {
  const [wanted, setWanted] = useState(() => targetFrom(location.href))
  const connected = code?.state.connection === 'connecte'
  // App déjà ouverte : le service worker transmet le lien de la notification touchée.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'ouvrir' && typeof e.data.url === 'string') setWanted(targetFrom(e.data.url))
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [])
  useEffect(() => {
    if (!wanted || !connected || !code) return
    showInterface()
    code.client.uiPage(wanted.id, wanted.id, wanted.tool, wanted.args)
    if (location.hash) history.replaceState(null, '', location.pathname)
    setWanted(null)
  }, [wanted, connected, code, showInterface])
}

/**
 * Le téléphone dit au serveur que l'utilisateur est là : à la connexion, quand l'app revient au premier plan,
 * puis toutes les 4 minutes tant qu'elle reste affichée. Après une longue absence, CODE fait le point.
 */
function usePresence(code: Code | null, chat: boolean) {
  const connected = code?.state.connection === 'connecte'
  const client = code?.client
  useEffect(() => {
    if (!connected || !client) return
    const send = () => document.visibilityState === 'visible' && client.send({ type: 'presence', voice: !chat })
    send()
    const t = setInterval(send, 4 * 60_000)
    document.addEventListener('visibilitychange', send)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', send)
    }
  }, [connected, client, chat])
}

/** L'app passe en arrière-plan (écran verrouillé, autre app) : le mode conversation de ce téléphone se coupe. */
function useConversationSleep(code: Code | null) {
  const client = code?.client
  const voice = code?.voice
  useEffect(() => {
    if (!client || !voice) return
    const onHidden = () => document.hidden && conversationHere(client.getState()) && void voice.setConversation(false)
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [client, voice])
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4M2.5 9v4M21.5 9v4" />
    </svg>
  )
}

function Phone({ token, pairCode, invitation }: { token: string | null; pairCode: string | null; invitation: string | null }) {
  const code = useCode(WS_URL, token, 'mobile', { nom: 'Téléphone', onToken: storeToken })
  // L'écran de démarrage reste par-dessus, d'un écran à l'autre, jusqu'à ce que le serveur réponde.
  return (
    <>
      <Ecran code={code} pairCode={pairCode} invitation={invitation} />
      <Demarrage connexion={code?.state.connection} taille={220} />
    </>
  )
}

function Ecran({ code, pairCode, invitation }: { code: Code | null; pairCode: string | null; invitation: string | null }) {
  // Ouvert depuis le QR de l'ordinateur, sans jeton : le code d'association est échangé une fois.
  const claimed = useRef(false)
  const waitingAuth = code?.state.connection === 'auth'
  useEffect(() => {
    if (!pairCode || !code || !waitingAuth || claimed.current) return
    claimed.current = true
    code.client.claimPair(pairCode)
  }, [pairCode, code, waitingAuth])
  const [settings, setSettings] = useState<false | SettingsSection>(false)
  // Mode conversation demandé sans empreinte vocale : on dit pourquoi il est refusé et comment l'enregistrer.
  const [needVoicePrint, setNeedVoicePrint] = useState(false)
  useEffect(() => {
    if (!needVoicePrint) return
    const timer = setTimeout(() => setNeedVoicePrint(false), 12_000)
    return () => clearTimeout(timer)
  }, [needVoicePrint])
  // Après la connexion, tant que la configuration n'est pas finie : l'assistant de premier lancement.
  const [onboarding, closeOnboarding] = useOnboarding(code)
  const [showInterface, toggleInterface] = useStoredToggle('code.interface', true)
  // Mode chat (endroit bruyant) : on écrit, CODE répond par écrit, sans voix.
  const [chat, toggleChat] = useStoredToggle('code.chat', false)
  // Avant tout retour anticipé : les hooks doivent toujours être appelés dans le même ordre.
  const push = usePush(code)
  useOpenFromNotification(code, () => !showInterface && toggleInterface())
  const [pushPanel, setPushPanel] = useState(false)
  // Invitation à activer les notifications, jusqu'à ce qu'elles le soient ou qu'on la ferme.
  const [pushInvite, togglePushInvite] = useStoredToggle('code.push.invite', true)
  const conversing = Boolean(code) && (code!.status.micOn || code!.status.playing || ['ecoute', 'reflexion', 'parole', 'attente_validation'].includes(code!.state.serverState))
  // Le mode conversation garde aussi l'écran allumé : un écran verrouillé le couperait.
  const conversationMode = Boolean(code) && conversationHere(code!.state)
  useWakeLock(conversing || conversationMode)
  useConversationSleep(code)
  usePresence(code, chat)
  // La météo en haut de l'écran, si la carte est affichée (Réglages, section « Cartes »).
  const meteoOn = code?.state.utilisateur?.reglages.widgets.some((w) => w.id === 'meteo' && w.visible) ?? false
  useMeteoRefresh(code, meteoOn)
  if (!code) return <div className="phone code-grid-bg" />

  const { state, status, voice, client } = code
  if (state.connection === 'auth')
    return (
      <div className="phone code-grid-bg">
        <Login
          auth={state.auth}
          onLogin={(id, mdp) => client.login(id, mdp)}
          onPair={(c) => client.claimPair(c)}
          onInvitation={(c, prenom, id, mdp) => client.joinInvitation(c, prenom, id, mdp)}
          invitation={invitation}
        />
      </div>
    )
  if (onboarding) return <Onboarding code={code} device="mobile" phone={<PushSetting push={push} />} onDone={closeOnboarding} />
  // Écran simplifié (Réglages › Assistant) : l'orbe, l'heure et le dernier échange, sans cartes ni menus.
  if (state.utilisateur?.reglages.ecranSimple)
    return (
      <>
        <EcranSimple code={code} device="mobile" onReglages={() => setSettings('assistant')} />
        {settings && <Settings code={code} device="mobile" phone={<PushSetting push={push} />} onClose={() => setSettings(false)} section={settings} />}
      </>
    )
  const view = viewOf(state, status, 'mobile')
  const connected = state.connection === 'connecte'
  const offline = view.state === 'injoignable'
  const listeningOrSpeaking = view.state === 'ecoute' || view.state === 'parole'
  const outcome = state.lastOutcome && Date.now() - state.lastOutcome.at < 8_000 ? state.lastOutcome.outcome : null
  // Comme sur l'ordinateur : la couleur de l'orbe dit qui parle ; l'écran ne montre que ce que CODE fait.
  const holo = showInterface && state.views.some((v) => !v.masque)
  // Interface ouverte : l'orbe s'éparpille sur les bords de l'écran et laisse tout l'écran à l'interface.
  const toggle = () => void voice.toggle()
  const talk = chatState(code)
  const toggleConversation = () => {
    if (conversationMode) return void voice.setConversation(false)
    if (!state.speaker.enabled) return setNeedVoicePrint(true)
    setNeedVoicePrint(false)
    void voice.setConversation(true)
  }

  return (
    <div className={`phone code-grid-bg${holo ? ' phone--holo' : ''}${chat ? ' phone--chat' : ''}`}>
      <ReunionBarre code={code} />
      <header className="phone__header">
        <div className="phone__brand">
          {/* L'état de la connexion : un point sur le logo (vert : relié ; rouge : injoignable, dit en toutes lettres dessous). */}
          <span className="phone__logo-wrap">
            <span className="phone__nom">{nomDe(code)}</span>
            <span className={`phone__link${connected ? '' : ' is-off'}`} role="status" aria-label={connected ? 'Relié au serveur' : 'Serveur injoignable'} />
          </span>
          <button type="button" className={`phone__hello${connected ? '' : ' is-off'}`} onClick={() => setSettings('assistant')} aria-label="Réglages">
            {connected ? `${greeting()}${state.utilisateur ? `, ${state.utilisateur.appellation}` : ''}` : offline ? 'Injoignable' : 'Connexion…'}
          </button>
        </div>
        <div className="phone__tools">
          {meteoOn && state.meteo?.data && (
            <button
              type="button"
              className="phone__wx"
              onClick={() => {
                if (!showInterface) toggleInterface()
                client.uiPage('phone-meteo', 'dock', 'meteo', {})
              }}
              aria-label={`Météo à ${state.meteo.data.lieu} : ${state.meteo.data.maintenant.temp} degrés, ${state.meteo.data.maintenant.libelle}`}
            >
              <SkyIcon ciel={state.meteo.data.maintenant.ciel} nuit={state.meteo.data.maintenant.nuit} size={22} />
              {state.meteo.data.maintenant.temp}°
            </button>
          )}
        </div>
      </header>

      <main className="phone__center">
        {(holo || chat) && <EdgeSwarm mode={view.orb} level={voice.level} />}
        {chat && !holo && <ChatThread messages={talk.messages} thinking={talk.thinking} activity={talk.activity} nom={nomDe(code)} />}
        <div className="phone__stage">
          <Horizon />
          <button
            type="button"
            className="phone__orb horizon-float"
            aria-label={listeningOrSpeaking ? `Interrompre ${nomDe(code)}` : `Parler à ${nomDe(code)} (${view.label.toLowerCase()})`}
            onClick={toggle}
            disabled={!connected || state.serverState === 'arret'}
          >
            <Orb mode={view.orb} size={280} level={voice.level} label={view.label} />
          </button>
        </div>
        {!holo && !chat && <span className={`phone__etat code-state-label tone-${view.tone}`}>{view.label}</span>}
        {!holo && !chat && view.state === 'veille' && connected && <span className="phone__hint">{view.sub}</span>}
        {!holo && conversationMode && (
          <button type="button" className="phone__convo code-mono" onClick={toggleConversation} aria-label="Mode conversation actif : le couper">
            <MicIcon />
            MODE CONVERSATION · COUPER
          </button>
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
      </main>

      <section className="phone__feed" aria-live="polite">
        {view.state === 'refuse' && (
          <div className="notice">
            <p>Ce jeton n’est plus valide.</p>
            <button type="button" className="code-btn code-btn--ghost" onClick={() => client.logout()}>
              Se reconnecter
            </button>
          </div>
        )}
        {offline && (
          <div className="notice">
            <p>Le serveur ne répond pas. Vérifiez qu’il est allumé et joignable (Tailscale).</p>
            <button type="button" className="code-btn code-btn--ghost" onClick={() => location.reload()}>
              Réessayer maintenant
            </button>
          </div>
        )}
        {connected && pushInvite && push.state === 'inactif' && !pushPanel && (
          <div className="notice push-card">
            <p>
              <strong>Rappels sur l’écran verrouillé</strong>
              <br />
              Activez les notifications : vos rappels et le briefing du matin arriveront ici, même quand l’app est fermée.
            </p>
            <span className="push-card__actions">
              <button
                type="button"
                className="code-btn"
                onClick={() => {
                  setPushPanel(true)
                  void push.enable()
                }}
              >
                Activer
              </button>
              <button type="button" className="code-btn code-btn--ghost" onClick={togglePushInvite}>
                Plus tard
              </button>
            </span>
          </div>
        )}
        {pushPanel && (push.message || push.state === 'actif' || push.state === 'en_cours') && (
          <div className="notice push-card" role="status">
            <p>
              {push.message ||
                (push.state === 'en_cours'
                  ? 'Abonnement en cours…'
                  : `Notifications actives sur ce téléphone${state.push.abonnes > 1 ? ` (${state.push.abonnes} appareils)` : ''}.`)}
            </p>
            <span className="push-card__actions">
              {push.state === 'actif' && (
                <>
                  <button type="button" className="code-btn code-btn--ghost" onClick={push.test}>
                    Essai
                  </button>
                  <button type="button" className="code-btn code-btn--ghost" onClick={() => void push.disable()}>
                    Désactiver
                  </button>
                </>
              )}
              <button
                type="button"
                className="code-btn code-btn--ghost"
                onClick={() => {
                  setPushPanel(false)
                  push.clearMessage()
                }}
              >
                Fermer
              </button>
            </span>
          </div>
        )}
        {state.pending && (
          <ConfirmCard
            request={state.pending}
            onConfirm={() => client.send({ type: 'confirm', actionId: state.pending!.actionId })}
            onCancel={() => client.send({ type: 'cancel', actionId: state.pending!.actionId })}
          />
        )}
        {state.rappels
          .filter((r) => r.etat === 'sonne')
          .map((r) => (
            <div key={r.id} className="ring" role="alert">
              <span className="ring__bell" aria-hidden="true" />
              <span className="ring__text">
                <small>
                  RAPPEL{r.retard ? ' · EN RETARD' : ''} · {r.recurrence ?? r.heure}
                </small>
                <strong>{r.texte}</strong>
              </span>
              <span className="ring__actions">
                <button type="button" className="ring__btn ring__btn--main" onClick={() => client.reminderAction(r.id, 'fait')}>
                  Fait
                </button>
                <button type="button" className="ring__btn" onClick={() => client.reminderAction(r.id, 'reporter', 10)}>
                  +10 min
                </button>
              </span>
            </div>
          ))}
        {outcome && (
          <p className={`feed__outcome feed__outcome--${outcome}`} role="status">
            {outcome === 'valide' ? 'Action validée' : 'Rien n’est fait'}
          </p>
        )}
        {needVoicePrint && !state.speaker.enabled && (
          <p className="feed__error" role="alert">
            Le mode conversation demande votre empreinte vocale : sans elle, je répondrais à toutes les voix de la pièce.{' '}
            <button type="button" className="link-btn" onClick={() => (setNeedVoicePrint(false), setSettings('empreinte'))}>
              Enregistrer ma voix
            </button>
          </p>
        )}
        {!chat && <EnvoiDocument envoi={state.documentEnvoi} onClose={() => client.oublierEnvoiDocument()} className="feed__envoi" />}
        {(state.error || status.micError) && (
          <p className="feed__error" role="alert">
            {state.error ?? status.micError}
          </p>
        )}
      </section>

      {/* Les actions, à portée de pouce : juste au-dessus de la réglette, tout en bas quand elle se retire. */}
      <nav className="phone__actions" aria-label="Actions">
        {connected && <BoutonReunion className="phone__iface" code={code} />}
        {connected && (
          <BoutonDocument className="phone__iface" label="Photographier un papier : il sera lu, rangé, et son échéance notée" onFile={(f) => void client.envoyerDocument(f, !chat)} disabled={Boolean(state.documentEnvoi && !state.documentEnvoi.erreur)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
              <path d="M8.5 7.5h5l2 2v7h-7z" />
              <path d="M10.5 12.5h3M10.5 14.5h2" />
            </svg>
          </BoutonDocument>
        )}
        <button
          type="button"
          className={`phone__iface${chat ? ' phone__iface--on' : ''}`}
          aria-pressed={chat}
          aria-label={`Mode chat : écrire à ${nomDe(code)}, réponses sans voix`}
          onClick={() => {
            // En passant à l'écrit, on coupe le micro et la voix en cours, et le mode conversation.
            if (!chat && conversationMode) void voice.setConversation(false)
            if (!chat && (status.micOn || status.playing)) void voice.toggle()
            toggleChat()
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5h16v11H9l-5 4z" />
            <path d="M8 9.5h8M8 12.5h5" />
          </svg>
        </button>
        <button
          type="button"
          className={`phone__iface${showInterface ? ' phone__iface--on' : ''}`}
          aria-pressed={showInterface}
          aria-label="Afficher l’interface des outils"
          onClick={toggleInterface}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7.5 12 3l9 4.5-9 4.5z" />
            <path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" />
          </svg>
        </button>
        <PhoneMenu
          items={[
            ...(push.state !== 'indisponible'
              ? [
                  {
                    label: push.state === 'actif' ? 'Notifications actives' : push.state === 'bloque' ? 'Notifications bloquées' : 'Activer les notifications',
                    icon: <BellIcon on={push.state === 'actif'} off={push.state === 'bloque'} />,
                    on: push.state === 'actif',
                    onClick: () => {
                      if (push.state === 'actif') return setPushPanel((v) => !v)
                      setPushPanel(true)
                      void push.enable()
                    }
                  }
                ]
              : []),
            ...(connected && !chat && state.serverState !== 'arret'
              ? [{ label: conversationMode ? 'Couper le mode conversation' : 'Mode conversation', icon: <MicIcon />, on: conversationMode, onClick: toggleConversation }]
              : []),
            {
              label: 'Réglages',
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
                  <circle cx="16" cy="7" r="2" />
                  <circle cx="10" cy="17" r="2" />
                </svg>
              ),
              onClick: () => setSettings('assistant')
            }
          ]}
        />
      </nav>

      {chat ? (
        <nav className="phone__bar" aria-label={`Écrire à ${nomDe(code)}`}>
          <ChatComposer onSend={talk.send} busy={talk.busy} onStop={talk.stop} disabled={talk.disabled} nom={nomDe(code)} onDocument={talk.document} envoi={talk.envoi} onOublierEnvoi={talk.oublierEnvoi} />
        </nav>
      ) : (
        <Dock
          code={code}
          hidden={holo || !connected || view.state !== 'veille' || state.pending !== null || state.rappels.some((r) => r.etat === 'sonne')}
          show={(tool, args, id) => {
            if (!showInterface) toggleInterface()
            client.uiPage(id, 'dock', tool, args)
          }}
          onSettings={() => setSettings('assistant')}
        />
      )}
      {settings && <Settings code={code} device="mobile" phone={<PushSetting push={push} />} onClose={() => setSettings(false)} section={settings} />}
    </div>
  )
}

function App() {
  // Lus une fois au chargement : le client garde ensuite le jeton (connexion, déconnexion).
  const [token] = useState(initialToken)
  const [pairCode] = useState(initialPairCode)
  const [invitation] = useState(initialInvitation)
  return <Phone token={token} pairCode={pairCode} invitation={invitation} />
}

/**
 * La hauteur réelle de la fenêtre, pour l'écran (styles.css, --app-h). Installée sur l'écran d'accueil d'un
 * iPhone, l'app reçoit pour 100dvh la hauteur de l'écran moins la barre d'état : l'écran s'arrêtait trop tôt.
 */
function hauteurReelle(): void {
  document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`)
}
hauteurReelle()
window.addEventListener('resize', hauteurReelle)
window.addEventListener('orientationchange', () => setTimeout(hauteurReelle, 300))

if ('serviceWorker' in navigator && location.protocol === 'https:') void navigator.serviceWorker.register('/sw.js')

/**
 * App restée ouverte pendant une mise à jour du serveur : les morceaux chargés à la demande (moteur de carte…)
 * ont changé de nom et l'ancien n'existe plus. On recharge la page, une fois par minute au plus.
 */
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem('code.reload') ?? 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem('code.reload', String(Date.now()))
  } catch {
    return
  }
  event.preventDefault()
  location.reload()
})

/**
 * Développement seulement : `?lab=mails` (mails, agenda, rappels, taches, meteo…) affiche les
 * interfaces d'exemple dans la mise en page du téléphone, sans serveur. Absent du build.
 */
/** Le menu « … » de la rangée du bas : notifications, mode conversation, Réglages. Il s’ouvre vers le haut. */
function PhoneMenu({ items }: { items: { label: string; icon: ReactNode; on?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e.target instanceof Element && e.target.closest('.phone__menu')) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    <div className="phone__menu">
      <button type="button" className={`phone__iface${open ? ' phone__iface--on' : ''}`} aria-label="Plus d’options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <ul className="phone__menu-list" role="menu">
          {items.map((it) => (
            <li key={it.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={it.on ? 'is-on' : undefined}
                onClick={() => {
                  setOpen(false)
                  it.onClick()
                }}
              >
                {it.icon}
                <span>{it.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

async function lab(kind: string) {
  const { SAMPLES } = await import('@code/ui/samples')
  const { useLabCode } = await import('@code/ui/lab')
  // ?lab=assistant : l'assistant de premier lancement ; ?lab=reglages : le panneau Réglages. Faux client, choix appliqués.
  function SetupLab() {
    const code = useLabCode({ configure: kind === 'reglages' || kind === 'simple' })
    const [open, setOpen] = useState(kind !== 'simple')
    const phone = <p className="rg-note">Notifications : actives sur ce téléphone (atelier).</p>
    if (kind === 'assistant' && open) return <Onboarding code={code} device="mobile" phone={phone} onDone={() => setOpen(false)} />
    // ?lab=simple&simple : l'écran simplifié, avec un échange (et &sonne : un rappel qui sonne).
    if (kind === 'simple')
      return (
        <>
          <EcranSimple code={code} device="mobile" onReglages={() => setOpen(true)} />
          {open && <Settings code={code} device="mobile" phone={phone} onClose={() => setOpen(false)} />}
        </>
      )
    return (
      <div className="phone code-grid-bg">
        <ReunionBarre code={code} />
        <header className="phone__header">
          <div className="phone__brand">
            <span className="phone__nom">Code</span>
            <button type="button" className="phone__hello" onClick={() => setOpen(true)}>
              Atelier · {kind}
            </button>
          </div>
          <div className="phone__tools">
            <BoutonReunion className="phone__iface" code={code} />
          </div>
        </header>
        <main className="phone__center">
          <Orb mode={code.status.playing ? 'parole' : 'repos'} size={280} level={code.voice.level} label="EN VEILLE" />
        </main>
        {kind === 'reglages' && open && <Settings code={code} device="mobile" phone={phone} onClose={() => setOpen(false)} />}
      </div>
    )
  }
  // ?lab=demarrage : l'écran de démarrage, tant que le serveur ne répond pas (&pret : il répond).
  if (kind === 'demarrage') return <Demarrage connexion={new URLSearchParams(location.search).has('pret') ? 'connecte' : undefined} taille={220} />
  if (kind === 'assistant' || kind === 'reglages' || kind === 'simple') return <SetupLab />
  function Lab() {
    const [views, setViews] = useState(SAMPLES[kind] ?? [])
    // ?pile=agenda,mails : des interfaces précédentes rangées au-dessus, chacune son tour.
    const [pile, setPile] = useState(() =>
      (new URLSearchParams(location.search).get('pile') ?? '').split(',').filter((k) => SAMPLES[k]).map((k) => SAMPLES[k]!.map((v) => ({ ...v, turnId: `pile-${k}` })))
    )
    // Une liste : cochée sur place, comme le ferait le serveur.
    const cocherLab = (liste: number, element: number, coche: boolean) =>
      setViews((vs) =>
        vs.map((v) => {
          if (v.data?.kind !== 'liste' || v.data.id !== liste) return v
          const elements = v.data.elements.map((e) => (e.id === element ? { ...e, coche } : e))
          return { ...v, data: { ...v.data, elements, restants: elements.filter((e) => !e.coche).length, focus: [element] } }
        })
      )
    const basculerLab = (entite: string) =>
      setViews((vs) =>
        vs.map((v) =>
          v.data?.kind !== 'maison'
            ? v
            : { ...v, data: { ...v.data, focus: [entite], pieces: v.data.pieces.map((p) => ({ ...p, appareils: p.appareils.map((a) => (a.id === entite ? { ...a, actif: !a.actif, etat: a.actif ? 'éteinte' : 'allumée' } : a)) })) } }
        )
      )
    const restore = (turnId: string) => {
      const group = pile.find((g) => g[0]?.turnId === turnId)
      if (!group) return
      setPile([views, ...pile.filter((g) => g !== group)].slice(0, 3))
      setViews(group)
    }
    if (kind === 'chat') {
      const t = Date.now() - 300_000
      return (
        <div className="phone code-grid-bg phone--chat">
          <header className="phone__header">
            <div className="phone__brand">
              <span className="phone__nom">Code</span>
              <span className="phone__hello">Atelier · chat</span>
            </div>
          </header>
          <main className="phone__center">
            <EdgeSwarm mode="reflexion" />
            <ChatThread
              thinking
              activity="Agenda de demain"
              messages={[
                { id: '1', role: 'user', text: 'J’ai combien de rendez-vous demain ?', ts: t },
                { id: '2', role: 'assistant', text: 'Trois rendez-vous demain. Le premier :\n- Dentiste, à 9:30, 12 rue des Lilas', ts: t + 4000 },
                { id: '3', role: 'user', text: 'Montre-moi l’agenda de demain', ts: t + 60_000 }
              ]}
            />
          </main>
          <nav className="phone__bar">
            <ChatComposer onSend={() => true} busy onStop={() => {}} onDocument={() => {}} envoi={new URLSearchParams(location.search).has('envoi') ? { nom: 'IMG_2231.jpg' } : null} />
          </nav>
        </div>
      )
    }
    if (kind === 'dock') {
      // Réglette et tiroir avec des données d'exemple : un faux client qui n'envoie rien.
      const pick = <T,>(k: string) => SAMPLES[k]?.[0]?.data as T
      const rappels = pick<UiRappels>('rappels').groupes.flatMap((g) => g.rappels).filter((r) => r.etat !== 'sonne')
      const agenda = pick<UiAgenda>('agenda').jours[0]?.evenements ?? []
      const fake = {
        state: {
          connection: 'connecte',
          google: { etat: 'connecte', gmail: true, agenda: true, drive: true },
          rappels,
          echeances: pick<UiEcheancier>('echeancier').groupes.flatMap((g) => g.echeances),
          utilisateur: { reglages: { fuseau: 'Europe/Paris', widgets: ['aujourdhui', 'rappels', 'echeances', 'mails', 'taches'].map((id) => ({ id, colonne: 'droite', visible: true })) } },
          taches: pick<UiTaches>('taches').taches,
          perso: { at: Date.now(), agenda, mails: pick<UiMails>('mails').lignes }
        },
        client: { refreshPerso() {}, reminderAction() {}, taskAction() {}, echeanceReglee() {} }
      } as unknown as Code
      // Toucher l'orbe retire la réglette (comme pendant une conversation) : la rangée d'actions descend.
      function DockLab() {
        const [retiree, setRetiree] = useState(new URLSearchParams(location.search).has('retiree'))
        const rond = (d: string) => (
          <button type="button" className="phone__iface">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={d} />
            </svg>
          </button>
        )
        return (
          <div className="phone code-grid-bg">
            <header className="phone__header">
              <div className="phone__brand">
                <span className="phone__logo-wrap">
                  <span className="phone__nom">Nova</span>
                  <span className="phone__link" />
                </span>
                <span className="phone__hello">Bonjour, Camille</span>
              </div>
              <div className="phone__tools">
                <button type="button" className="phone__wx">
                  <SkyIcon ciel="eclaircies" nuit={false} size={22} />
                  28°
                </button>
              </div>
            </header>
            <main className="phone__center">
              <button type="button" className="phone__orb" onClick={() => setRetiree((v) => !v)}>
                <Orb mode={retiree ? 'ecoute' : 'repos'} size={280} label={retiree ? 'EN CONVERSATION' : 'EN VEILLE'} />
              </button>
              <span className="phone__hint">{retiree ? 'Réglette retirée : touchez pour la rendre' : 'Touchez l’orbe pour retirer la réglette'}</span>
            </main>
            <section className="phone__feed" />
            <nav className="phone__actions" aria-label="Actions">
              {rond('M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z')}
              {rond('M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16')}
              {rond('M4 5h16v11H9l-5 4z')}
              <button type="button" className="phone__iface phone__iface--on">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 7.5 12 3l9 4.5-9 4.5z" />
                  <path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" />
                </svg>
              </button>
              <PhoneMenu items={[{ label: 'Mode conversation', icon: <MicIcon />, onClick: () => {} }, { label: 'Réglages', icon: <MicIcon />, onClick: () => {} }]} />
            </nav>
            <Dock code={fake} hidden={retiree} show={(tool) => console.log('afficher', tool)} />
          </div>
        )
      }
      return <DockLab />
    }
    return (
      <div className="phone code-grid-bg phone--holo">
        <header className="phone__header">
          <div className="phone__brand">
            <span className="phone__nom">Code</span>
            <span className="phone__hello">Atelier · {kind}</span>
          </div>
        </header>
        <main className="phone__center">
          <EdgeSwarm mode="parole" />
          <HoloStage views={views} pile={pile} onRestore={restore} onClose={() => (setViews([]), setPile([]))} onAction={() => {}} resolveUrl={(p) => p} onAsk={(t) => console.log('question', t)} onListe={cocherLab} onMaison={basculerLab} />
        </main>
      </div>
    )
  }
  return <Lab />
}

const labKind = import.meta.env.DEV ? new URLSearchParams(location.search).get('lab') : null
void (labKind ? lab(labKind) : Promise.resolve(<App />)).then((root) =>
  createRoot(document.getElementById('root')!).render(<StrictMode>{root}</StrictMode>)
)
