import type { UiProjet, UiProjetAppli, UiProjetBuild, UiProjetDeploiement, UiProjetDepot, UiProjetEtat, UiProjetSite } from '@code/protocol'
import type { Tool } from '../tools/types.ts'
import { appsAvecBuilds, gh, norme, type AppExpo, type BuildExpo } from './expo.ts'
import { vercelApi } from './natifs.ts'
import { etat, vercelEtat } from './rendu.ts'
import { jetonsDev, type JetonsDev } from './store.ts'

/**
 * « Où en est Atlas ? » : CODE réunit tout ce qui porte ce nom chez GitHub (dépôts), Vercel (projets) et Expo
 * (applications), avec les accès de l'utilisateur et sans Claude : derniers commits, pull requests ouvertes,
 * intégration continue, production et dernier déploiement, dernier build iOS et Android. Un service en panne
 * ou non relié n'empêche pas les autres ; il est cité dans `manques`.
 */

const PAR_SECTION = 4
const MAX_FOR_CLAUDE = 12_000

const correspond = (nom: string, cle: string) => norme(nom).includes(cle)

// ── GitHub ──────────────────────────────────────────────────────────────

export type DepotGithub = { full_name: string; name: string; html_url: string; default_branch: string; private: boolean; pushed_at: string; archived?: boolean }

export type RunGithub = { id: number; name?: string; display_title?: string; status: string; conclusion: string | null; head_branch?: string; created_at: string; updated_at: string; html_url: string }

/** Ses dépôts, les plus récemment poussés d'abord ; gardés cinq minutes (l'état d'un projet et les alertes s'en servent). */
const depotsCache = new Map<number, { at: number; liste: DepotGithub[] }>()

export async function depotsGithub(uid: number, jeton: string): Promise<DepotGithub[]> {
  const c = depotsCache.get(uid)
  if (c && Date.now() - c.at < 5 * 60_000) return c.liste
  const liste = (await gh(jeton, '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member')) as DepotGithub[]
  depotsCache.set(uid, { at: Date.now(), liste })
  return liste
}

/** Un run terminé prend sa conclusion ; sinon son état (en file, en cours). */
export const etatRun = (r: RunGithub): UiProjetEtat => etat(r.status === 'completed' ? (r.conclusion ?? 'neutral') : r.status)!

async function depot(jeton: string, d: DepotGithub): Promise<UiProjetDepot> {
  const r = d.full_name
  const [commits, prs, runs] = await Promise.all([
    gh(jeton, `/repos/${r}/commits?per_page=4`).catch(() => []) as Promise<{ sha: string; html_url: string; commit: { message: string; author?: { name?: string; date?: string } }; author?: { login?: string } | null }[]>,
    gh(jeton, `/repos/${r}/pulls?state=open&per_page=6`).catch(() => []) as Promise<{ number: number; title: string; html_url: string; created_at: string; draft?: boolean; user?: { login?: string } }[]>,
    gh(jeton, `/repos/${r}/actions/runs?per_page=1&branch=${encodeURIComponent(d.default_branch)}`).catch(() => ({})) as Promise<{ workflow_runs?: RunGithub[] }>
  ])
  const run = runs.workflow_runs?.[0]
  return {
    nom: r,
    lien: d.html_url,
    branche: d.default_branch,
    prive: d.private,
    pousse: d.pushed_at,
    ...(run ? { ci: { titre: run.name ?? 'Actions', statut: etatRun(run), date: run.updated_at, lien: run.html_url } } : {}),
    commits: commits.map((c) => ({ sha: c.sha.slice(0, 7), message: c.commit.message.split('\n')[0]!.slice(0, 140), auteur: c.author?.login ?? c.commit.author?.name, date: c.commit.author?.date ?? '', lien: c.html_url })),
    prs: prs.slice(0, 5).map((p) => ({ numero: p.number, titre: p.title, auteur: p.user?.login, date: p.created_at, lien: p.html_url, brouillon: Boolean(p.draft) })),
    prsPlus: prs.length > 5
  }
}

async function depots(uid: number, jeton: string, cle: string): Promise<UiProjetDepot[]> {
  const trouves = (await depotsGithub(uid, jeton)).filter((d) => !d.archived && correspond(d.name, cle)).slice(0, PAR_SECTION)
  return Promise.all(trouves.map((d) => depot(jeton, d)))
}

// ── Vercel ──────────────────────────────────────────────────────────────

export type DeploiementVercel = {
  uid: string
  name: string
  url?: string
  created: number
  state?: string
  readyState?: string
  target?: string | null
  inspectorUrl?: string
  meta?: { githubCommitRef?: string; githubCommitMessage?: string }
}

/** Son compte et ses équipes : sans `teamId`, Vercel ne montre que le compte personnel. */
export async function portees(jeton: string): Promise<(string | undefined)[]> {
  const equipes = ((await vercelApi(jeton, '/v2/teams').catch(() => ({}))) as { teams?: { id: string }[] }).teams ?? []
  return [undefined, ...equipes.slice(0, 4).map((t) => t.id)]
}

const etatVercel = (d: DeploiementVercel): UiProjetEtat => {
  const v = d.state ?? d.readyState
  return { label: vercelEtat(v) || 'Inconnu', ton: etat(v)?.ton ?? 'neutre' }
}

const deploiement = (d: DeploiementVercel): UiProjetDeploiement => ({
  statut: etatVercel(d),
  cible: d.target === 'production' ? 'production' : 'preview',
  date: new Date(d.created).toISOString(),
  ...(d.meta?.githubCommitRef ? { branche: d.meta.githubCommitRef } : {}),
  ...(d.meta?.githubCommitMessage ? { commit: d.meta.githubCommitMessage.split('\n')[0]!.slice(0, 140) } : {}),
  ...(d.inspectorUrl ? { lien: d.inspectorUrl } : d.url ? { lien: `https://${d.url}` } : {})
})

type ProjetVercel = { id: string; name: string; framework?: string | null; updatedAt?: number; targets?: { production?: { alias?: string[] } }; alias?: { domain?: string }[] }

async function sites(jeton: string, cle: string, nom: string): Promise<UiProjetSite[]> {
  const vus = new Map<string, { p: ProjetVercel; teamId?: string }>()
  for (const teamId of await portees(jeton)) {
    const d = (await vercelApi(jeton, '/v9/projects', { search: nom, limit: 20, teamId }).catch(() => ({}))) as { projects?: ProjetVercel[] }
    for (const p of d.projects ?? []) if (correspond(p.name, cle) && !vus.has(p.id)) vus.set(p.id, { p, teamId })
  }
  const trouves = [...vus.values()].sort((a, b) => (b.p.updatedAt ?? 0) - (a.p.updatedAt ?? 0)).slice(0, PAR_SECTION)
  return Promise.all(
    trouves.map(async ({ p, teamId }) => {
      const d = (await vercelApi(jeton, '/v6/deployments', { projectId: p.id, limit: 10, teamId }).catch(() => ({}))) as { deployments?: DeploiementVercel[] }
      const liste = d.deployments ?? []
      const prod = liste.find((x) => x.target === 'production')
      const dernier = liste[0]
      const domaine = p.targets?.production?.alias?.find((a) => !a.endsWith('.vercel.app')) ?? p.targets?.production?.alias?.[0] ?? p.alias?.[0]?.domain
      return {
        nom: p.name,
        ...(domaine ? { lien: `https://${domaine}` } : {}),
        ...(p.framework ? { framework: p.framework } : {}),
        ...(prod ? { production: deploiement(prod) } : {}),
        ...(dernier && dernier !== prod ? { dernier: deploiement(dernier) } : {})
      }
    })
  )
}

// ── Expo ────────────────────────────────────────────────────────────────

const PLATEFORME = { IOS: 'ios', ANDROID: 'android' } as const

export const lienBuild = (app: AppExpo, b: BuildExpo) => `https://expo.dev/accounts/${app.compte}/projects/${app.slug}/builds/${b.id}`

/** « Échec à l'installation des dépendances : … » ; null sans message. */
export function erreurBuild(b: BuildExpo): string | undefined {
  const m = b.error?.message?.replace(/\s+/g, ' ').trim()
  if (!m) return undefined
  return m.length > 240 ? `${m.slice(0, 239)}…` : m
}

function build(app: AppExpo, b: BuildExpo): UiProjetBuild {
  const version = [b.appVersion, b.appBuildVersion && `(${b.appBuildVersion})`].filter(Boolean).join(' ')
  const erreur = b.status === 'ERRORED' ? erreurBuild(b) : undefined
  return {
    plateforme: PLATEFORME[b.platform] ?? 'android',
    statut: etat(b.status) ?? { label: b.status, ton: 'neutre' },
    ...(version ? { version } : {}),
    ...(b.buildProfile ? { profil: b.buildProfile } : {}),
    date: b.completedAt ?? b.createdAt,
    ...(erreur ? { erreur } : {}),
    lien: lienBuild(app, b)
  }
}

async function applis(jeton: string, cle: string): Promise<UiProjetAppli[]> {
  const trouvees = (await appsAvecBuilds(jeton, 8)).filter((a) => correspond(a.slug, cle) || correspond(a.nom, cle))
  return trouvees
    .sort((a, b) => (b.builds[0]?.createdAt ?? '').localeCompare(a.builds[0]?.createdAt ?? ''))
    .slice(0, PAR_SECTION)
    .map((a) => ({
      nom: a.nom,
      id: a.appFullName,
      lien: a.lien,
      // Le dernier build de chaque plateforme, iOS d'abord.
      builds: (['IOS', 'ANDROID'] as const).flatMap((p) => {
        const b = a.builds.find((x) => x.platform === p)
        return b ? [build(a, b)] : []
      })
    }))
}

// ── Le projet ───────────────────────────────────────────────────────────

const PLATEFORME_FR = { ios: 'iOS', android: 'Android' }

/** Ce qui est en échec, en phrases courtes (« le déploiement en production de atlas-admin »). */
function echecs(p: Pick<UiProjet, 'depots' | 'sites' | 'applis'>): string[] {
  const out: string[] = []
  for (const d of p.depots) if (d.ci?.statut.ton === 'echec') out.push(`l’intégration continue de ${d.nom.split('/')[1]}`)
  for (const s of p.sites) {
    if (s.production?.statut.ton === 'echec') out.push(`la production de ${s.nom}`)
    if (s.dernier?.statut.ton === 'echec') out.push(`le dernier déploiement de ${s.nom}${s.dernier.branche ? ` (${s.dernier.branche})` : ''}`)
  }
  for (const a of p.applis) for (const b of a.builds) if (b.statut.ton === 'echec') out.push(`le build ${PLATEFORME_FR[b.plateforme]} de ${a.nom}`)
  return out
}

function enCours(p: Pick<UiProjet, 'depots' | 'sites' | 'applis'>): number {
  const tons = [...p.depots.map((d) => d.ci?.statut.ton), ...p.sites.flatMap((s) => [s.production?.statut.ton, s.dernier?.statut.ton]), ...p.applis.flatMap((a) => a.builds.map((b) => b.statut.ton))]
  return tons.filter((t) => t === 'encours' || t === 'attente').length
}

const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Le bilan : échecs d'abord, puis ce qui tourne, sinon tout va bien. */
export function bilan(p: Pick<UiProjet, 'nom' | 'depots' | 'sites' | 'applis'>): Pick<UiProjet, 'sante' | 'phrase'> {
  if (!p.depots.length && !p.sites.length && !p.applis.length) return { sante: 'inconnu', phrase: `Rien ne porte le nom « ${p.nom} » sur vos services reliés.` }
  const ko = echecs(p)
  if (ko.length === 1) return { sante: 'echec', phrase: `${majuscule(ko[0]!)} est en échec.` }
  if (ko.length) return { sante: 'echec', phrase: `${ko.length} échecs : ${ko.join(', ')}.` }
  const n = enCours(p)
  if (n) return { sante: 'encours', phrase: n === 1 ? 'Rien en échec ; une construction est en cours.' : `Rien en échec ; ${n} constructions sont en cours.` }
  return { sante: 'ok', phrase: 'Tout est au vert.' }
}

const LIBELLE = { github: 'GitHub', vercel: 'Vercel', expo: 'Expo' }

const raison = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** L'état du projet `nom` sur ses services reliés. */
export async function etatProjet(uid: number, nom: string, jetons: JetonsDev = jetonsDev(uid), now = Date.now()): Promise<UiProjet> {
  const cle = norme(nom)
  const manques: string[] = []
  const lire = async <T>(service: keyof JetonsDev, f: (jeton: string) => Promise<T[]>): Promise<T[]> => {
    const jeton = jetons[service]
    if (!jeton) {
      manques.push(service === 'expo' ? 'Expo : ajoutez un jeton d’accès (Réglages › Connecteurs › Expo) pour voir les builds' : `${LIBELLE[service]} : non relié`)
      return []
    }
    try {
      return await f(jeton)
    } catch (err) {
      manques.push(`${LIBELLE[service]} : ${raison(err)}`)
      return []
    }
  }
  const [d, s, a] = await Promise.all([lire('github', (j) => depots(uid, j, cle)), lire('vercel', (j) => sites(j, cle, nom)), lire('expo', (j) => applis(j, cle))])
  const p = { nom: nom.trim(), depots: d, sites: s, applis: a }
  return { kind: 'projet', ...p, ...bilan(p), manques, verifieLe: now }
}

/** L'outil : décrit à Claude dès qu'un service de développement est relié. */
export const projetTool: Tool = {
  name: 'projet_etat',
  description:
    "[Projets de développement, lecture] L'état d'un projet vu d'un coup (« où en est Atlas ? », « comment va orbit ? », « ça build ? ») : ses dépôts GitHub (derniers commits, pull requests ouvertes, intégration continue), ses sites Vercel (production, dernier déploiement) et ses applications Expo (dernier build iOS et Android). Un nom approché suffit : tout ce dont le nom le contient est réuni. Affiché à l'écran en tableau de bord. Pour le détail ensuite (journal d'un déploiement, logs d'un build), l'outil du service.",
  risk: 'lecture',
  ui: { kind: 'projet', title: (input) => `Projet · ${String(input.nom ?? '').trim()}` },
  input_schema: { type: 'object', properties: { nom: { type: 'string', description: 'Nom du projet tel que l’utilisateur le dit (« atlas »).' } }, required: ['nom'] },
  validate: (input) => (typeof input.nom === 'string' && norme(input.nom) ? null : 'Champ « nom » manquant.'),
  run: async (input, ctx) => {
    const vue = await etatProjet(ctx.user.id, String(input.nom))
    const { kind: _, ...pourClaude } = vue
    const text = JSON.stringify(pourClaude)
    return {
      content: `${text.slice(0, MAX_FOR_CLAUDE)}\nCe tableau est affiché à l'écran : dis le bilan en une ou deux phrases, ce qui est en échec d'abord ; ne lis ni liste ni identifiant.`,
      summary: `Projet ${vue.nom} : ${vue.phrase}`,
      view: vue
    }
  }
}
