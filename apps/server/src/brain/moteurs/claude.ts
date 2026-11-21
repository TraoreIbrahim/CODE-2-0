import Anthropic from '@anthropic-ai/sdk'
import type { ModeleInfo } from '@code/protocol'
import { codeConfig } from '../../../../../config/code.config.ts'
import { claudeDefinitions } from '../../tools/index.ts'
import { CleManquante, type BrainEvent, type Echange, type EchangeParams, type FinEtape, type Moteur } from './types.ts'

/**
 * Claude, en natif : recherche et lecture web exécutées par Anthropic, recherche d'outils côté API
 * (outils différés), cache du prompt, repli serveur du modèle puissant.
 */

/**
 * Recherche et lecture de pages web, exécutées par Anthropic (outils serveur, aucune boucle de notre côté).
 * Le modèle puissant a les versions à filtrage dynamique (moins de tokens lus) ; le modèle rapide, la
 * recherche simple seulement. Les plafonds bornent le coût d'une question.
 */
export function webTools(tier: 'deep' | 'fast'): Anthropic.Beta.BetaToolUnion[] {
  const w = codeConfig.brain.web
  if (!w.enabled) return []
  // Pas de pays : la ville et le fuseau de l'installation suffisent à orienter les résultats.
  const user_location = { type: 'approximate' as const, city: codeConfig.reglages.ville, timezone: codeConfig.reglages.fuseau }
  if (tier === 'fast') return [{ type: 'web_search_20250305', name: 'web_search', max_uses: Math.min(2, w.maxSearches), user_location }]
  return [
    { type: 'web_search_20260209', name: 'web_search', max_uses: w.maxSearches, user_location },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: w.maxFetches, max_content_tokens: w.maxPageTokens, citations: { enabled: true } }
  ]
}

/** Les sources d'une recherche web, pour l'écran : titre, site et adresse de chaque résultat. */
export function webSources(block: Anthropic.Beta.BetaContentBlock): { query?: string; sources: { titre: string; site: string; url: string }[] } | null {
  if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) return null
  const sources = block.content
    .filter((r): r is Anthropic.Beta.BetaWebSearchResultBlock => r.type === 'web_search_result')
    .map((r) => ({ titre: r.title, site: hostOf(r.url), url: r.url }))
  return { sources }
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Un événement par recherche ou lecture web du tour, pour le journal. */
function* webEvents(content: Anthropic.Beta.BetaContentBlock[]): Generator<BrainEvent> {
  const queries = new Map<string, string>()
  for (const b of content) {
    if (b.type === 'server_tool_use' && b.name === 'web_search') queries.set(b.id, String((b.input as { query?: unknown })?.query ?? ''))
    if (b.type === 'server_tool_use' && b.name === 'web_fetch') {
      const url = String((b.input as { url?: unknown })?.url ?? '')
      yield { type: 'tool', id: b.id, name: 'web_fetch', summary: `Web : lecture de ${hostOf(url) || 'une page'}`, risk: 'lecture', failed: false }
    }
    if (b.type !== 'web_search_tool_result') continue
    const q = queries.get(b.tool_use_id) ?? ''
    const found = webSources(b)
    if (!found) {
      yield { type: 'tool', id: b.tool_use_id, name: 'web_search', summary: `Web : recherche « ${q} » sans résultat`, risk: 'lecture', failed: true, message: 'La recherche web n’a pas abouti.' }
      continue
    }
    // Pas de panneau : une information se reçoit en réponse ; les résultats ne s'affichent que pour une
    // recherche demandée, quand le modèle appelle web_resultats_afficher.
    yield { type: 'tool', id: b.tool_use_id, name: 'web_search', summary: `Web : « ${q} » (${found.sources.length} sources)`, risk: 'lecture', failed: false }
  }
}

export class MoteurClaude implements Moteur {
  readonly fournisseur = 'anthropic' as const
  readonly webNatif = codeConfig.brain.web.enabled
  readonly rechercheOutils = 'tool_search_tool_bm25'
  private readonly api: Anthropic | null

  /**
   * `ambiante` : sans clé, le SDK peut chercher un profil `ant auth login` de la machine. Réservé au
   * propriétaire ; un autre compte sans clé n'utilise jamais celles du serveur.
   */
  constructor(apiKey: string | undefined, { ambiante = false } = {}) {
    this.api = apiKey ? new Anthropic({ apiKey }) : ambiante ? new Anthropic() : null
  }

  get pret(): boolean {
    return this.api !== null
  }

  private get client(): Anthropic {
    if (!this.api) throw new CleManquante('Anthropic')
    return this.api
  }

  echange(p: EchangeParams): Echange {
    const client = this.client
    // Haiku n'a que la recherche simple ; le repli serveur ne vaut que pour Opus.
    const tier = /haiku/.test(p.modele) ? 'fast' : p.tier
    const effort = p.tache ? codeConfig.brain.taskEffort : codeConfig.brain.effort[p.tier]
    const messages: Anthropic.Beta.BetaMessageParam[] = [...p.historique.map((t) => ({ role: t.role, content: t.text })), { role: 'user', content: p.question }]
    const tools = [...claudeDefinitions(p.outils), ...webTools(tier)]
    let parseRetries = 0
    return {
      async *etape(signal): AsyncGenerator<string, FinEtape> {
        for (;;) {
          const stream = client.beta.messages.stream(
            {
              model: p.modele,
              max_tokens: p.tache ? 16000 : 8000,
              system: p.systeme,
              messages,
              tools,
              cache_control: { type: 'ephemeral' },
              output_config: { effort },
              // Repli serveur si Opus décline : Anthropic choisit le modèle selon le motif du refus.
              ...(/opus/.test(p.modele) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
            },
            { signal }
          )
          let final: Anthropic.Beta.BetaMessage
          try {
            for await (const event of stream) {
              if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text
            }
            final = await stream.finalMessage()
            // Le modèle qui a réellement répondu (repli serveur compris) : c'est son tarif qui compte.
            p.compter(final.model, final.usage)
            parseRetries = 0
          } catch (err) {
            // Entrée d'outil illisible (streaming) : on relance ce tour, deux fois au plus.
            if (err instanceof Anthropic.APIError || signal.aborted || parseRetries++ >= 2) throw err
            continue
          }
          const evenements = [...webEvents(final.content)]
          if (final.stop_reason === 'refusal') return { arret: 'refus', appels: [], evenements }
          if (final.stop_reason === 'max_tokens') return { arret: 'longueur', appels: [], evenements }
          messages.push({ role: 'assistant', content: final.content })
          // Boucle serveur interrompue (recherches nombreuses) : on renvoie le tour tel quel, l'API reprend.
          if (final.stop_reason === 'pause_turn') return { arret: 'pause', appels: [], evenements }
          const appels = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }))
          if (final.stop_reason !== 'tool_use' || appels.length === 0) {
            messages.pop()
            return { arret: 'fin', appels: [], evenements }
          }
          return { arret: 'outils', appels, evenements }
        }
      },
      resultats(runs) {
        // Tous les résultats dans un seul message utilisateur.
        messages.push({ role: 'user', content: runs.map((r) => r.run.block) })
      }
    }
  }

  async json({ modele, systeme, texte, outil, signal, compter }: Parameters<Moteur['json']>[0]): Promise<unknown> {
    const res = await this.client.messages.create(
      {
        model: modele,
        max_tokens: 1024,
        system: systeme,
        tools: [{ name: outil.name, description: outil.description, input_schema: outil.schema as Anthropic.Tool.InputSchema }],
        tool_choice: { type: 'tool', name: outil.name },
        messages: [{ role: 'user', content: texte }]
      },
      { signal }
    )
    compter(res.model, res.usage)
    return res.content.find((b) => b.type === 'tool_use')?.input
  }

  async court({ modele, systeme, texte, signal, delaiMs, compter }: Parameters<Moteur['court']>[0]): Promise<string> {
    const res = await this.client.messages.create(
      { model: modele, max_tokens: 5, thinking: { type: 'disabled' }, system: systeme, messages: [{ role: 'user', content: texte }] },
      { signal, timeout: delaiMs, maxRetries: 0 }
    )
    compter(res.model, res.usage)
    return res.content.find((b) => b.type === 'text')?.text ?? ''
  }

  async modeles(): Promise<ModeleInfo[]> {
    const out: ModeleInfo[] = []
    for await (const m of this.client.models.list({ limit: 100 })) out.push({ id: m.id, ...prixConfig(m.id) })
    return out
  }
}

const prixConfig = (id: string): Pick<ModeleInfo, 'prix'> => {
  const p = codeConfig.brain.prices[id]
  return p ? { prix: { entree: p.input, sortie: p.output } } : {}
}

/** Message lisible pour une erreur de l'API d'Anthropic ; null si ce n'en est pas une. */
export function erreurClaude(err: unknown): string | null {
  if (err instanceof Anthropic.AuthenticationError) return 'Clé API Anthropic refusée : vérifiez-la dans Réglages › Clés API.'
  if (err instanceof Anthropic.RateLimitError) return 'Trop de demandes à Claude pour le moment. Réessayez dans un instant.'
  if (err instanceof Anthropic.APIConnectionError) return 'Impossible de joindre Claude. Vérifiez la connexion internet du serveur.'
  if (err instanceof Anthropic.NotFoundError) return 'Ce modèle Claude n’existe pas (ou plus) : choisissez-en un autre dans Réglages › Moteurs.'
  if (err instanceof Anthropic.APIError) return `Claude a renvoyé une erreur (${err.status ?? '?'}).`
  // Erreur levée avant tout appel réseau : en pratique, aucune clé ni profil configuré.
  if (err instanceof Anthropic.AnthropicError) return 'Claude n’est pas configuré : ajoutez une clé Anthropic dans Réglages › Clés API.'
  return null
}
