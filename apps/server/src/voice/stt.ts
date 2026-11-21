import WebSocket from 'ws'
import { MIC_SAMPLE_RATE, TRANSCRIPTION_INFOS, transcriptionEffective, type ChoixTranscription, type TranscriptionId } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import type { Secrets } from '../secrets.ts'
import { wav } from './pcm.ts'
import type { MotsCles } from './vocabulaire.ts'

/** Une prise de parole : l'audio arrive par morceaux, le texte sort à la fin. */
export interface SttStream {
  write(pcm: Buffer): void
  /** Termine la prise de parole et renvoie la transcription finale. */
  finish(): Promise<string>
  abort(): void
}

export class SttUnavailable extends Error {}

/**
 * Ouvre une prise de parole, avec le service choisi (`reglages.transcription`) ou, sans sa clé, le premier
 * disponible (`transcriptionEffective`).
 * - Deepgram (streaming), quand sa clé existe, fournit le texte en direct pendant que l'on parle.
 * - La phrase finale, celle que lit le moteur, vient du service retenu ; s'il échoue, Deepgram prend le relais.
 */
export function openStt(
  secrets: Secrets,
  onPartial: (text: string) => void,
  terms: MotsCles = { scribe: codeConfig.voice.stt.keyterms, deepgram: codeConfig.voice.stt.keyterms },
  choix: ChoixTranscription = 'auto'
): SttStream {
  const { finale, direct } = transcriptionEffective(choix, (c) => !!secrets[c])
  if (!finale) throw new SttUnavailable('Aucune clé de transcription (ElevenLabs, Deepgram, Groq, Mistral ou OpenAI) : ajoutez-en une dans Réglages › Clés API.')
  const live = direct ? new DeepgramStream(secrets.DEEPGRAM_API_KEY!, onPartial, terms.deepgram) : null
  if (finale === 'deepgram') return live!
  const accurate = phraseEntiere(finale, secrets, terms)
  return live ? new HybridStream(live, accurate) : accurate
}

/** Les services qui transcrivent la phrase une fois finie (tous sauf Deepgram, qui transcrit en continu). */
function phraseEntiere(id: Exclude<TranscriptionId, 'deepgram'>, secrets: Secrets, terms: MotsCles): SttStream {
  const cfg = codeConfig.voice.stt
  const key = secrets[TRANSCRIPTION_INFOS[id].cle]!
  switch (id) {
    case 'elevenlabs':
      return new ScribeStream(key, terms.scribe)
    case 'groq':
      // Le prompt de Whisper est court (224 jetons) : les premiers mots-clés seulement.
      return new FichierStream('Groq', 'https://api.groq.com/openai/v1/audio/transcriptions', key, cfg.groqModel, terms.deepgram.slice(0, 30).join(', '))
    case 'openai':
      return new FichierStream('OpenAI', 'https://api.openai.com/v1/audio/transcriptions', key, cfg.openaiModel, terms.deepgram.slice(0, 30).join(', '))
    case 'mistral':
      return new FichierStream('Mistral', 'https://api.mistral.ai/v1/audio/transcriptions', key, cfg.mistralModel)
  }
}

/** Texte en direct par l'un, transcription finale par l'autre (repli sur le premier en cas d'échec). */
class HybridStream implements SttStream {
  constructor(private readonly live: SttStream, private readonly accurate: SttStream) {}

  write(pcm: Buffer): void {
    this.live.write(pcm)
    this.accurate.write(pcm)
  }

  async finish(): Promise<string> {
    const [fast, best] = await Promise.allSettled([this.live.finish(), this.accurate.finish()])
    if (best.status === 'fulfilled' && best.value) return best.value
    if (best.status === 'rejected') console.warn('[stt] Transcription précise indisponible :', best.reason instanceof Error ? best.reason.message : best.reason)
    if (fast.status === 'fulfilled') return fast.value
    throw fast.reason
  }

  abort(): void {
    this.live.abort()
    this.accurate.abort()
  }
}

type DeepgramResult = {
  type?: string
  is_final?: boolean
  from_finalize?: boolean
  channel?: { alternatives?: { transcript?: string }[] }
}

/** Deepgram en streaming : transcription partielle pendant que l'on parle. */
class DeepgramStream implements SttStream {
  private ws!: WebSocket
  private pending: Buffer[] = []
  private finals: string[] = []
  private done: ((text: string) => void) | null = null
  private failed: Error | null = null
  private finalizeRequested = false

  /** `terms` : les mots-clés les plus utiles, déjà dans la limite de 500 jetons de Deepgram (paramètre `keyterm`, répété). */
  constructor(private readonly key: string, private readonly onPartial: (text: string) => void, private readonly terms: string[]) {
    this.connect(true)
  }

  private connect(withKeyterms: boolean): void {
    const cfg = codeConfig.voice.stt
    const params = new URLSearchParams({
      model: cfg.deepgramModel,
      language: cfg.language,
      encoding: 'linear16',
      sample_rate: String(MIC_SAMPLE_RATE),
      channels: '1',
      interim_results: 'true',
      punctuate: 'true',
      smart_format: 'true'
    })
    if (withKeyterms) for (const term of this.terms) params.append('keyterm', term)
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, { headers: { Authorization: `Token ${this.key}` } })
    this.ws = ws
    ws.on('open', () => {
      for (const chunk of this.pending.splice(0)) ws.send(chunk)
      if (this.finalizeRequested) ws.send(JSON.stringify({ type: 'Finalize' }))
    })
    ws.on('unexpected-response', (_req, res) => {
      // Mots-clés refusés pour ce modèle ou cette langue : on réessaie sans eux.
      if (res.statusCode === 400 && withKeyterms) this.connect(false)
      else this.fail(new Error(`Deepgram a refusé la connexion (${res.statusCode}).`))
    })
    ws.on('message', (raw) => {
      if (ws === this.ws) this.onMessage(raw.toString())
    })
    ws.on('error', (err) => {
      if (ws === this.ws) this.fail(err)
    })
    ws.on('close', () => {
      if (ws === this.ws) this.complete()
    })
  }

  private onMessage(raw: string): void {
    let msg: DeepgramResult
    try {
      msg = JSON.parse(raw) as DeepgramResult
    } catch {
      return
    }
    if (msg.type !== 'Results') return
    const text = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? ''
    if (msg.is_final) {
      if (text) this.finals.push(text)
      this.onPartial(this.finals.join(' '))
      if (msg.from_finalize) this.complete()
    } else if (text) {
      this.onPartial([...this.finals, text].join(' '))
    }
  }

  private fail(err: Error): void {
    this.failed = err
    this.complete()
  }

  private complete(): void {
    const done = this.done
    this.done = null
    done?.(this.finals.join(' ').trim())
  }

  write(pcm: Buffer): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(pcm)
    else if (this.ws.readyState === WebSocket.CONNECTING) this.pending.push(pcm)
  }

  finish(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.complete(), 2_000)
      this.done = (text) => {
        clearTimeout(timer)
        try {
          if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'CloseStream' }))
        } catch {}
        if (!text && this.failed) reject(this.failed)
        else resolve(text)
      }
      if (this.failed) return this.complete()
      this.finalizeRequested = true
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'Finalize' }))
    })
  }

  abort(): void {
    this.done = null
    this.ws.terminate()
  }
}

/**
 * La phrase entière, une fois finie, au format de transcription d'OpenAI (Groq Whisper, Mistral Voxtral,
 * OpenAI) : pas de texte en direct. `prompt` : quelques noms propres, pour ceux qui l'acceptent.
 */
class FichierStream implements SttStream {
  private chunks: Buffer[] = []
  private controller = new AbortController()

  constructor(
    private readonly nom: string,
    private readonly url: string,
    private readonly key: string,
    private readonly model: string,
    private readonly prompt?: string
  ) {}

  write(pcm: Buffer): void {
    this.chunks.push(pcm)
  }

  async finish(): Promise<string> {
    const audio = Buffer.concat(this.chunks)
    if (audio.length < MIC_SAMPLE_RATE * 2 * 0.2) return ''
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(wav(audio, MIC_SAMPLE_RATE))], { type: 'audio/wav' }), 'phrase.wav')
    form.append('model', this.model)
    form.append('language', codeConfig.voice.stt.language)
    if (this.prompt) form.append('prompt', this.prompt)
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}` },
      body: form,
      signal: this.controller.signal
    })
    if (!res.ok) throw new Error(`Transcription ${this.nom} échouée (${res.status}) : ${(await res.text().catch(() => '')).slice(0, 160)}`)
    const data = (await res.json()) as { text?: string }
    return (data.text ?? '').trim()
  }

  abort(): void {
    this.controller.abort()
  }
}

/**
 * Scribe (ElevenLabs) : la phrase entière, une fois finie. Le plus juste sur le français et les noms propres.
 * Mots-clés (`keyterms`, répété) : 1 000 au plus, moins de 50 caractères et 5 mots chacun ; +20 % sur la
 * transcription, et 20 s facturées au minimum par phrase au-delà de 100 mots-clés.
 */
class ScribeStream implements SttStream {
  private chunks: Buffer[] = []
  private controller = new AbortController()

  constructor(
    private readonly key: string,
    private readonly terms: string[]
  ) {}

  write(pcm: Buffer): void {
    this.chunks.push(pcm)
  }

  async finish(): Promise<string> {
    const audio = Buffer.concat(this.chunks)
    if (audio.length < MIC_SAMPLE_RATE * 2 * 0.2) return ''
    const send = async (withKeyterms: boolean) => {
      const cfg = codeConfig.voice.stt
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(wav(audio, MIC_SAMPLE_RATE))], { type: 'audio/wav' }), 'phrase.wav')
      form.append('model_id', cfg.scribeModel)
      form.append('language_code', cfg.language)
      form.append('tag_audio_events', 'false')
      if (withKeyterms) for (const term of this.terms) form.append('keyterms', term)
      return fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': this.key },
        body: form,
        signal: this.controller.signal
      })
    }
    let res = await send(true)
    // Mots-clés refusés (format, forfait) : on réessaie sans.
    if (res.status === 400 || res.status === 422) res = await send(false)
    if (!res.ok) throw new Error(`Transcription Scribe échouée (${res.status}) : ${(await res.text().catch(() => '')).slice(0, 160)}`)
    const data = (await res.json()) as { text?: string }
    return (data.text ?? '').trim()
  }

  abort(): void {
    this.controller.abort()
  }
}
