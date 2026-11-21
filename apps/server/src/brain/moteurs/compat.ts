import { FOURNISSEUR_INFOS, type FournisseurId, type ModeleInfo } from '@code/protocol'
import { codeConfig } from '../../../../../config/code.config.ts'
import { isDeferred, type ToolCall, type ToolRun } from '../../tools/index.ts'
import type { Tool } from '../../tools/types.ts'
import type { ApiUsage } from '../usage.ts'
import { modeleCompte } from '../usage.ts'
import { OUTILS_CHERCHER, chercherOutils, outilsChercherDef, reponseRecherche } from './recherche-outils.ts'
import { prixCatalogue } from './tarifs.ts'
import { MoteurErreur, type Compteur, type Echange, type EchangeParams, type FinEtape, type Moteur } from './types.ts'

/**
 * Tous les fournisseurs au format d'OpenAI (Chat Completions) : OpenAI, Gemini, Mistral, DeepSeek,
 * OpenRouter, Groq, Ollama. Réponses diffusées (SSE), outils en `function`, recherche d'outils faite ici.
 */

type Fonction = { name: string; description: string; parameters: Record<string, unknown> }
type AppelOpenAI = { id: string; type: 'function'; function: { name: string; arguments: string } }
type Partie = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
export type MessageOpenAI =
  | { role: 'system' | 'user'; content: string | Partie[] }
  | { role: 'assistant'; content: string | null; tool_calls?: AppelOpenAI[] }
  | { role: 'tool'; tool_call_id: string; content: string }

type Chunk = {
  model?: string
  choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null; prompt_cache_hit_tokens?: number; cost?: number } | null
  error?: { message?: string }
}

/** Recherches d'outils au plus dans une même étape (le modèle cherche, puis agit). */
const MAX_RECHERCHES = 3

/** Les fournisseurs qui lisent les images renvoyées par un outil (fichiers, photos). */
const VISION: ReadonlySet<FournisseurId> = new Set(['openai', 'gemini', 'openrouter'])

/** Mots du schéma JSON que l'API de Gemini refuse dans les paramètres d'une fonction. */
const HORS_GEMINI = new Set(['additionalProperties', '$schema', '$id', 'examples', 'default', 'pattern', 'minLength', 'maxLength', 'const'])

/** Le schéma d'entrée d'un outil, nettoyé pour le fournisseur. */
export function schemaPour(fournisseur: FournisseurId, schema: unknown): Record<string, unknown> {
  const nettoie = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(nettoie)
    if (!v || typeof v !== 'object') return v
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      if (fournisseur === 'gemini' && HORS_GEMINI.has(k)) continue
      if (fournisseur === 'gemini' && k === 'format' && x !== 'enum' && x !== 'date-time') continue
      out[k] = k === 'properties' && x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([p, s]) => [p, nettoie(s)])) : nettoie(x)
    }
    return out
  }
  const s = nettoie(schema) as Record<string, unknown>
  return { type: 'object', properties: {}, ...s }
}

/**
 * La mémoire de travail (tokens) qu'Ollama donne au modèle chargé, lue sur `/api/ps` ; `null` si aucun modèle
 * ne tourne ou si Ollama ne répond pas. `base` : l'adresse au format OpenAI (…/v1).
 */
export async function contexteOllama(base: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    const res = await fetchImpl(new URL('/api/ps', base), { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return null
    const corps = (await res.json()) as { models?: { context_length?: number }[] }
    const tailles = (corps.models ?? []).map((m) => m.context_length).filter((n): n is number => typeof n === 'number' && n > 0)
    return tailles.length ? Math.min(...tailles) : null
  } catch {
    return null
  }
}

/**
 * Un modèle installé dans Ollama (`/api/tags`), qwen3 de préférence (le meilleur avec les outils parmi
 * les petits modèles essayés) ; `null` : aucun modèle, ou Ollama injoignable.
 */
export async function modeleOllama(base: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(new URL('/api/tags', base), { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return null
    const corps = (await res.json()) as { models?: { name?: string; capabilities?: string[] }[] }
    const noms = (corps.models ?? [])
      .filter((m) => !m.capabilities || m.capabilities.includes('tools'))
      .map((m) => m.name)
      .filter((n): n is string => typeof n === 'string' && n !== '')
    return noms.find((n) => n.startsWith('qwen3')) ?? noms[0] ?? null
  } catch {
    return null
  }
}

/** Effort de réflexion, pour les modèles qui raisonnent (sinon rien : les autres le refuseraient). */
export function effortPour(fournisseur: FournisseurId, modele: string, tache: boolean): Record<string, unknown> {
  const effort = tache ? 'medium' : 'low'
  if (fournisseur === 'openrouter') return { reasoning: { effort } }
  if (fournisseur === 'openai' && /^(gpt-([5-9]|\d\d)|o\d)/.test(modele)) return { reasoning_effort: effort }
  if (fournisseur === 'gemini' && /gemini-(2\.5|[3-9])|-(pro|flash)-latest/.test(modele)) return { reasoning_effort: effort }
  if (fournisseur === 'groq' && /gpt-oss/.test(modele)) return { reasoning_effort: effort }
  // Sur l'ordinateur, réfléchir avant chaque réponse coûte des dizaines de secondes (qwen3 : 7,5 s pour un
  // bonjour, 0,2 s sans) : trop pour une conversation à voix haute.
  if (fournisseur === 'ollama') return { reasoning_effort: 'none' }
  return {}
}

/**
 * Modèles qui refusent, sur `/chat/completions`, des outils pendant qu'ils raisonnent (OpenAI, depuis
 * GPT-6) : appris à la première erreur, ils répondent ensuite sans réflexion dès qu'il y a des outils.
 */
const SANS_REFLEXION_AVEC_OUTILS = new Set<string>()
const refusReflexion = (msg: string) => /reasoning[_ ]effort/i.test(msg) && /tool/i.test(msg)

/** Le contenu d'un résultat d'outil en texte (et ses images à part, pour les modèles qui les lisent). */
export function resultatTexte(block: ToolRun['block']): { texte: string; images: string[] } {
  const c = block.content
  if (typeof c === 'string' || c === undefined) return { texte: c ?? '', images: [] }
  const textes: string[] = []
  const images: string[] = []
  for (const b of c) {
    if (b.type === 'text') textes.push(b.text)
    else if (b.type === 'image' && b.source.type === 'base64') images.push(`data:${b.source.media_type};base64,${b.source.data}`)
    else textes.push(`[${b.type} non transmis à ce moteur]`)
  }
  return { texte: textes.join('\n'), images }
}

/** L'usage d'un fournisseur au format OpenAI, dans les termes du compteur (le cache lu, à part). */
export function usageDe(u: NonNullable<Chunk['usage']>): ApiUsage {
  const cache = u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0
  return { input_tokens: Math.max(0, (u.prompt_tokens ?? 0) - cache), output_tokens: u.completion_tokens ?? 0, cache_read_input_tokens: cache, ...(typeof u.cost === 'number' ? { cout: u.cost } : {}) }
}

/** Lit un flux SSE : un objet par ligne `data:`, jusqu'à `[DONE]`. */
async function* sse(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<Chunk> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason ?? new Error('aborted')
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') return
        try {
          yield JSON.parse(data) as Chunk
        } catch {}
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export class MoteurCompat implements Moteur {
  readonly webNatif = false
  readonly rechercheOutils = OUTILS_CHERCHER

  constructor(
    readonly fournisseur: Exclude<FournisseurId, 'anthropic'>,
    private readonly base: string,
    private readonly cle: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private entetes(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.cle ? { Authorization: `Bearer ${this.cle}` } : {}),
      // OpenRouter : l'application qui appelle (sans donnée personnelle).
      ...(this.fournisseur === 'openrouter' ? { 'X-Title': 'CODE 2.0' } : {})
    }
  }

  /**
   * Un appel à `/chat/completions`. Erreur HTTP : le message de l'API, lisible. Un modèle qui refuse les
   * outils pendant qu'il raisonne est relancé une fois sans réflexion, et retenu pour la suite.
   */
  private async poster(corps: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const cleModele = `${this.fournisseur}:${String(corps.model)}`
    const sansReflexion = (c: Record<string, unknown>) => {
      const { reasoning: _r, ...reste } = c
      return { ...reste, reasoning_effort: 'none' }
    }
    if (corps.tools && SANS_REFLEXION_AVEC_OUTILS.has(cleModele)) corps = sansReflexion(corps)
    let res = await this.fetchImpl(`${this.base}/chat/completions`, { method: 'POST', headers: this.entetes(), body: JSON.stringify(corps), signal })
    // Un modèle local sans réflexion peut refuser qu'on la coupe : relancé une fois sans l'option.
    if (res.status === 400 && this.fournisseur === 'ollama' && corps.reasoning_effort !== undefined) {
      const txt = await res.clone().text().catch(() => '')
      if (/think|reason/i.test(txt)) {
        const { reasoning_effort: _e, ...sans } = corps
        res = await this.fetchImpl(`${this.base}/chat/completions`, { method: 'POST', headers: this.entetes(), body: JSON.stringify(sans), signal })
      }
    }
    if (res.status === 400 && corps.tools && corps.reasoning_effort !== 'none') {
      const txt = await res.clone().text().catch(() => '')
      if (refusReflexion(txt)) {
        SANS_REFLEXION_AVEC_OUTILS.add(cleModele)
        res = await this.fetchImpl(`${this.base}/chat/completions`, { method: 'POST', headers: this.entetes(), body: JSON.stringify(sansReflexion(corps)), signal })
      }
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      let msg = txt.slice(0, 300)
      try {
        const j = JSON.parse(txt) as { error?: { message?: string } | string; message?: string }
        msg = (typeof j.error === 'string' ? j.error : j.error?.message) ?? j.message ?? msg
      } catch {}
      throw new MoteurErreur(this.fournisseur, res.status, msg)
    }
    return res
  }

  /** `max_tokens` ou son successeur, selon le fournisseur. */
  private plafond(n: number): Record<string, number> {
    return this.fournisseur === 'openai' || this.fournisseur === 'groq' ? { max_completion_tokens: n } : { max_tokens: n }
  }

  private fonction(t: Pick<Tool, 'name' | 'description' | 'input_schema'>): { type: 'function'; function: Fonction } {
    return { type: 'function', function: { name: t.name, description: t.description, parameters: schemaPour(this.fournisseur, t.input_schema) } }
  }

  echange(p: EchangeParams): Echange {
    const self = this
    const messages: MessageOpenAI[] = [{ role: 'system', content: p.systeme }, ...p.historique.map((t) => ({ role: t.role, content: t.text }) as MessageOpenAI), { role: 'user', content: p.question }]
    const differes = p.outils.filter(isDeferred)
    const charges = new Set<string>()
    // Réponses déjà prêtes (recherches d'outils) et ordre des appels de la dernière étape.
    const internes = new Map<string, string>()
    let ordre: ToolCall[] = []
    const definitions = () => [
      ...p.outils.filter((t) => !isDeferred(t) || charges.has(t.name)).map((t) => self.fonction(t)),
      ...(differes.length ? [{ type: 'function' as const, function: outilsChercherDef }] : [])
    ]
    const rechercher = (input: unknown): string => {
      const q = String((input as { requete?: unknown })?.requete ?? '')
      const trouves = chercherOutils(q, differes)
      for (const t of trouves) charges.add(t.name)
      return reponseRecherche(trouves)
    }
    return {
      async *etape(signal): AsyncGenerator<string, FinEtape> {
        for (let recherche = 0; ; recherche++) {
          const outils = definitions()
          const res = await self.poster(
            {
              model: p.modele,
              messages,
              stream: true,
              stream_options: { include_usage: true },
              ...self.plafond(p.tache ? 16000 : 8000),
              ...(outils.length ? { tools: outils } : {}),
              ...effortPour(self.fournisseur, p.modele, p.tache)
            },
            signal
          )
          let texte = ''
          let fin: string | null = null
          let modele = p.modele
          const calls: { id: string; name: string; args: string }[] = []
          for await (const c of sse(res.body!, signal)) {
            if (c.error?.message) throw new MoteurErreur(self.fournisseur, 500, c.error.message)
            if (c.model) modele = c.model
            if (c.usage) p.compter(modeleCompte(self.fournisseur, modele), usageDe(c.usage))
            const ch = c.choices?.[0]
            if (!ch) continue
            const d = ch.delta?.content
            if (d) {
              texte += d
              yield d
            }
            for (const tc of ch.delta?.tool_calls ?? []) {
              const i = tc.index ?? calls.length
              const cur = (calls[i] ??= { id: '', name: '', args: '' })
              if (tc.id) cur.id = tc.id
              if (tc.function?.name) cur.name += tc.function.name
              if (tc.function?.arguments) cur.args += tc.function.arguments
            }
            if (ch.finish_reason) fin = ch.finish_reason
          }
          const appels: ToolCall[] = calls
            .filter((c) => c?.name)
            .map((c, i) => {
              let input: unknown = {}
              try {
                input = c.args.trim() ? JSON.parse(c.args) : {}
              } catch {
                // Entrée illisible : l'outil la refusera et le modèle corrigera.
                input = { INVALID_JSON: c.args.slice(0, 2000) }
              }
              return { id: c.id || `appel_${Date.now().toString(36)}_${i}`, name: c.name, input }
            })
          if (fin === 'content_filter') return { arret: 'refus', appels: [], evenements: [] }
          if (fin === 'length' && !appels.length) return { arret: 'longueur', appels: [], evenements: [] }
          if (!appels.length) return { arret: 'fin', appels: [], evenements: [] }
          messages.push({ role: 'assistant', content: texte || null, tool_calls: appels.map((a) => ({ id: a.id, type: 'function', function: { name: a.name, arguments: JSON.stringify(a.input) } })) })
          ordre = appels
          for (const a of appels) if (a.name === OUTILS_CHERCHER) internes.set(a.id, rechercher(a.input))
          const externes = appels.filter((a) => a.name !== OUTILS_CHERCHER)
          if (externes.length) return { arret: 'outils', appels: externes, evenements: [] }
          // Seulement des recherches d'outils : leurs réponses, et le modèle reprend avec les outils trouvés.
          for (const a of appels) messages.push({ role: 'tool', tool_call_id: a.id, content: internes.get(a.id)! })
          internes.clear()
          if (recherche >= MAX_RECHERCHES) return { arret: 'fin', appels: [], evenements: [] }
        }
      },
      resultats(runs) {
        const parId = new Map(runs.map((r) => [r.appel.id, r.run]))
        const images: string[] = []
        for (const a of ordre) {
          const interne = internes.get(a.id)
          if (interne !== undefined) {
            messages.push({ role: 'tool', tool_call_id: a.id, content: interne })
            continue
          }
          const run = parId.get(a.id)
          const { texte, images: imgs } = run ? resultatTexte(run.block) : { texte: 'Pas de résultat.', images: [] }
          const vues = VISION.has(self.fournisseur) ? imgs : []
          const note = imgs.length && !vues.length ? '\n[image non transmise : ce moteur ne lit pas les images]' : ''
          messages.push({ role: 'tool', tool_call_id: a.id, content: `${run?.failed ? 'ERREUR : ' : ''}${texte}${note}` || '(vide)' })
          images.push(...vues)
        }
        internes.clear()
        // Les images d'un outil (photo, page de PDF) suivent, dans un message à part : un résultat d'outil
        // n'est que du texte dans ce format.
        if (images.length) messages.push({ role: 'user', content: [{ type: 'text', text: 'Images renvoyées par les outils :' }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))] })
      }
    }
  }

  async json({ modele, systeme, texte, outil, signal, compter }: Parameters<Moteur['json']>[0]): Promise<unknown> {
    const res = await this.poster(
      {
        model: modele,
        messages: [
          { role: 'system', content: systeme },
          { role: 'user', content: texte }
        ],
        tools: [this.fonction({ name: outil.name, description: outil.description, input_schema: outil.schema as Tool['input_schema'] })],
        tool_choice: { type: 'function', function: { name: outil.name } },
        ...this.plafond(2048)
      },
      signal
    )
    const data = (await res.json()) as { model?: string; usage?: Chunk['usage']; choices?: { message?: { tool_calls?: AppelOpenAI[]; content?: string | null } }[] }
    if (data.usage) compter(modeleCompte(this.fournisseur, data.model ?? modele), usageDe(data.usage))
    const msg = data.choices?.[0]?.message
    const args = msg?.tool_calls?.find((c) => c.function?.name === outil.name)?.function.arguments ?? msg?.content ?? ''
    try {
      // Certains modèles répondent en texte, parfois entre balises de code : on y cherche l'objet.
      return JSON.parse(/\{[\s\S]*\}/.exec(args)?.[0] ?? args)
    } catch {
      return undefined
    }
  }

  async court({ modele, systeme, texte, signal, delaiMs, compter }: Parameters<Moteur['court']>[0]): Promise<string> {
    const delai = AbortSignal.timeout(delaiMs)
    const res = await this.poster(
      {
        model: modele,
        messages: [
          { role: 'system', content: systeme },
          { role: 'user', content: texte }
        ],
        // Les modèles qui raisonnent dépensent des tokens avant le mot : de la marge, et le moins d'effort.
        ...this.plafond(64),
        ...effortPour(this.fournisseur, modele, false)
      },
      signal ? AbortSignal.any([signal, delai]) : delai
    )
    const data = (await res.json()) as { model?: string; usage?: Chunk['usage']; choices?: { message?: { content?: string | null } }[] }
    if (data.usage) compter(modeleCompte(this.fournisseur, data.model ?? modele), usageDe(data.usage))
    return data.choices?.[0]?.message?.content ?? ''
  }

  async modeles(): Promise<ModeleInfo[]> {
    const res = await this.fetchImpl(`${this.base}/models`, { headers: this.entetes(), signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new MoteurErreur(this.fournisseur, res.status, `${FOURNISSEUR_INFOS[this.fournisseur].nom} a répondu ${res.status}.`)
    const data = (await res.json()) as { data?: { id?: string }[]; models?: { name?: string }[] }
    const ids = (data.data ?? []).map((m) => (m.id ?? '').replace(/^models\//, '')).filter(Boolean)
    return [...new Set(ids)]
      .filter(modeleDeConversation)
      .sort()
      .map((id) => {
        const p = prixCatalogue(this.fournisseur, id)
        return { id, ...(p ? { prix: { entree: p.input, sortie: p.output } } : {}) }
      })
  }
}

/** Écarte ce qui n'est pas un modèle de conversation (images, voix, embeddings, modération). */
export function modeleDeConversation(id: string): boolean {
  return !/(embed|tts|whisper|transcribe|dall-e|image|imagen|audio|realtime|moderation|davinci|babbage|aqa|veo|lyria|guard|ocr|search-preview)/i.test(id)
}

export const compter0: Compteur = () => {}
export const adresseCompat = (f: Exclude<FournisseurId, 'anthropic'>): string | null => codeConfig.brain.compat[f]
