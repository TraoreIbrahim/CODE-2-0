import { jetonsDev } from './store.ts'

/**
 * Les outils Expo veulent « @compte/slug » (ou l'identifiant EAS du projet) ; l'utilisateur, lui, dit
 * « atlas ». CODE retrouve le projet sans le demander : dans ses dépôts GitHub (connecteur GitHub), le
 * app.json du dépôt dont le nom ressemble le plus donne expo.owner, expo.slug et extra.eas.projectId.
 */

export type ProjetExpo = { appFullName?: string; appId?: string; depot: string }

/** Par utilisateur : nom demandé → projet trouvé. */
const connus = new Map<number, Map<string, ProjetExpo>>()

export const norme = (s: string) => s.toLowerCase().replace(/^@[^/]+\//, '').replace(/[^a-z0-9]+/g, '')

export async function gh(jeton: string, path: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${jeton}`, Accept: 'application/vnd.github+json', 'User-Agent': 'CODE 2.0' },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`GitHub ${res.status}`)
  return res.json()
}

type Expo = { owner?: string; slug?: string; extra?: { eas?: { projectId?: string } } }

/** La config Expo d'un dépôt : app.json (ou app.config.json), à la racine. */
async function configDe(jeton: string, depot: string): Promise<Expo | null> {
  for (const fichier of ['app.json', 'app.config.json']) {
    try {
      const d = (await gh(jeton, `/repos/${depot}/contents/${fichier}`)) as { content?: string }
      const json = JSON.parse(Buffer.from(d.content ?? '', 'base64').toString('utf8')) as { expo?: Expo } & Expo
      return json.expo ?? json
    } catch {}
  }
  return null
}

/**
 * Le projet Expo désigné par un nom (« atlas », « atlas plus »). Les dépôts dont le nom contient le nom
 * cherché sont lus, le plus proche d'abord ; un slug identique l'emporte. Null si rien ne correspond.
 */
export async function trouverProjetExpo(uid: number, nom: string): Promise<ProjetExpo | null> {
  const cle = norme(nom)
  if (!cle) return null
  const deja = connus.get(uid)?.get(cle)
  if (deja) return deja
  const jeton = jetonsDev(uid).github
  if (!jeton) return null
  const retenu = await chercher(jeton, cle)
  if (retenu) {
    if (!connus.has(uid)) connus.set(uid, new Map())
    connus.get(uid)!.set(cle, retenu)
  }
  return retenu
}

/** La recherche elle-même, avec un jeton GitHub ; `cle` : le nom normalisé. */
export async function chercher(jeton: string, cle: string): Promise<ProjetExpo | null> {
  const depots = (await gh(jeton, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member')) as { full_name: string; name: string }[]
  const candidats = depots
    .filter((d) => norme(d.name).includes(cle))
    // « atlas-app » avant « atlas-admin-old » : le nom le plus court d'abord.
    .sort((a, b) => a.name.length - b.name.length)
    .slice(0, 6)
  let retenu: ProjetExpo | null = null
  for (const d of candidats) {
    const expo = await configDe(jeton, d.full_name)
    if (!expo?.slug) continue
    const projet: ProjetExpo = { depot: d.full_name, ...(expo.owner ? { appFullName: `@${expo.owner}/${expo.slug}` } : {}), ...(expo.extra?.eas?.projectId ? { appId: expo.extra.eas.projectId } : {}) }
    if (!projet.appFullName && !projet.appId) continue
    if (norme(expo.slug) === cle) {
      retenu = projet
      break
    }
    retenu ??= projet
  }
  return retenu
}

/** « @octocat/atlas » est déjà un identifiant ; « atlas » est un nom à retrouver. */
export const estNomSimple = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && !v.includes('/') && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)

// ── Jeton d'accès Expo : la liste de tous les projets ───────────────────

/**
 * L'accès OAuth du connecteur ne vaut que pour le serveur MCP d'Expo, qui ne sait pas lister les projets.
 * Un jeton d'accès Expo (expo.dev › Access tokens), rangé en complément, ouvre l'API d'Expo : tous les
 * projets du compte et de ses organisations.
 */
export type AppExpo = { nom: string; slug: string; compte: string; appFullName: string; appId: string; lien: string }

const LISTE = `{ meActor { accounts { name appsPaginated(first: 100) { edges { node { id name slug fullName } } } } } }`

/** Les derniers builds de chaque projet, dans la même requête. */
const AVEC_BUILDS = (n: number) =>
  `{ meActor { accounts { name appsPaginated(first: 100) { edges { node { id name slug fullName builds(offset: 0, limit: ${n}) { id platform status appVersion appBuildVersion buildProfile createdAt completedAt gitCommitMessage error { message buildPhase } } } } } } } }`

export type BuildExpo = {
  id: string
  platform: 'IOS' | 'ANDROID'
  status: string
  appVersion?: string | null
  appBuildVersion?: string | null
  buildProfile?: string | null
  createdAt: string
  completedAt?: string | null
  gitCommitMessage?: string | null
  error?: { message?: string | null; buildPhase?: string | null } | null
}

type Noeud = { id: string; name: string; slug: string; fullName: string; builds?: BuildExpo[] }

async function graphql(jeton: string, query: string): Promise<{ name: string; appsPaginated?: { edges?: { node: Noeud }[] } }[]> {
  const res = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'jeton Expo refusé' : `Expo ${res.status}`)
  const d = (await res.json()) as { data?: { meActor?: { accounts?: { name: string; appsPaginated?: { edges?: { node: Noeud }[] } }[] } | null }; errors?: { message: string }[] }
  if (!d.data?.meActor) throw new Error(d.errors?.[0]?.message ?? 'jeton Expo refusé')
  return d.data.meActor.accounts ?? []
}

const appDe = (compte: string, node: Noeud): AppExpo => ({ nom: node.name, slug: node.slug, compte, appFullName: node.fullName, appId: node.id, lien: `https://expo.dev/accounts/${compte}/projects/${node.slug}` })

export async function appsExpo(jeton: string): Promise<AppExpo[]> {
  return (await graphql(jeton, LISTE)).flatMap((a) => (a.appsPaginated?.edges ?? []).map(({ node }) => appDe(a.name, node)))
}

/** Tous les projets avec leurs `n` derniers builds (état d'un projet, alertes). */
export async function appsAvecBuilds(jeton: string, n: number): Promise<(AppExpo & { builds: BuildExpo[] })[]> {
  return (await graphql(jeton, AVEC_BUILDS(n))).flatMap((a) => (a.appsPaginated?.edges ?? []).map(({ node }) => ({ ...appDe(a.name, node), builds: node.builds ?? [] })))
}

/** Le projet le plus proche d'un nom parmi la liste : slug ou nom identique, sinon qui le contient. */
export function parmi(apps: AppExpo[], nom: string): AppExpo | null {
  const cle = norme(nom)
  return apps.find((a) => norme(a.slug) === cle || norme(a.nom) === cle) ?? apps.filter((a) => norme(a.slug).includes(cle) || norme(a.nom).includes(cle)).sort((a, b) => a.slug.length - b.slug.length)[0] ?? null
}

/** Les comptes Expo déjà rencontrés pour cet utilisateur (« octocat »), pour deviner « @octocat/nova ». */
export function comptesConnus(uid: number): string[] {
  return [...new Set([...(connus.get(uid)?.values() ?? [])].map((p) => p.appFullName?.match(/^@([^/]+)\//)?.[1]).filter((x): x is string => Boolean(x)))]
}

/** « Nova Pro » → « nova-pro » : le slug probable. */
export const slugProbable = (nom: string) => nom.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Vérifie un jeton complémentaire avant de le garder ; renvoie la raison du refus, ou null. */
export async function verifierComplement(service: string, jeton: string): Promise<string | null> {
  if (service !== 'expo') return 'jeton complémentaire inconnu pour ce service'
  try {
    await appsExpo(jeton)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
