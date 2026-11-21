import { getState, setState } from '../scheduler/store.ts'
import { appsAvecBuilds, gh } from './expo.ts'
import { vercelApi } from './natifs.ts'
import { depotsGithub, erreurBuild, lienBuild, portees, type DeploiementVercel, type RunGithub } from './projet.ts'
import type { JetonsDev } from './store.ts'

/**
 * Alertes de ses projets : toutes les 5 minutes, CODE relit lui-même (sans Claude, zéro token) les déploiements
 * Vercel, les GitHub Actions de ses dépôts actifs et les builds Expo, et le prévient de ce qui vient d'échouer,
 * avec la cause lue dans le journal. Rien n'est dit de ce qui réussit. Un échec n'est annoncé qu'une fois.
 * Repère gardé en base : le moment du dernier passage et les échecs déjà annoncés. Au tout premier passage,
 * rien n'est annoncé (sinon tous les vieux échecs sonneraient d'un coup) : le repère est seulement posé.
 */

const STATE_KEY = 'projets_alertes'
const EVERY_MS = 5 * 60_000
/** Un échec survenu juste avant le repère (construction longue) est encore vu au passage suivant. */
const RECOUVREMENT_MS = 30 * 60_000
/** Dépôts dont les Actions sont relues : poussés dans les trois derniers jours, huit au plus. */
const DEPOTS_ACTIFS_MS = 3 * 86_400_000
const MAX_DEPOTS = 8
const MAX_VUS = 300
/** Causes lues par passage (un journal par échec). */
const MAX_CAUSES = 4

export type EchecProjet = {
  /** Stable : « vercel:dpl_… », « github:<run id> », « expo:<build id> ». */
  cle: string
  source: 'github' | 'vercel' | 'expo'
  /** « atlas-admin », « octocat/atlas-api », « Atlas ». */
  projet: string
  /** « Déploiement en production », « Build Android », « Workflow CI ». Toujours masculin (« a échoué »). */
  quoi: string
  /** La production d'un site : annoncé même pendant les heures de silence. */
  grave: boolean
  /** Ce qui a cassé, lu dans le journal ; absent si rien de clair. */
  cause?: string
  /** Page de l'échec. */
  lien?: string
  /** Pour Claude, s'il faut lire le journal ensuite (« déploiement Vercel dpl_…, équipe … »). */
  ref: string
  /** Vercel : l'équipe du déploiement, pour lire son journal. */
  equipe?: string
  /** ISO. */
  date: string
}

type Etat = { depuis: number; vus: string[] }

export function loadEtat(uid: number): Etat | null {
  try {
    const e = JSON.parse(getState(uid, STATE_KEY) ?? '') as Etat
    if (typeof e.depuis === 'number' && Array.isArray(e.vus)) return e
  } catch {}
  return null
}

/** Les échecs pas encore annoncés, et le repère suivant. */
export function diffEchecs(prev: Etat | null, echecs: EchecProjet[], now: number): { nouveaux: EchecProjet[]; etat: Etat } {
  if (!prev) return { nouveaux: [], etat: { depuis: now, vus: echecs.map((e) => e.cle).slice(-MAX_VUS) } }
  const vus = new Set(prev.vus)
  const nouveaux = echecs.filter((e) => !vus.has(e.cle))
  return { nouveaux, etat: { depuis: now, vus: [...prev.vus, ...nouveaux.map((e) => e.cle)].slice(-MAX_VUS) } }
}

// ── Les causes ──────────────────────────────────────────────────────────

/** Lignes d'un journal qui disent l'erreur : la première qui compte (« Type error: … », « ERR! … »). */
const ERREUR = /(error|erreur|failed|fatal|cannot find|not found|unexpected|exception|ERR!)/i
const BRUIT = /^(\s*at |npm ERR! A complete log|npm ERR! *$|Error: Command "[^"]+" exited|Command "[^"]+" exited with|.*ELIFECYCLE|.*exited with \d+$)/i

export function causeDuJournal(lignes: string[]): string | undefined {
  const propres = lignes.map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').trim()).filter(Boolean)
  const i = propres.findIndex((l) => ERREUR.test(l) && !BRUIT.test(l))
  if (i < 0) return undefined
  // La ligne qui précède donne souvent le fichier (« ./src/orders.ts:12:5 »).
  const avant = propres[i - 1] && /\.\w{1,4}:\d+/.test(propres[i - 1]!) ? `${propres[i - 1]} ` : ''
  const t = `${avant}${propres[i]}`.replace(/\s+/g, ' ')
  return t.length > 220 ? `${t.slice(0, 219)}…` : t
}

// ── Vercel ──────────────────────────────────────────────────────────────

async function echecsVercel(jeton: string, depuis: number): Promise<EchecProjet[]> {
  const out: EchecProjet[] = []
  for (const teamId of await portees(jeton)) {
    const d = (await vercelApi(jeton, '/v6/deployments', { limit: 20, state: 'ERROR', since: depuis, teamId }).catch(() => ({}))) as { deployments?: DeploiementVercel[] }
    for (const x of d.deployments ?? []) {
      if (out.some((e) => e.cle === `vercel:${x.uid}`)) continue
      const prod = x.target === 'production'
      out.push({
        cle: `vercel:${x.uid}`,
        source: 'vercel',
        projet: x.name,
        quoi: prod ? 'Déploiement en production' : `Déploiement de prévisualisation${x.meta?.githubCommitRef ? ` (${x.meta.githubCommitRef})` : ''}`,
        grave: prod,
        ...(x.inspectorUrl ? { lien: x.inspectorUrl } : {}),
        ref: `déploiement Vercel ${x.uid}${teamId ? `, équipe ${teamId}` : ''}`,
        date: new Date(x.created).toISOString(),
        ...(teamId ? { equipe: teamId } : {})
      })
    }
  }
  return out
}

async function causeVercel(jeton: string, e: EchecProjet): Promise<string | undefined> {
  const id = e.cle.slice('vercel:'.length)
  const d = (await vercelApi(jeton, `/v3/deployments/${encodeURIComponent(id)}/events`, { teamId: e.equipe, limit: 400 })) as { text?: string; payload?: { text?: string } }[]
  return causeDuJournal((Array.isArray(d) ? d : []).map((x) => x.payload?.text ?? x.text ?? ''))
}

// ── GitHub Actions ──────────────────────────────────────────────────────

const RATE = new Set(['failure', 'timed_out', 'startup_failure'])

async function echecsGithub(uid: number, jeton: string, depuis: number, now: number): Promise<EchecProjet[]> {
  const actifs = (await depotsGithub(uid, jeton)).filter((d) => !d.archived && now - Date.parse(d.pushed_at) < DEPOTS_ACTIFS_MS).slice(0, MAX_DEPOTS)
  const parDepot = await Promise.all(
    actifs.map(async (d) => {
      const r = (await gh(jeton, `/repos/${d.full_name}/actions/runs?per_page=10&created=${encodeURIComponent(`>=${new Date(depuis - 6 * 3600_000).toISOString().slice(0, 19)}Z`)}`).catch(() => ({}))) as { workflow_runs?: RunGithub[] }
      return (r.workflow_runs ?? [])
        .filter((x) => x.status === 'completed' && RATE.has(x.conclusion ?? '') && Date.parse(x.updated_at) >= depuis)
        .map(
          (x): EchecProjet => ({
            cle: `github:${x.id}`,
            source: 'github',
            projet: d.full_name,
            quoi: `Workflow ${x.name ?? 'GitHub Actions'}${x.head_branch && x.head_branch !== d.default_branch ? ` (${x.head_branch})` : ''}`,
            grave: false,
            lien: x.html_url,
            ref: `run GitHub Actions ${x.id} du dépôt ${d.full_name}`,
            date: x.updated_at
          })
        )
    })
  )
  return parDepot.flat()
}

/** « job test, étape « Run pnpm test » ». */
async function causeGithub(jeton: string, e: EchecProjet): Promise<string | undefined> {
  const id = e.cle.slice('github:'.length)
  const d = (await gh(jeton, `/repos/${e.projet}/actions/runs/${id}/jobs?per_page=30`)) as { jobs?: { name: string; conclusion: string | null; steps?: { name: string; conclusion: string | null }[] }[] }
  const job = d.jobs?.find((j) => RATE.has(j.conclusion ?? ''))
  if (!job) return undefined
  const etape = job.steps?.find((s) => RATE.has(s.conclusion ?? ''))
  return `Job « ${job.name} »${etape ? `, étape « ${etape.name} »` : ''}.`
}

// ── Expo ────────────────────────────────────────────────────────────────

async function echecsExpo(jeton: string, depuis: number): Promise<EchecProjet[]> {
  const apps = await appsAvecBuilds(jeton, 3)
  return apps.flatMap((a) =>
    a.builds
      .filter((b) => b.status === 'ERRORED' && Date.parse(b.completedAt ?? b.createdAt) >= depuis)
      .map((b): EchecProjet => {
        const cause = erreurBuild(b)
        return {
          cle: `expo:${b.id}`,
          source: 'expo',
          projet: a.nom,
          quoi: `Build ${b.platform === 'IOS' ? 'iOS' : 'Android'}${b.buildProfile ? ` ${b.buildProfile}` : ''}`,
          grave: false,
          ...(cause ? { cause } : {}),
          lien: lienBuild(a, b),
          ref: `build Expo ${b.id} du projet ${a.appFullName}`,
          date: b.completedAt ?? b.createdAt
        }
      })
  )
}

/**
 * Un passage sur ses services : les échecs survenus depuis `depuis`, avec leur cause. Un service en panne
 * est sauté (cité dans `erreurs`), les autres sont relus quand même.
 */
export async function releverEchecs(uid: number, jetons: JetonsDev, depuis: number, now = Date.now()): Promise<{ echecs: EchecProjet[]; erreurs: string[] }> {
  const erreurs: string[] = []
  const lire = async (service: string, f: () => Promise<EchecProjet[]>) => {
    try {
      return await f()
    } catch (err) {
      erreurs.push(`${service} : ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }
  const [v, g, x] = await Promise.all([
    jetons.vercel ? lire('Vercel', () => echecsVercel(jetons.vercel!, depuis)) : [],
    jetons.github ? lire('GitHub', () => echecsGithub(uid, jetons.github!, depuis, now)) : [],
    jetons.expo ? lire('Expo', () => echecsExpo(jetons.expo!, depuis)) : []
  ])
  return { echecs: [...v, ...g, ...x].sort((a, b) => b.date.localeCompare(a.date)), erreurs }
}

/** Lit la cause des échecs à annoncer qui n'en ont pas encore (journal Vercel, jobs GitHub). */
export async function completerCauses(echecs: EchecProjet[], jetons: JetonsDev): Promise<EchecProjet[]> {
  return Promise.all(
    echecs.map(async (e, i) => {
      if (e.cause || i >= MAX_CAUSES) return e
      const cause = await (e.source === 'vercel' && jetons.vercel ? causeVercel(jetons.vercel, e) : e.source === 'github' && jetons.github ? causeGithub(jetons.github, e) : Promise.resolve(undefined)).catch(() => undefined)
      return cause ? { ...e, cause } : e
    })
  )
}

export type AlertesHooks = {
  /** Arrêt d'urgence : rien n'est relevé ni annoncé. */
  halted(): boolean
  jetons(): JetonsDev
  /** Les échecs nouveaux, cause comprise. */
  notify(nouveaux: EchecProjet[]): void
}

/** Un passage pour cet utilisateur : relève, compare au repère, l'avance, annonce ce qui est nouveau. */
export async function runAlertesProjets(uid: number, hooks: AlertesHooks, now = Date.now()): Promise<EchecProjet[]> {
  if (hooks.halted()) return []
  const jetons = hooks.jetons()
  const prev = loadEtat(uid)
  const { echecs, erreurs } = await releverEchecs(uid, jetons, (prev?.depuis ?? now) - RECOUVREMENT_MS, now)
  if (erreurs.length && !echecs.length && erreurs.length === Object.keys(jetons).length) throw new Error(erreurs.join(' ; '))
  const { nouveaux, etat } = diffEchecs(prev, echecs, now)
  setState(uid, STATE_KEY, JSON.stringify(etat))
  if (!nouveaux.length) return []
  const complets = await completerCauses(nouveaux, jetons)
  hooks.notify(complets)
  return complets
}

/**
 * Lance les alertes de projets de chacun : premier passage deux minutes après le démarrage, puis toutes les
 * 5 minutes, l'un après l'autre. Une panne n'est écrite qu'une fois au journal, jusqu'au retour.
 * CODE_ALERTES_PROJETS=jamais les coupe (tests de bout en bout).
 */
export function startAlertesProjets(users: () => number[], hooksOf: (uid: number) => AlertesHooks | null): () => void {
  if (process.env.CODE_ALERTES_PROJETS === 'jamais') return () => {}
  let running = false
  const enPanne = new Set<number>()
  const tick = async () => {
    if (running) return
    running = true
    try {
      for (const uid of users()) {
        const hooks = hooksOf(uid)
        if (!hooks) continue
        try {
          const nouveaux = await runAlertesProjets(uid, hooks)
          if (nouveaux.length) console.log(`[projets] Utilisateur ${uid} : ${nouveaux.length} échec(s) : ${nouveaux.map((e) => e.cle).join(', ')}`)
          enPanne.delete(uid)
        } catch (err) {
          if (!enPanne.has(uid)) console.warn(`[projets] Utilisateur ${uid} : relève impossible : ${err instanceof Error ? err.message : String(err)}`)
          enPanne.add(uid)
        }
      }
    } finally {
      running = false
    }
  }
  const start = setTimeout(() => void tick(), 2 * 60_000)
  const timer = setInterval(() => void tick(), EVERY_MS)
  start.unref()
  timer.unref()
  return () => {
    clearTimeout(start)
    clearInterval(timer)
  }
}
