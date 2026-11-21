import type { ChoixMoteur, FournisseurId, RoleMoteur, Turn, UsageKind } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import { runTool, toolsFor, type ToolContext } from '../tools/index.ts'
import { SUBJECTS, type Sujet } from '../tools/memory.ts'
import type { Tool } from '../tools/types.ts'
import { sourceWeb, webLire, webRechercher } from '../tools/web-libre.ts'
import { appellationOf, type Utilisateur } from '../users/users.ts'
import type { Secrets } from '../secrets.ts'
import { FIN_DE_PHRASE_PROMPT, LEARN_PROMPT, TASK_MODE, WRITTEN_MODE, contextLine, nomAssistant, readMemory, systemPrompt } from './prompt.ts'
import { budgetOf, recordUsage } from './usage.ts'
import { listBoites } from '../mail/boites.ts'
import { connecteursConnectes } from '../connecteurs/registre.ts'
import { CleManquante, MoteurErreur, creerMoteur, type BrainEvent, type Moteur } from './moteurs/index.ts'
import type { Compteur } from './moteurs/types.ts'
import { erreurClaude } from './moteurs/claude.ts'
import { autresPrenoms } from '../users/personnes.ts'

export { webSources, webTools } from './moteurs/claude.ts'
export { CleManquante, type BrainEvent } from './moteurs/index.ts'

const MAX_STEPS = 8

/** Réponse imposée de l'apprentissage : la liste des faits à ajouter aux notes. */
const LEARN_TOOL = {
  name: 'noter',
  description: 'Ajoute les faits durables relevés aux notes de l’assistant. Liste vide s’il n’y a rien de nouveau.',
  schema: {
    type: 'object',
    properties: {
      faits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sujet: { type: 'string', enum: [...SUBJECTS] },
            fait: { type: 'string', description: 'Une phrase courte et autonome, au présent.' }
          },
          required: ['sujet', 'fait']
        }
      }
    },
    required: ['faits']
  }
}

const DEEP_HINTS = /\b(pr[ée]pare|r[ée]dige|compare|analyse|cherche|r[ée]sume|planifie|organise|explique|d[ée]taille|propose|[ée]cris)\b/i

/** Modèle de conversation pour les demandes à plusieurs étapes, rapide pour les simples. */
export function chooseModel(text: string): 'deep' | 'fast' {
  const { routing } = codeConfig.brain
  if (routing !== 'auto') return routing
  const words = text.trim().split(/\s+/).length
  return words > 18 || DEEP_HINTS.test(text) ? 'deep' : 'fast'
}

/** Options d'une réponse. `moteur` et `outils` : imposés (banc d'essai), sinon les réglages et outils de la personne. */
export type ReplyOptions = { written?: boolean; task?: boolean; usage?: UsageKind; moteur?: ChoixMoteur; outils?: Tool[]; surUsage?: Compteur }

/**
 * Le cerveau d'un utilisateur : ses moteurs (un par fournisseur, avec ses clés), choisis à chaque appel
 * selon ses réglages (`reglages.moteurs`), et la boucle d'outils commune à tous.
 */
export class Brain {
  private readonly moteurs = new Map<FournisseurId, Moteur>()

  /**
   * `ambiante` : sans clé Anthropic, le SDK peut chercher un profil `ant auth login` de la machine. Réservé
   * au propriétaire ; un autre compte sans clé n'utilise jamais celles du serveur.
   */
  constructor(
    private readonly secrets: Secrets,
    private readonly opts: { ambiante?: boolean; fetchImpl?: typeof fetch } = {}
  ) {}

  /** La clé Brave Search de la personne (recherche web des moteurs qui ne l'ont pas d'eux-mêmes). */
  get cleBrave(): string | undefined {
    return this.secrets.BRAVE_API_KEY
  }

  /** Le moteur d'un fournisseur (créé une fois) ; sans clé : `CleManquante`. */
  moteur(fournisseur: FournisseurId): Moteur {
    let m = this.moteurs.get(fournisseur)
    if (!m) {
      m = creerMoteur(fournisseur, this.secrets, this.opts)
      this.moteurs.set(fournisseur, m)
    }
    return m
  }

  /** Le moteur choisi pour un usage. */
  private choix(user: Utilisateur, role: RoleMoteur): ChoixMoteur {
    return user.reglages.moteurs?.[role] ?? codeConfig.reglages.moteurs[role]
  }

  /**
   * Relit des échanges récents et rend les faits durables que la personne a dits d'elle-même, absents de
   * ses notes (moteur rapide, compté avec les conversations). Rien à retenir : liste vide.
   */
  async learn(user: Utilisateur, exchanges: Turn[], signal?: AbortSignal): Promise<{ sujet: Sujet; fait: string }[]> {
    const name = appellationOf(user)
    const transcript = exchanges.map((t) => `${t.role === 'user' ? name : nomAssistant(user)} : ${t.text}`).join('\n')
    const { fournisseur, modele } = this.choix(user, 'rapide')
    const input = (await this.moteur(fournisseur).json({
      modele,
      systeme: LEARN_PROMPT(name),
      texte: `Ses notes actuelles :\n${readMemory(user.id) || '(aucune)'}\n\nSes derniers échanges avec l’assistant :\n${transcript}`,
      outil: LEARN_TOOL,
      signal,
      compter: (m, u) => recordUsage(user.id, 'conversation', m, u)
    })) as { faits?: unknown } | undefined
    if (!Array.isArray(input?.faits)) return []
    return input.faits.filter(
      (f): f is { sujet: Sujet; fait: string } =>
        typeof f?.fait === 'string' && f.fait.trim() !== '' && SUBJECTS.includes(f?.sujet)
    )
  }

  /**
   * La phrase en cours (transcription partielle, pendant une pause) est-elle complète ? Moteur rapide, un mot ;
   * `null` s'il ne répond pas à temps : l'assistant attend alors un silence ordinaire.
   */
  async finDePhrase(user: Utilisateur, texte: string, signal?: AbortSignal): Promise<boolean | null> {
    const { fournisseur, modele } = this.choix(user, 'rapide')
    const reponse = await this.moteur(fournisseur).court({ modele, systeme: FIN_DE_PHRASE_PROMPT, texte, signal, delaiMs: 4_000, compter: (m, u) => recordUsage(user.id, 'conversation', m, u) })
    // « fini », Fini., **suite** : le premier des deux mots trouvé.
    const mot = /fini|suite/.exec(reponse.toLowerCase())?.[0]
    return mot === 'fini' ? true : mot === 'suite' ? false : null
  }

  /**
   * Diffuse la réponse du modèle. Quand il appelle des outils, on les exécute puis on relance, jusqu'à la
   * réponse finale (au plus MAX_STEPS allers-retours). Chaque appel est compté (tokens et coût) pour
   * l'utilisateur du contexte, sous `opts.usage`.
   */
  async *reply(history: Turn[], userText: string, signal: AbortSignal, ctx: ToolContext, opts: ReplyOptions = {}): AsyncGenerator<BrainEvent> {
    // Tâche planifiée : moteur des tâches, personne n'attend la réponse en direct. Le retour et le briefing ne
    // font que résumer : moteur rapide. Plafond du jour atteint : moteur rapide pour tout, jusqu'à minuit.
    const budget = budgetOf(ctx.user.id, ctx.user.reglages.fuseau, ctx.user.reglages.plafondJour)
    const tier = budget.depasse || opts.usage === 'retour' || opts.usage === 'briefing' ? 'fast' : opts.task ? 'deep' : chooseModel(userText)
    const role: RoleMoteur = tier === 'fast' ? 'rapide' : opts.task ? 'taches' : 'principal'
    const { fournisseur, modele } = opts.moteur ?? this.choix(ctx.user, role)
    const moteur = this.moteur(fournisseur)
    const mode = opts.task ? `\n${TASK_MODE(appellationOf(ctx.user))}` : opts.written ? `\n${WRITTEN_MODE}` : ''
    const kind: UsageKind = opts.usage ?? (opts.task ? 'tache' : 'conversation')

    // Les outils de cet échange : ceux de la personne, et le web pour les moteurs qui ne l'ont pas d'eux-mêmes.
    const web = codeConfig.brain.web.enabled
    const recherche = web && !moteur.webNatif ? sourceWeb(this.secrets.BRAVE_API_KEY, this.opts.fetchImpl) : null
    const base = opts.outils ?? toolsFor(ctx)
    const outils = moteur.webNatif || !web ? base : [...base.filter((t) => t.name !== 'web_resultats_afficher' || recherche), ...(recherche ? [webRechercher] : []), webLire]
    let recherches = 0
    const tours: ToolContext = {
      ...ctx,
      outils,
      ...(recherche
        ? {
            rechercheWeb: (q: string, n: number) => {
              if (++recherches > codeConfig.brain.web.maxLibres) return Promise.reject(new Error('Assez de recherches pour cette question : réponds avec ce que tu as trouvé.'))
              return recherche(q, n)
            }
          }
        : {})
    }
    const systeme = systemPrompt({
      user: ctx.user,
      fichiers: ctx.fichiers,
      boites: listBoites(ctx.user.id).map((b) => `${b.libelle} <${b.email}>`),
      connecteurs: connecteursConnectes(ctx.user.id),
      personnes: autresPrenoms(ctx.user.id),
      rechercheOutils: moteur.rechercheOutils,
      web: moteur.webNatif ? { chercher: 'web_search', lire: 'web_fetch' } : recherche ? { chercher: 'web_rechercher', lire: 'web_lire' } : web ? { chercher: null, lire: 'web_lire' } : null
    })
    const echange = moteur.echange({
      modele,
      systeme,
      historique: history,
      question: `${contextLine(ctx.user)}${mode}\n${userText}`,
      outils,
      tier,
      tache: !!opts.task,
      compter: (m, u) => {
        recordUsage(ctx.user.id, kind, m, u)
        opts.surUsage?.(m, u)
      }
    })

    let said = false
    for (let step = 0; step < MAX_STEPS; step++) {
      const etape = echange.etape(signal)
      let first = true
      let r = await etape.next()
      while (!r.done) {
        // Un espace entre deux étapes, pour que les phrases ne se collent pas.
        if (first && said) yield { type: 'text', text: ' ' }
        first = false
        said = true
        yield { type: 'text', text: r.value }
        r = await etape.next()
      }
      const fin = r.value
      if (fin.arret === 'refus') {
        if (!said) yield { type: 'text', text: 'Je préfère ne pas répondre à cette demande.' }
        return
      }
      if (fin.arret === 'longueur') {
        yield { type: 'text', text: ' Je m’arrête là, la réponse devenait trop longue.' }
        return
      }
      // Recherches web faites par le fournisseur pendant l'étape : leurs sources s'affichent, le journal les garde.
      yield* fin.evenements
      if (fin.arret === 'pause') continue
      if (fin.arret !== 'outils') return

      for (const u of fin.appels) yield { type: 'tool-start', id: u.id, name: u.name, input: u.input }
      const runs = await Promise.all(fin.appels.map((u) => runTool(u, tours)))
      for (const [i, run] of runs.entries()) {
        const u = fin.appels[i]!
        const message = run.failed && typeof run.block.content === 'string' ? run.block.content.slice(0, 200) : undefined
        yield { type: 'tool', id: u.id, name: u.name, summary: run.summary, risk: run.risk, view: run.view, failed: run.failed, message }
      }
      echange.resultats(fin.appels.map((appel, i) => ({ appel, run: runs[i]! })))
    }
    yield { type: 'text', text: ' Je m’arrête là : trop d’étapes pour une seule demande.' }
  }
}

/** Message d'erreur lisible pour l'utilisateur. */
export function describeBrainError(err: unknown): string {
  if (err instanceof CleManquante) return err.message
  const claude = erreurClaude(err)
  if (claude) return claude
  if (err instanceof MoteurErreur) {
    const nom = err.fournisseur
    if (err.status === 401 || err.status === 403) return `Clé ${nom} refusée : vérifiez-la dans Réglages › Clés API.`
    if (err.status === 404) return `Ce modèle n’existe pas chez ${nom} (ou plus) : choisissez-en un autre dans Réglages › Moteurs.`
    if (err.status === 429) return `Trop de demandes à ${nom} pour le moment (ou crédit épuisé). Réessayez dans un instant.`
    if (err.status === 400) return `${nom} a refusé la demande : ${err.message.slice(0, 160)}`
    return `${nom} a renvoyé une erreur (${err.status}).`
  }
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return 'Impossible de joindre le moteur. Vérifiez la connexion internet du serveur (ou l’adresse d’Ollama).'
  return err instanceof Error ? err.message : String(err)
}
