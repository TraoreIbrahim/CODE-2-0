import { SYNTHESES, SYNTHESE_INFOS, VOICE_SAMPLE_RATE, syntheseEffective, type ChoixSynthese, type QualiteVoix, type SyntheseId } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import type { Secrets } from '../secrets.ts'
import { ID_VOIX } from './elevenlabs-voix.ts'
import { pourLaVoix } from './prononciation.ts'

/** ~100 ms d'audio par envoi : assez petit pour démarrer vite, assez gros pour peu de messages. */
const CHUNK_BYTES = Math.round(VOICE_SAMPLE_RATE * 2 * 0.1)

/**
 * La voix de l'utilisateur (une de `voice.tts.choix`, ou une voix de son compte ElevenLabs), sa vitesse, le
 * modèle ElevenLabs et le service qui la dit (`reglages.synthese`) ; absents : la voix par défaut, vitesse
 * normale, modèle rapide, service automatique.
 */
export type TtsOptions = { voix?: string; vitesse?: number; qualite?: QualiteVoix; synthese?: ChoixSynthese }

export type Tts = {
  /** Le service et la voix retenus pour ce choix (repli compris), pour le journal. */
  decrire(choix?: ChoixSynthese): string
  /** Synthétise une proposition ; produit du PCM 16 bits mono 24 kHz par morceaux. */
  synthesize(text: string, signal: AbortSignal, opts?: TtsOptions): AsyncGenerator<Buffer>
}

/** Un service de synthèse prêt, avec sa clé. */
type Service = { voix: string; synthesize(text: string, signal: AbortSignal, opts: TtsOptions): AsyncGenerator<Buffer> }

const choixOf = (id: string | undefined) => codeConfig.voice.tts.choix.find((v) => v.id === id)

/** Renvoie la synthèse disponible, ou `null` si aucune clé ne le permet (mode texte seul). */
export async function createTts(secrets: Secrets): Promise<Tts | null> {
  const tts = await pickTts(secrets)
  // Chiffres, codes et téléphones en toutes lettres : la voix rapide d'ElevenLabs les mâche (prononciation.ts).
  return tts && { ...tts, synthesize: (t, s, o) => tts.synthesize(pourLaVoix(t), s, o) }
}

async function pickTts(secrets: Secrets): Promise<Tts | null> {
  // Tests de bout en bout : une voix factice (un court son), sans service ni coût, qui note la voix demandée.
  if (process.env.CODE_TTS_FAUX) return { decrire: () => 'faux · factice', synthesize: fakeTts }
  const cfg = codeConfig.voice.tts
  const services: Partial<Record<SyntheseId, Service>> = {}
  const eleven = secrets.ELEVENLABS_API_KEY
  if (eleven) {
    const voice = await pickElevenLabsVoice(eleven)
    // Une voix choisie par l'utilisateur (de base ou de son compte) passe avant celle du démarrage ; sinon, celle-ci.
    if (voice) services.elevenlabs = { voix: voice.name, synthesize: (t, s, o) => elevenlabsOuDefaut(eleven, o.voix && ID_VOIX.test(o.voix) ? o.voix : voice.id, voice.id, t, s, o) }
  }
  const openai = secrets.OPENAI_API_KEY
  if (openai) services.openai = { voix: cfg.openaiVoice, synthesize: (t, s, o) => openaiTts(openai, t, s, o) }
  const deepgram = secrets.DEEPGRAM_API_KEY
  if (deepgram) services.deepgram = { voix: cfg.deepgramVoice, synthesize: (t, s, o) => deepgramTts(deepgram, t, s, o) }
  const gemini = secrets.GEMINI_API_KEY
  if (gemini) services.gemini = { voix: cfg.geminiVoice, synthesize: (t, s, o) => geminiTts(gemini, t, s, o) }

  const pour = (choix: ChoixSynthese = 'auto'): [SyntheseId, Service] | null => {
    const id = syntheseEffective(choix, (c) => SYNTHESES.some((x) => SYNTHESE_INFOS[x].cle === c && services[x])).synthese
    return id ? [id, services[id]!] : null
  }
  if (!pour()) return null
  return {
    decrire: (choix) => {
      const [id, service] = pour(choix)!
      return `${id} · ${service.voix}`
    },
    synthesize: (text, signal, opts = {}) => pour(opts.synthese)![1].synthesize(text, signal, opts)
  }
}

/** La voix de `elevenlabsVoiceId`, sinon la première voix du compte ElevenLabs. */
async function pickElevenLabsVoice(key: string): Promise<{ id: string; name: string } | null> {
  const wanted = codeConfig.voice.tts.elevenlabsVoiceId
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } })
    if (!res.ok) {
      console.warn(`[voix] ElevenLabs a refusé la clé (${res.status}).`)
      return wanted ? { id: wanted, name: wanted } : null
    }
    const { voices = [] } = (await res.json()) as { voices?: { voice_id: string; name: string }[] }
    const found = voices.find((v) => v.voice_id === wanted) ?? (wanted ? undefined : voices[0])
    if (!found) {
      console.warn(wanted ? `[voix] Voix ElevenLabs « ${wanted} » introuvable sur ce compte.` : '[voix] Aucune voix sur le compte ElevenLabs.')
      return wanted ? { id: wanted, name: wanted } : null
    }
    if (!wanted) {
      console.log(`[voix] Aucune voix choisie : « ${found.name} » par défaut. Voix disponibles :`)
      for (const v of voices) console.log(`        ${v.name}  →  elevenlabsVoiceId: '${v.voice_id}'`)
    }
    return { id: found.voice_id, name: found.name }
  } catch (err) {
    console.warn('[voix] ElevenLabs injoignable :', err instanceof Error ? err.message : err)
    return wanted ? { id: wanted, name: wanted } : null
  }
}

/** La voix choisie ; retirée du compte ElevenLabs entre-temps, la voix par défaut prend le relais. */
async function* elevenlabsOuDefaut(key: string, voiceId: string, defaut: string, text: string, signal: AbortSignal, o: TtsOptions): AsyncGenerator<Buffer> {
  try {
    yield* elevenlabs(key, voiceId, text, signal, o.vitesse, o.qualite)
  } catch (err) {
    if (!(err instanceof VoixAbsente) || voiceId === defaut) throw err
    console.warn(`[voix] Voix ElevenLabs « ${voiceId} » introuvable : voix par défaut.`)
    yield* elevenlabs(key, defaut, text, signal, o.vitesse, o.qualite)
  }
}

class VoixAbsente extends Error {}

async function* elevenlabs(key: string, voiceId: string, text: string, signal: AbortSignal, vitesse = 1, qualite: QualiteVoix = 'rapide'): AsyncGenerator<Buffer> {
  const cfg = codeConfig.voice.tts
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=pcm_${VOICE_SAMPLE_RATE}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      // Vitesse normale : rien n'est envoyé, la voix garde ses propres réglages (stabilité, timbre).
      body: JSON.stringify({
        text,
        model_id: qualite === 'naturelle' ? cfg.elevenlabsModelNaturel : cfg.elevenlabsModel,
        // Flash peut prendre une phrase courte pour de l'anglais : le français lui est imposé (le multilingue n'a pas ce réglage).
        ...(qualite === 'rapide' ? { language_code: 'fr' } : {}),
        ...(vitesse !== 1 ? { voice_settings: { speed: vitesse } } : {})
      }),
      signal
    }
  )
  if (res.status === 404 || (res.status === 400 && /voice_not_found|voice_does_not_exist/.test(await res.clone().text().catch(() => '')))) {
    throw new VoixAbsente(`Voix ElevenLabs « ${voiceId} » introuvable.`)
  }
  if (!res.ok || !res.body) throw new Error(`Synthèse ElevenLabs échouée (${res.status}) : ${(await res.text().catch(() => '')).slice(0, 160)}`)
  yield* rechunk(res.body)
}

async function* openaiTts(key: string, text: string, signal: AbortSignal, opts: TtsOptions = {}): AsyncGenerator<Buffer> {
  const cfg = codeConfig.voice.tts
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.openaiModel,
      voice: choixOf(opts.voix)?.openai ?? cfg.openaiVoice,
      input: text,
      instructions: 'Parle en français, d’une voix posée et assurée, à un rythme naturel.',
      response_format: 'pcm',
      ...(opts.vitesse && opts.vitesse !== 1 ? { speed: opts.vitesse } : {})
    }),
    signal
  })
  if (!res.ok || !res.body) throw new Error(`Synthèse OpenAI échouée (${res.status}).`)
  yield* rechunk(res.body)
}

/** Deepgram Aura : très rapide ; la voix est dans le nom du modèle. La vitesse n'est pas réglable. */
async function* deepgramTts(key: string, text: string, signal: AbortSignal, opts: TtsOptions = {}): AsyncGenerator<Buffer> {
  const params = new URLSearchParams({
    model: choixOf(opts.voix)?.deepgram ?? codeConfig.voice.tts.deepgramVoice,
    encoding: 'linear16',
    sample_rate: String(VOICE_SAMPLE_RATE),
    container: 'none'
  })
  const res = await fetch(`https://api.deepgram.com/v1/speak?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal
  })
  if (!res.ok || !res.body) throw new Error(`Synthèse Deepgram échouée (${res.status}) : ${(await res.text().catch(() => '')).slice(0, 160)}`)
  yield* rechunk(res.body)
}

/** Gemini : le son arrive d'un bloc (PCM 24 kHz en base64), puis part par morceaux comme les autres. */
async function* geminiTts(key: string, text: string, signal: AbortSignal, opts: TtsOptions = {}): AsyncGenerator<Buffer> {
  const cfg = codeConfig.voice.tts
  const vitesse = opts.vitesse ?? 1
  const allure = vitesse > 1 ? ', un peu vite' : vitesse < 1 ? ', un peu lentement' : ''
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Dis en français, d’une voix posée et assurée${allure} : ${text}` }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: choixOf(opts.voix)?.gemini ?? cfg.geminiVoice } } }
      }
    }),
    signal
  })
  if (!res.ok) throw new Error(`Synthèse Gemini échouée (${res.status}) : ${(await res.text().catch(() => '')).slice(0, 160)}`)
  const data = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] }
  const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data
  if (!b64) throw new Error('Synthèse Gemini : aucun son reçu.')
  const pcm = Buffer.from(b64, 'base64')
  const even = pcm.length - (pcm.length % 2)
  for (let i = 0; i < even && !signal.aborted; i += CHUNK_BYTES) yield pcm.subarray(i, Math.min(i + CHUNK_BYTES, even))
}

/** Regroupe le flux HTTP en morceaux réguliers, toujours alignés sur un échantillon (2 octets). */
async function* rechunk(body: ReadableStream<Uint8Array>): AsyncGenerator<Buffer> {
  let buf = Buffer.alloc(0)
  for await (const part of body as unknown as AsyncIterable<Uint8Array>) {
    buf = Buffer.concat([buf, Buffer.from(part)])
    while (buf.length >= CHUNK_BYTES) {
      yield buf.subarray(0, CHUNK_BYTES)
      buf = buf.subarray(CHUNK_BYTES)
    }
  }
  const even = buf.length - (buf.length % 2)
  if (even > 0) yield buf.subarray(0, even)
}

/** Voix factice (CODE_TTS_FAUX) : un bip court, plus aigu pour une voix rapide ; la voix demandée est notée au journal. */
async function* fakeTts(text: string, signal: AbortSignal, opts: TtsOptions = {}): AsyncGenerator<Buffer> {
  console.log(`[voix] synthèse factice : voix=${opts.voix ?? 'défaut'} vitesse=${opts.vitesse ?? 1} service=${opts.synthese ?? 'auto'} (${text.length} caractères)`)
  const n = Math.round(VOICE_SAMPLE_RATE * 0.3)
  const pcm = Buffer.alloc(n * 2)
  const hz = 330 * (opts.vitesse ?? 1)
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / VOICE_SAMPLE_RATE) * 6000 * Math.sin((Math.PI * i) / n)), i * 2)
  for (let i = 0; i < pcm.length && !signal.aborted; i += CHUNK_BYTES) yield pcm.subarray(i, i + CHUNK_BYTES)
}
