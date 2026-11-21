import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { NOM_ASSISTANT_DEFAUT } from '@code/protocol'
import type { ChatMessage } from './client.ts'
import { formatTime } from './view.ts'

/**
 * Mode chat : écrire à l'assistant et lire ses réponses, sans voix (endroit bruyant, réunion…).
 * Le fil et la zone de saisie sont séparés pour que chaque app les place à sa façon.
 */

/** **gras** dans une ligne : la seule mise en valeur en ligne. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) => (/^\*\*[^*\n]+\*\*$/.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>))}
    </>
  )
}

const BULLET = /^\s*[-•]\s+/
const QUOTE = /^\s*>\s?/

/** Paragraphes, listes à tirets, citations (« > ») et gras : la seule mise en forme que CODE utilise en mode écrit. */
export function Rich({ text }: { text: string }) {
  // Lignes consécutives de même sorte → un bloc ; une ligne vide sépare les paragraphes.
  const blocks: { kind: 'p' | 'ul' | 'quote'; lines: string[] }[] = []
  for (const line of text.split('\n')) {
    const prev = blocks[blocks.length - 1]
    if (!line.trim()) {
      blocks.push({ kind: 'p', lines: [] })
      continue
    }
    const kind = QUOTE.test(line) ? 'quote' : BULLET.test(line) ? 'ul' : 'p'
    const content = kind === 'quote' ? line.replace(QUOTE, '') : kind === 'ul' ? line.replace(BULLET, '') : line
    if (prev && prev.kind === kind && (kind !== 'p' || prev.lines.length > 0)) prev.lines.push(content)
    else blocks.push({ kind, lines: [content] })
  }
  const lines = (list: string[]) =>
    list.map((l, j) => (
      <Fragment key={j}>
        {j > 0 && <br />}
        <Inline text={l} />
      </Fragment>
    ))
  return (
    <>
      {blocks
        .filter((b) => b.lines.some((l) => l.trim()))
        .map((b, i) =>
          b.kind === 'ul' ? (
            <ul key={i}>
              {b.lines.map((l, j) => (
                <li key={j}>
                  <Inline text={l} />
                </li>
              ))}
            </ul>
          ) : b.kind === 'quote' ? (
            <blockquote key={i} className="chat-quote">
              {lines(b.lines)}
            </blockquote>
          ) : (
            <p key={i}>{lines(b.lines)}</p>
          )
        )}
    </>
  )
}

type ThreadProps = {
  messages: ChatMessage[]
  /** CODE réfléchit à la réponse au dernier message. */
  thinking: boolean
  /** Ce que CODE est en train de faire (« Google Agenda · Semaine »), pendant la réflexion. */
  activity?: string
  /** Contenu affiché quand le fil est vide. */
  empty?: ReactNode
  /** Le nom que la personne a donné à son assistant. */
  nom?: string
}

export function ChatThread({ messages, thinking, activity, empty, nom = NOM_ASSISTANT_DEFAUT }: ThreadProps) {
  const end = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const last = messages[messages.length - 1]
  const waiting = thinking && (!last || last.role === 'user' || !last.text)

  // Reste collé en bas tant qu'on n'a pas remonté le fil pour relire.
  useLayoutEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: 'end' })
  }, [messages, waiting])

  return (
    <div
      className="chat-thread"
      ref={box}
      role="log"
      aria-live="polite"
      aria-label={`Conversation avec ${nom}`}
      onScroll={() => {
        const el = box.current
        if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
    >
      {messages.length === 0 && !waiting && <div className="chat-empty">{empty ?? `Écrivez à ${nom} : il vous répond ici, sans voix.`}</div>}
      {messages.map((m) => (
        <article key={m.id} className={`chat-msg chat-msg--${m.role}${m.streaming ? ' is-streaming' : ''}`}>
          <header className="chat-msg__meta">
            <span>{m.role === 'user' ? 'VOUS' : nom.toUpperCase()}</span>
            <time dateTime={new Date(m.ts).toISOString()}>{formatTime(m.ts)}</time>
            {m.interrupted && <span className="chat-msg__cut">interrompu</span>}
          </header>
          <div className="chat-msg__body">
            <Rich text={m.text} />
          </div>
        </article>
      ))}
      {waiting && (
        <article className="chat-msg chat-msg--assistant chat-msg--thinking" aria-label={`${nom} réfléchit`}>
          <header className="chat-msg__meta">
            <span>{nom.toUpperCase()}</span>
          </header>
          <div className="chat-msg__body">
            <span className="chat-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {activity && <span className="chat-activity">{activity}</span>}
          </div>
        </article>
      )}
      <div ref={end} />
    </div>
  )
}

/** Choisir un papier à envoyer : photo (appareil photo ou galerie sur le téléphone) ou PDF. */
export function BoutonDocument({ onFile, disabled, className, label = 'Envoyer un papier (photo ou PDF)', accept = 'image/*,application/pdf', children }: { onFile: (f: File) => void; disabled?: boolean; className: string; label?: string; accept?: string; children: ReactNode }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className={className} aria-label={label} title={label} disabled={disabled} onClick={() => input.current?.click()}>
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          // Vidé aussitôt : le même fichier peut être renvoyé après un échec.
          e.target.value = ''
          if (f) onFile(f)
        }}
      />
    </>
  )
}

export const TROMBONE = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.2-8.2a3.4 3.4 0 0 1 4.8 4.8l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.5-7.5" />
  </svg>
)

/** L'envoi d'un papier : en cours, ou pourquoi il a échoué (avec de quoi fermer le message). */
export function EnvoiDocument({ envoi, onClose, className = 'chat-envoi' }: { envoi: { nom: string; erreur?: string } | null; onClose: () => void; className?: string }) {
  if (!envoi) return null
  return (
    <p className={`${className}${envoi.erreur ? ' is-erreur' : ''}`} role={envoi.erreur ? 'alert' : 'status'}>
      <span>{envoi.erreur ? `« ${envoi.nom} » n’est pas parti : ${envoi.erreur}` : `Envoi de « ${envoi.nom} »…`}</span>
      {envoi.erreur && (
        <button type="button" onClick={onClose} aria-label="Fermer">
          ×
        </button>
      )}
    </p>
  )
}

type ComposerProps = {
  onSend: (text: string) => boolean
  /** CODE répond : on peut l'arrêter. */
  busy: boolean
  onStop: () => void
  disabled?: boolean
  placeholder?: string
  autoFocus?: boolean
  /** Le nom que la personne a donné à son assistant. */
  nom?: string
  /** Envoyer un papier (trombone) : photo ou PDF, lu et rangé par l'assistant. */
  onDocument?: (f: File) => void
  envoi?: { nom: string; erreur?: string } | null
  onOublierEnvoi?: () => void
}

export function ChatComposer({ onSend, busy, onStop, disabled, nom = NOM_ASSISTANT_DEFAUT, placeholder = `Écrire à ${nom}…`, autoFocus, onDocument, envoi = null, onOublierEnvoi = () => {} }: ComposerProps) {
  const [text, setText] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  // Clavier physique : Entrée envoie (Maj+Entrée pour aller à la ligne). Écran tactile : Entrée va à la ligne.
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  // La zone grandit avec le texte, jusqu'à cinq lignes.
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [text])

  const send = () => {
    const clean = text.trim()
    if (!clean || disabled) return
    if (onSend(clean)) setText('')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    send()
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <form className={`chat-composer${onDocument ? ' chat-composer--piece' : ''}`} onSubmit={submit}>
      <EnvoiDocument envoi={envoi} onClose={onOublierEnvoi} />
      {onDocument && (
        <BoutonDocument className="chat-attach" onFile={onDocument} disabled={disabled || Boolean(envoi && !envoi.erreur)} label="Joindre un papier (photo ou PDF) ou l’enregistrement d’une réunion (audio)" accept="image/*,application/pdf,audio/*,.m4a,.mp3,.wav,.ogg,.flac,.aac">
          {TROMBONE}
        </BoutonDocument>
      )}
      <label htmlFor="chat-input" className="sr-only">
        Message à {nom}
      </label>
      <textarea
        id="chat-input"
        ref={area}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={disabled ? 'Mac injoignable…' : placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        enterKeyHint={touch ? 'enter' : 'send'}
      />
      {busy ? (
        <button type="button" className="chat-send chat-send--stop" onClick={onStop} aria-label="Arrêter la réponse">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      ) : (
        <button type="submit" className="chat-send" disabled={disabled || !text.trim()} aria-label="Envoyer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h13M13 6l6 6-6 6" />
          </svg>
        </button>
      )}
    </form>
  )
}

/** Ce que le fil et la zone de saisie attendent, à partir de l'état de CODE. */
export function chatState(code: { state: import('./client.ts').ClientState; client: import('./client.ts').CodeClient }) {
  const { state, client } = code
  const connected = state.connection === 'connecte' && state.serverState !== 'arret'
  const loading = state.views.find((v) => v.status === 'chargement')
  return {
    messages: state.thread,
    thinking: state.serverState === 'reflexion',
    activity: loading ? loading.title : undefined,
    busy: state.serverState === 'reflexion' || state.serverState === 'parole',
    disabled: !connected,
    /** Message écrit, réponse sans voix. */
    send: (text: string) => client.send({ type: 'text', text, voice: false }),
    /** Un papier joint au trombone : réponse écrite, elle aussi. */
    document: (f: File) => void client.envoyerDocument(f, false),
    envoi: state.documentEnvoi,
    oublierEnvoi: () => client.oublierEnvoiDocument(),
    stop: () => void client.send({ type: 'interrupt' })
  }
}
