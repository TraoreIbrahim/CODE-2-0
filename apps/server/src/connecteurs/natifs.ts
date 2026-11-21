import { renderConnecteur } from './rendu.ts'
import type { Tool } from '../tools/types.ts'

/**
 * Figma et Vercel : leurs serveurs MCP n'acceptent que des applications approuvées. CODE appelle donc leur
 * API avec le jeton personnel de l'utilisateur, en lecture seule, avec quelques outils choisis.
 */

const MAX_FOR_CLAUDE = 40_000

type Natif = 'vercel' | 'figma'
type Query = Record<string, string | number | undefined>

const BASE: Record<Natif, string> = { vercel: 'https://api.vercel.com', figma: 'https://api.figma.com' }
const headers = (natif: Natif, jeton: string): Record<string, string> => (natif === 'figma' ? { 'X-Figma-Token': jeton } : { Authorization: `Bearer ${jeton}` })

async function get(natif: Natif, jeton: string, path: string, query: Query = {}): Promise<unknown> {
  const url = new URL(path, BASE[natif])
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  const res = await fetch(url, { headers: headers(natif, jeton), signal: AbortSignal.timeout(20_000) })
  const text = await res.text()
  if (!res.ok) {
    let message = text.slice(0, 300)
    try {
      const d = JSON.parse(text) as { error?: { message?: string } | string; err?: string; message?: string }
      message = (typeof d.error === 'object' ? d.error?.message : d.error) ?? d.err ?? d.message ?? message
    } catch {}
    throw new Error(res.status === 401 || res.status === 403 ? `jeton refusé (${message})` : `HTTP ${res.status} : ${message}`)
  }
  return JSON.parse(text) as unknown
}

/** L'API de Vercel, pour l'état des projets et les alertes. */
export const vercelApi = (jeton: string, path: string, query: Query = {}) => get('vercel', jeton, path, query)

/** Vérifie le jeton (un appel léger) ; lève s'il est refusé. */
export async function nativeCheck(natif: Natif, jeton: string): Promise<void> {
  if (!jeton) throw new Error('jeton manquant')
  await get(natif, jeton, natif === 'figma' ? '/v1/me' : '/v2/user')
}

/** « https://www.figma.com/design/AbC123/Nom?node-id=… » ou la clé seule → « AbC123 ». */
export function figmaKey(value: string): string {
  return value.match(/figma\.com\/(?:file|design|proto|board|slides)\/([A-Za-z0-9]+)/)?.[1] ?? value.trim()
}

type Def = {
  name: string
  titre: string
  description: string
  properties: Record<string, { type: 'string' | 'number'; description: string }>
  required?: string[]
  fetch: (q: Record<string, unknown>, jeton: string) => Promise<unknown>
}

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const team = { teamId: { type: 'string' as const, description: 'Équipe Vercel (id ou slug), si les projets ne sont pas sur le compte personnel.' } }

const VERCEL: Def[] = [
  {
    name: 'equipes',
    titre: 'Équipes',
    description: 'Équipes Vercel du compte (id, slug, nom), à passer en teamId aux autres outils.',
    properties: {},
    fetch: async (_q, j) => ((await get('vercel', j, '/v2/teams')) as { teams?: unknown[] }).teams ?? []
  },
  {
    name: 'projets',
    titre: 'Projets',
    description: 'Projets Vercel : nom, framework, dernière mise à jour.',
    properties: { ...team, recherche: { type: 'string', description: 'Filtre sur le nom.' } },
    fetch: async (q, j) => {
      const d = (await get('vercel', j, '/v9/projects', { limit: 50, teamId: s(q.teamId), search: s(q.recherche) })) as { projects?: Record<string, unknown>[] }
      return (d.projects ?? []).map((p) => ({ nom: p.name, framework: p.framework, misAJour: new Date(Number(p.updatedAt)).toISOString(), id: p.id }))
    }
  },
  {
    name: 'deploiements',
    titre: 'Déploiements',
    description: 'Derniers déploiements Vercel (état READY, ERROR, BUILDING…, branche, commit, auteur), d’un projet ou de tous.',
    properties: { ...team, projet: { type: 'string', description: 'Nom ou id du projet.' }, etat: { type: 'string', description: 'BUILDING, ERROR, INITIALIZING, QUEUED, READY ou CANCELED.' } },
    fetch: async (q, j) => {
      const d = (await get('vercel', j, '/v6/deployments', { limit: 20, teamId: s(q.teamId), projectId: s(q.projet), state: s(q.etat) })) as { deployments?: Record<string, unknown>[] }
      return (d.deployments ?? []).map((x) => {
        const meta = (x.meta ?? {}) as Record<string, unknown>
        return {
          projet: x.name,
          etat: x.state ?? x.readyState,
          cible: x.target ?? 'preview',
          branche: meta.githubCommitRef,
          commit: meta.githubCommitMessage,
          auteur: (x.creator as { username?: string } | undefined)?.username,
          cree: new Date(Number(x.created)).toISOString(),
          adresse: x.url,
          id: x.uid
        }
      })
    }
  },
  {
    name: 'journal_deploiement',
    titre: 'Journal de construction',
    description: 'Journal de construction d’un déploiement Vercel (pour comprendre un échec) : les dernières lignes.',
    properties: { ...team, deploiement: { type: 'string', description: 'Id (dpl_…) ou adresse du déploiement.' } },
    required: ['deploiement'],
    fetch: async (q, j) => {
      const d = (await get('vercel', j, `/v3/deployments/${encodeURIComponent(s(q.deploiement) ?? '')}/events`, { teamId: s(q.teamId), limit: 400 })) as { type?: string; text?: string; payload?: { text?: string } }[]
      const lines = (Array.isArray(d) ? d : []).map((e) => e.payload?.text ?? e.text ?? '').filter(Boolean)
      return lines.slice(-120).map((ligne) => ({ ligne }))
    }
  }
]

const FIGMA: Def[] = [
  {
    name: 'fichier',
    titre: 'Fichier',
    description: 'Un fichier Figma : nom, dernière modification, pages et leurs cadres principaux. Accepte le lien du fichier.',
    properties: { fichier: { type: 'string', description: 'Lien Figma ou clé du fichier.' } },
    required: ['fichier'],
    fetch: async (q, j) => {
      const d = (await get('figma', j, `/v1/files/${figmaKey(String(q.fichier ?? ''))}`, { depth: 2 })) as { name?: string; lastModified?: string; document?: { children?: { name?: string; children?: { name?: string; type?: string }[] }[] } }
      return {
        nom: d.name,
        modifie: d.lastModified,
        pages: (d.document?.children ?? []).map((p) => ({ page: p.name, cadres: (p.children ?? []).filter((c) => c.type === 'FRAME' || c.type === 'SECTION').length, exemples: (p.children ?? []).slice(0, 8).map((c) => c.name).join(', ') }))
      }
    }
  },
  {
    name: 'commentaires',
    titre: 'Commentaires',
    description: 'Commentaires d’un fichier Figma (auteur, date, résolu ou non).',
    properties: { fichier: { type: 'string', description: 'Lien Figma ou clé du fichier.' } },
    required: ['fichier'],
    fetch: async (q, j) => {
      const d = (await get('figma', j, `/v1/files/${figmaKey(String(q.fichier ?? ''))}/comments`)) as { comments?: { message?: string; user?: { handle?: string }; created_at?: string; resolved_at?: string | null }[] }
      return (d.comments ?? []).map((c) => ({ auteur: c.user?.handle, message: c.message, date: c.created_at, resolu: Boolean(c.resolved_at) }))
    }
  },
  {
    name: 'projets',
    titre: 'Projets d’équipe',
    description: 'Projets d’une équipe Figma (l’id d’équipe est dans l’adresse figma.com/files/team/<id>/…).',
    properties: { equipe: { type: 'string', description: 'Id de l’équipe Figma.' } },
    required: ['equipe'],
    fetch: async (q, j) => ((await get('figma', j, `/v1/teams/${encodeURIComponent(String(q.equipe ?? ''))}/projects`)) as { projects?: unknown[] }).projects ?? []
  },
  {
    name: 'fichiers_projet',
    titre: 'Fichiers du projet',
    description: 'Fichiers d’un projet Figma (nom, clé, dernière modification).',
    properties: { projet: { type: 'string', description: 'Id du projet Figma.' } },
    required: ['projet'],
    fetch: async (q, j) => {
      const d = (await get('figma', j, `/v1/projects/${encodeURIComponent(String(q.projet ?? ''))}/files`)) as { files?: { key?: string; name?: string; last_modified?: string }[] }
      return (d.files ?? []).map((f) => ({ nom: f.name, modifie: f.last_modified, cle: f.key }))
    }
  }
]

/** Les outils d'un connecteur natif, préfixés par son nom (« vercel_deploiements »). */
export function nativeTools(natif: Natif, service: string, jeton: string): Tool[] {
  return (natif === 'vercel' ? VERCEL : FIGMA).map((d) => ({
    name: `${natif}_${d.name}`,
    description: `[${service}, lecture] ${d.description}`,
    risk: 'lecture',
    deferred: true,
    ui: { kind: 'connecteur', title: () => `${service} · ${d.titre}` },
    input_schema: { type: 'object', properties: d.properties, ...(d.required ? { required: d.required } : {}) },
    validate: (input) => {
      for (const k of d.required ?? []) if (typeof input[k] !== 'string' || !(input[k] as string).trim()) return `Champ « ${k} » manquant.`
      return null
    },
    run: async (input) => {
      const text = JSON.stringify(await d.fetch(input, jeton))
      return {
        content: `${text.slice(0, MAX_FOR_CLAUDE)}${text.length > MAX_FOR_CLAUDE ? '\n(Résultat tronqué.)' : ''}\nCe résultat est affiché à l'écran : résume l'essentiel à voix haute.`,
        summary: `${service} : ${d.titre}`,
        view: renderConnecteur(natif, service, d.titre, text)
      }
    }
  }))
}
