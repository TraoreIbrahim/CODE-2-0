import { readFileSync } from 'node:fs'
import { TRANSCRIPTIONS, TRANSCRIPTION_INFOS, type CleApi, type TranscriptionId } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import type { Secrets } from '../secrets.ts'
import { cloreTranscription, echecReunion, fichierSegment, finDuPrecedent, noterEchec, noterTexte, prochainSegment, reunionParId, reunionsEnTranscription } from './store.ts'

/**
 * La transcription d'une réunion : morceau par morceau, dans l'ordre, avec le service le moins cher dont la
 * personne a la clé. Un long enregistrement n'a pas besoin du texte en direct ni du service le plus fin de la
 * voix : à qualité voisine, l'écart de prix va de 1 à 6.
 */

const cfg = () => codeConfig.voice.reunions

/** Dollars par heure d'audio, pour choisir et pour afficher une estimation. */
export function tarifHeure(id: TranscriptionId): number {
  return cfg().tarifs[id]
}

/** Les services dont la clé existe, du moins cher au plus cher. */
export function servicesReunion(aCle: (cle: CleApi) => boolean): TranscriptionId[] {
  return TRANSCRIPTIONS.filter((t) => aCle(TRANSCRIPTION_INFOS[t].cle)).sort((a, b) => tarifHeure(a) - tarifHeure(b))
}

/** Celui qui transcrira : le moins cher ; null sans aucune clé de transcription. */
export function serviceReunion(aCle: (cle: CleApi) => boolean): TranscriptionId | null {
  return servicesReunion(aCle)[0] ?? null
}

/**
 * Ce que Whisper invente sur un silence (génériques de sous-titres vus à l'entraînement) : un morceau qui
 * ne contient que cela est vide.
 */
const INVENTIONS = /^(\s*(sous-titres?( réalisés?)? (par|para) la communauté d['’ ]amara\.org|sous-titrage (st['’ ]? ?\d+|société radio-canada|fr ?\??)|merci d['’]avoir regardé( cette vidéo)?( ?!)?|merci\.?|\.+|…)\s*)+$/i

export function nettoyer(texte: string): string {
  const t = texte.replace(/\s+/g, ' ').trim()
  return INVENTIONS.test(t) ? '' : t
}

export class EchecTranscription extends Error {
  constructor(
    message: string,
    /** Vaut la peine de réessayer (surcharge, limite de débit, réseau). */
    readonly passager: boolean,
    /** La clé est refusée : inutile d'insister avec ce service. */
    readonly cleRefusee = false
  ) {
    super(message)
  }
}

async function reponse(nom: string, res: Response): Promise<Record<string, unknown>> {
  if (res.ok) return (await res.json()) as Record<string, unknown>
  const corps = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)
  throw new EchecTranscription(`${nom} a refusé (${res.status})${corps ? ` : ${corps}` : ''}`, res.status === 429 || res.status >= 500, res.status === 401 || res.status === 403)
}

const fichier = (wav: Buffer) => new Blob([new Uint8Array(wav)], { type: 'audio/wav' })

/** Transcrit un morceau (WAV) avec un service ; `contexte` : la fin du morceau précédent et quelques noms propres. */
export async function transcrireWav(id: TranscriptionId, cle: string, wav: Buffer, contexte = '', signal?: AbortSignal): Promise<string> {
  const stt = codeConfig.voice.stt
  const nom = TRANSCRIPTION_INFOS[id].nom
  try {
    if (id === 'deepgram') {
      const params = new URLSearchParams({ model: stt.deepgramModel, language: stt.language, punctuate: 'true', smart_format: 'true' })
      const data = await reponse(nom, await fetch(`https://api.deepgram.com/v1/listen?${params}`, { method: 'POST', headers: { Authorization: `Token ${cle}`, 'Content-Type': 'audio/wav' }, body: new Uint8Array(wav), signal }))
      const alt = (data.results as { channels?: { alternatives?: { transcript?: string }[] }[] } | undefined)?.channels?.[0]?.alternatives?.[0]
      return nettoyer(alt?.transcript ?? '')
    }
    const form = new FormData()
    form.append('file', fichier(wav), 'reunion.wav')
    if (id === 'elevenlabs') {
      form.append('model_id', stt.scribeModel)
      form.append('language_code', stt.language)
      form.append('tag_audio_events', 'false')
      const data = await reponse(nom, await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': cle }, body: form, signal }))
      return nettoyer(String(data.text ?? ''))
    }
    // Format de transcription d'OpenAI : Groq (Whisper), Mistral (Voxtral), OpenAI.
    const cible = {
      groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', modele: stt.groqModel, contexte: true },
      mistral: { url: 'https://api.mistral.ai/v1/audio/transcriptions', modele: stt.mistralModel, contexte: false },
      openai: { url: 'https://api.openai.com/v1/audio/transcriptions', modele: cfg().modeles.openai, contexte: true }
    }[id]
    form.append('model', cible.modele)
    form.append('language', stt.language)
    if (cible.contexte && contexte) form.append('prompt', contexte)
    const data = await reponse(nom, await fetch(cible.url, { method: 'POST', headers: { Authorization: `Bearer ${cle}` }, body: form, signal }))
    return nettoyer(String(data.text ?? ''))
  } catch (err) {
    if (err instanceof EchecTranscription) throw err
    // Réseau coupé, délai dépassé : à réessayer.
    throw new EchecTranscription(`${nom} injoignable : ${err instanceof Error ? err.message : String(err)}`, true)
  }
}

export type Transcrire = typeof transcrireWav

type Deps = {
  /** Les clés de la personne (les siennes, plus celles du serveur pour le propriétaire). */
  cles: (uid: number) => Secrets
  /** Les noms propres de son lexique, pour les services qui acceptent un contexte. */
  mots?: (uid: number) => string[]
  transcrire?: Transcrire
  /** Attentes entre deux essais d'un même morceau, en millisecondes. */
  attentes?: number[]
  delaiMs?: number
}

/**
 * La file : une réunion à la fois par numéro, ses morceaux dans l'ordre (chacun reçoit la fin du précédent).
 * Un service qui refuse sa clé passe la main au suivant ; un morceau qui échoue trois fois est laissé en
 * blanc, et la réunion va au bout.
 */
export class FileReunions {
  private enCours = new Set<number>()
  private fins = new Map<number, Promise<void>>()
  private deps: Deps | null = null

  configurer(deps: Deps): void {
    this.deps = deps
  }

  /** Reprend les transcriptions restées en plan (serveur redémarré). */
  reprendre(): void {
    for (const r of reunionsEnTranscription()) this.planifier(r.id)
  }

  /** À appeler quand un morceau arrive ou que l'enregistrement se termine. */
  planifier(id: number): void {
    if (!this.deps || this.enCours.has(id)) return
    this.enCours.add(id)
    const fin = this.traiter(id)
      .catch((err) => {
        const r = reunionParId(id)
        if (r) echecReunion(r.uid, id, err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        this.enCours.delete(id)
        this.fins.delete(id)
        // Un morceau arrivé pendant la clôture : on repart.
        const r = reunionParId(id)
        if (r && r.etat !== 'prete' && r.etat !== 'erreur' && prochainSegment(id)) this.planifier(id)
      })
    this.fins.set(id, fin)
  }

  /** Pour les tests : la fin du traitement en cours de cette réunion. */
  async attendre(id: number): Promise<void> {
    while (this.fins.has(id)) await this.fins.get(id)
  }

  private async traiter(id: number): Promise<void> {
    const deps = this.deps!
    const transcrire = deps.transcrire ?? transcrireWav
    const attentes = deps.attentes ?? [2_000, 15_000]
    let r = reunionParId(id)
    if (!r) return
    const cles = deps.cles(r.uid)
    const services = servicesReunion((c) => !!cles[c])
    if (!services.length) throw new Error('Aucune clé de transcription : ajoutez-en une dans Réglages › Clés API (Groq est la moins chère).')
    const noms = (deps.mots?.(r.uid) ?? []).slice(0, 20).join(', ')
    let choix = 0
    for (let s = prochainSegment(id); s; s = prochainSegment(id)) {
      let wav: Buffer
      try {
        wav = readFileSync(fichierSegment(r.uid, id, s.rang))
      } catch {
        noterEchec(r.uid, id, s.rang, 'Audio introuvable.')
        continue
      }
      const contexte = [noms, finDuPrecedent(id, s.rang)].filter(Boolean).join('. ')
      for (let essai = 0; ; essai++) {
        const service = services[choix]!
        try {
          const texte = await transcrire(service, cles[TRANSCRIPTION_INFOS[service].cle]!, wav, contexte, AbortSignal.timeout(deps.delaiMs ?? 180_000))
          noterTexte(r.uid, id, s.rang, texte)
          break
        } catch (err) {
          const e = err instanceof EchecTranscription ? err : new EchecTranscription(err instanceof Error ? err.message : String(err), true)
          // Clé refusée : le service suivant reprend ce morceau, et tous les autres.
          if (e.cleRefusee && choix < services.length - 1) {
            choix++
            essai = -1
            continue
          }
          if (!e.passager || essai >= attentes.length) {
            noterEchec(r.uid, id, s.rang, e.message)
            break
          }
          await new Promise((ok) => setTimeout(ok, attentes[essai]))
        }
      }
      // Supprimée pendant la transcription : on s'arrête là.
      if (!reunionParId(id)) return
    }
    r = reunionParId(id)
    if (r?.etat === 'transcription') cloreTranscription(r.uid, id, services[choix]!, tarifHeure(services[choix]!))
  }
}

/** La file du serveur (configurée par la passerelle, qui connaît les clés de chacun). */
export const fileReunions = new FileReunions()
