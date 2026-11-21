import type { UiConnecteur, UiDevCarte, UiDevIcone, UiDevTon, UiFact } from '@code/protocol'
import { frDate, frLabel } from '../tools/fr.ts'

/**
 * Les résultats des connecteurs, mis en blocs : un JSON de GitHub, de Vercel ou d'Expo devient des cartes
 * (pull request, déploiement, build…) avec un titre, un état coloré, son dépôt ou projet, ses branches, son
 * auteur et un lien vers sa page. On reconnaît chaque élément à sa forme, pas au nom de l'outil : un nouvel
 * outil du même service s'affiche aussi bien. Les adresses d'API, identifiants internes et drapeaux techniques
 * (« incomplete_results ») ne sont jamais montrés.
 */

type Obj = Record<string, unknown>

const MAX_CARTES = 60
const MAX_TEXTE = 8000

const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined)
const at = (o: Obj, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (isObj(v) ? v[k] : undefined), o)
const first = (o: Obj, paths: string[]): string | undefined => {
  for (const p of paths) {
    const v = str(at(o, p))
    if (v) return v
  }
  return undefined
}

/** Une page web, jamais une adresse d'API. */
function webLink(v: string | undefined): string | undefined {
  if (!v) return undefined
  const url = /^https?:\/\//.test(v) ? v : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(v) ? `https://${v}` : undefined
  if (!url || /\/\/api\.|\/repos\/|\/graphql/.test(url)) return undefined
  return url
}

/** « https://api.github.com/repos/octocat/atlas » ou « …/octocat/atlas/pull/4 » → « octocat/atlas ». */
function repoOf(o: Obj): string | undefined {
  const full = first(o, ['repository.full_name', 'repo.full_name', 'base.repo.full_name', 'repository_name', 'repo'])
  if (full && full.includes('/')) return full
  const url = first(o, ['repository_url', 'html_url', 'url'])
  return url?.match(/github\.com\/(?:repos\/)?([^/]+\/[^/]+)/)?.[1]
}

/** Première ligne d'un texte, sans Markdown, coupée proprement. */
function extrait(v: string | undefined, max = 180): string | undefined {
  if (!v) return undefined
  const t = v
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>]|\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return undefined
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

const firstLine = (v: string | undefined) => v?.split('\n')[0]?.trim() || undefined

// ── États ──────────────────────────────────────────────────────────────

const ETATS: [RegExp, UiDevTon, string][] = [
  [/^(ready|success|succeeded|finished|completed|passed|ok|done|active|healthy|published|deployed|resolved)$/i, 'ok', 'Réussi'],
  [/^(error|errored|failure|failed|crashed|timed_out|startup_failure|unhealthy)$/i, 'echec', 'Échec'],
  [/^(building|in_progress|initializing|running|deploying|started|pending_cancel)$/i, 'encours', 'En cours'],
  [/^(queued|in_queue|new|pending|waiting|requested|action_required|scheduled)$/i, 'attente', 'En file'],
  [/^(canceled|cancelled|skipped|stale|neutral|archived|deleted|expired)$/i, 'ferme', 'Annulé'],
  [/^(open|opened)$/i, 'ouvert', 'Ouvert'],
  [/^(closed)$/i, 'ferme', 'Fermé'],
  [/^(merged)$/i, 'fusionne', 'Fusionnée'],
  [/^(draft)$/i, 'brouillon', 'Brouillon']
]

const LIBELLES_ETAT: Record<string, string> = { skipped: 'Ignoré', archived: 'Archivé', expired: 'Expiré', deleted: 'Supprimé', resolved: 'Résolu', active: 'Actif', published: 'Publié', crashed: 'Plantage', timed_out: 'Délai dépassé' }

export function etat(v: string | undefined): { label: string; ton: UiDevTon } | undefined {
  if (!v) return undefined
  for (const [re, ton, label] of ETATS) if (re.test(v)) return { ton, label: LIBELLES_ETAT[v.toLowerCase()] ?? label }
  return { ton: 'neutre', label: frLabel(v) }
}

// ── Reconnaissance des éléments ─────────────────────────────────────────

const isPR = (o: Obj) => 'pull_request' in o || ('head' in o && 'base' in o) || 'merged_at' in o || /\/pull\/\d+/.test(str(o.html_url) ?? '')
const isIssue = (o: Obj) => typeof o.number === 'number' && (/\/issues\/\d+/.test(str(o.html_url) ?? '') || 'comments' in o)
const isCommit = (o: Obj) => typeof o.sha === 'string' && (isObj(o.commit) || typeof o.message === 'string')
const isRepo = (o: Obj) => typeof o.full_name === 'string' && ('stargazers_count' in o || 'default_branch' in o || 'private' in o)
const isRun = (o: Obj) => 'run_number' in o || ('conclusion' in o && 'head_branch' in o)
const isVercelDeploy = (o: Obj) => 'etat' in o && 'projet' in o
const isBuild = (o: Obj) => typeof o.platform === 'string' && ('status' in o || 'buildProfile' in o || 'appVersion' in o)
const isAppExpo = (o: Obj) => typeof o.appFullName === 'string' && 'compte' in o
const isProjet = (o: Obj) => 'framework' in o && ('nom' in o || 'name' in o)
const isLigne = (o: Obj) => Object.keys(o).length === 1 && typeof o.ligne === 'string'

function avatar(o: Obj): string | undefined {
  return webLink(first(o, ['user.avatar_url', 'author.avatar_url', 'actor.avatar_url', 'owner.avatar_url', 'avatar_url']))
}

function auteur(o: Obj): string | undefined {
  return first(o, ['user.login', 'author.login', 'actor.login', 'triggering_actor.login', 'commit.author.name', 'creator.username', 'initiatedBy.username', 'initiatingActor.username', 'initiator.username', 'auteur', 'author.name', 'author', 'owner.login'])
}

function dateOf(o: Obj): string | undefined {
  const d = first(o, ['merged_at', 'updated_at', 'updatedAt', 'commit.author.date', 'completedAt', 'completed_at', 'created_at', 'createdAt', 'cree', 'misAJour', 'modifie', 'date', 'run_started_at', 'pushed_at'])
  if (!d) return undefined
  if (/^\d{12,}$/.test(d)) return new Date(Number(d)).toISOString()
  return Number.isNaN(new Date(d).getTime()) ? undefined : d
}

function carte(o: Obj): UiDevCarte {
  if (isLigne(o)) return { icone: 'ligne', titre: String(o.ligne) }
  if (isPR(o)) {
    const merged = Boolean(str(o.merged_at) ?? str(at(o, 'pull_request.merged_at'))) || o.merged === true
    const statut: UiDevCarte['statut'] = merged
      ? { label: 'Fusionnée', ton: 'fusionne' }
      : o.draft === true
        ? { label: 'Brouillon', ton: 'brouillon' }
        : o.state === 'closed'
          ? { label: 'Fermée', ton: 'ferme' }
          : { label: 'Ouverte', ton: 'ouvert' }
    const head = first(o, ['head.ref'])
    const base = first(o, ['base.ref'])
    return clean({
      icone: 'pr',
      titre: str(o.title) ?? 'Pull request',
      numero: typeof o.number === 'number' ? `#${o.number}` : undefined,
      statut,
      contexte: repoOf(o),
      puces: [...(head && base ? [`${head} → ${base}`] : []), ...labels(o)],
      auteur: auteur(o),
      avatar: avatar(o),
      date: dateOf(o),
      extrait: extrait(str(o.body)),
      lien: webLink(str(o.html_url) ?? first(o, ['pull_request.html_url']))
    })
  }
  if (isCommit(o)) {
    const message = str(at(o, 'commit.message')) ?? str(o.message)
    return clean({
      icone: 'commit',
      titre: firstLine(message) ?? 'Commit',
      numero: String(o.sha).slice(0, 7),
      contexte: repoOf(o),
      auteur: auteur(o),
      avatar: avatar(o),
      date: dateOf(o),
      lien: webLink(str(o.html_url))
    })
  }
  if (isRun(o)) {
    const fini = str(o.status) === 'completed'
    return clean({
      icone: 'workflow',
      titre: first(o, ['display_title', 'name', 'workflow_name']) ?? 'Exécution',
      numero: typeof o.run_number === 'number' ? `n° ${o.run_number}` : undefined,
      statut: etat(fini ? str(o.conclusion) : str(o.status)),
      contexte: repoOf(o),
      puces: [str(o.name) !== str(o.display_title) ? str(o.name) : undefined, str(o.head_branch), str(o.event) ? frLabel(String(o.event)) : undefined].filter((x): x is string => Boolean(x)),
      auteur: auteur(o),
      avatar: avatar(o),
      date: dateOf(o),
      lien: webLink(str(o.html_url))
    })
  }
  if (isRepo(o)) {
    return clean({
      icone: 'depot',
      titre: String(o.name ?? o.full_name),
      contexte: str(at(o, 'owner.login')),
      statut: o.private === true ? { label: 'Privé', ton: 'neutre' } : o.private === false ? { label: 'Public', ton: 'neutre' } : undefined,
      puces: [str(o.language), o.archived === true ? 'archivé' : undefined, o.fork === true ? 'fork' : undefined].filter((x): x is string => Boolean(x)),
      extrait: extrait(str(o.description)),
      date: dateOf(o),
      lien: webLink(str(o.html_url)),
      faits: [
        typeof o.stargazers_count === 'number' ? { label: 'Étoiles', valeur: String(o.stargazers_count) } : null,
        typeof o.open_issues_count === 'number' ? { label: 'Issues ouvertes', valeur: String(o.open_issues_count) } : null
      ].filter((x): x is UiFact => x !== null)
    })
  }
  if (isIssue(o)) {
    return clean({
      icone: 'issue',
      titre: str(o.title) ?? 'Issue',
      numero: `#${o.number}`,
      statut: o.state === 'closed' ? { label: 'Fermée', ton: 'ferme' } : { label: 'Ouverte', ton: 'ouvert' },
      contexte: repoOf(o),
      puces: labels(o),
      auteur: auteur(o),
      avatar: avatar(o),
      date: dateOf(o),
      extrait: extrait(str(o.body)),
      lien: webLink(str(o.html_url))
    })
  }
  if (isVercelDeploy(o)) {
    const cible = str(o.cible)
    return clean({
      icone: 'deploiement',
      titre: firstLine(str(o.commit)) ?? str(o.adresse) ?? 'Déploiement',
      statut: etat(str(o.etat)) && { ...etat(str(o.etat))!, label: vercelEtat(str(o.etat)) },
      contexte: str(o.projet),
      puces: [cible === 'production' ? 'Production' : 'Aperçu', str(o.branche)].filter((x): x is string => Boolean(x)),
      auteur: str(o.auteur),
      date: dateOf(o),
      lien: webLink(str(o.adresse))
    })
  }
  if (isBuild(o)) {
    const platform = String(o.platform).toLowerCase()
    const version = first(o, ['appVersion', 'version', 'runtimeVersion'])
    const numero = first(o, ['appBuildVersion', 'buildNumber'])
    return clean({
      icone: platform.includes('ios') ? 'ios' : platform.includes('android') ? 'android' : 'build',
      titre: `${platform.includes('ios') ? 'iOS' : platform.includes('android') ? 'Android' : frLabel(platform)}${version ? ` ${version}` : ''}${numero ? ` (${numero})` : ''}`,
      statut: etat(first(o, ['status'])),
      contexte: first(o, ['project.fullName', 'app.fullName', 'appFullName', 'project.name', 'app.name']),
      puces: [first(o, ['buildProfile', 'profile']), first(o, ['distribution']), first(o, ['channel', 'releaseChannel']), first(o, ['gitCommitHash'])?.slice(0, 7)].filter((x): x is string => Boolean(x)),
      auteur: auteur(o),
      date: dateOf(o),
      extrait: extrait(first(o, ['gitCommitMessage', 'message', 'error.message'])),
      lien: webLink(first(o, ['logsUrl', 'url', 'artifacts.buildUrl', 'artifacts.applicationArchiveUrl']))
    })
  }
  if (isAppExpo(o)) {
    return clean({ icone: 'projet', titre: String(o.nom ?? o.slug), contexte: str(o.compte), puces: [String(o.appFullName)], lien: webLink(str(o.lien)) })
  }
  if (isProjet(o)) {
    return clean({
      icone: 'projet',
      titre: String(o.nom ?? o.name),
      puces: [str(o.framework) ?? 'sans framework'],
      date: dateOf(o),
      lien: webLink(first(o, ['lien', 'adresse']))
    })
  }
  return generique(o)
}

export function vercelEtat(v: string | undefined): string {
  return ({ READY: 'En ligne', ERROR: 'Échec', BUILDING: 'Construction', INITIALIZING: 'Démarrage', QUEUED: 'En file', CANCELED: 'Annulé' } as Record<string, string>)[v ?? ''] ?? (etat(v)?.label ?? '')
}

function labels(o: Obj): string[] {
  return (Array.isArray(o.labels) ? o.labels : []).map((l) => (isObj(l) ? str(l.name) : str(l))).filter((x): x is string => Boolean(x)).slice(0, 4)
}

/** Champs techniques jamais montrés. */
const CACHE = /(^|_)(id|node_id|sha|url|uri|href|hash|etag|cursor|token|secret|key|nonce|checksum)$|_url$|Url$|Id$|^(incomplete_results|total_count|has_more|per_page|page|__typename|meta|links|_links|permissions|locked|score)$/i

/** Un élément inconnu : son meilleur titre, son état, sa date, et quelques faits lisibles. */
function generique(o: Obj): UiDevCarte {
  const titre = first(o, ['title', 'titre', 'name', 'nom', 'displayName', 'display_name', 'full_name', 'fullName', 'message', 'slug', 'login', 'key', 'cle', 'label'])
  const statutBrut = first(o, ['state', 'status', 'etat', 'conclusion', 'readyState'])
  const faits: UiFact[] = []
  for (const [k, v] of Object.entries(o)) {
    if (faits.length >= 6 || CACHE.test(k)) continue
    if (['title', 'titre', 'name', 'nom', 'state', 'status', 'etat', 'description', 'body'].includes(k)) continue
    const s = typeof v === 'boolean' ? (v ? 'oui' : 'non') : str(v)
    if (!s || s === titre || webLink(s) || s.length > 80) continue
    faits.push({ label: frLabel(k), valeur: /^\d{4}-\d{2}-\d{2}T/.test(s) ? frDate(s) : /^\d{12,}$/.test(s) ? frDate(new Date(Number(s)).toISOString()) : s })
  }
  return clean({
    icone: 'element',
    titre: firstLine(titre) ?? 'Élément',
    statut: etat(statutBrut),
    contexte: repoOf(o) ?? first(o, ['projet', 'project.name', 'app.name', 'team.name']),
    auteur: auteur(o),
    avatar: avatar(o),
    date: dateOf(o),
    extrait: extrait(first(o, ['description', 'body', 'summary'])),
    lien: webLink(first(o, ['html_url', 'web_url', 'webUrl', 'permalink', 'url', 'link', 'lien', 'adresse'])),
    faits
  })
}

/** Retire les champs vides (le protocole n'en veut pas). */
function clean(c: UiDevCarte): UiDevCarte {
  const out = { ...c } as Record<string, unknown>
  for (const [k, v] of Object.entries(out)) if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete out[k]
  return out as UiDevCarte
}

// ── Disposition et résumé ───────────────────────────────────────────────

function disposition(cartes: UiDevCarte[]): UiConnecteur['disposition'] {
  const icones = new Set(cartes.map((c) => c.icone))
  if (icones.has('ligne')) return 'journal'
  if ([...icones].every((i) => ['deploiement', 'commit', 'workflow', 'build', 'ios', 'android'].includes(i))) return 'frise'
  if ([...icones].every((i) => i === 'depot' || i === 'projet')) return 'grille'
  return 'cartes'
}

/** Masculin singulier, pluriel, féminin singulier, pluriel. */
const ACCORDS: Partial<Record<UiDevTon, [string, string, string, string]>> = {
  ouvert: ['ouvert', 'ouverts', 'ouverte', 'ouvertes'],
  fusionne: ['fusionné', 'fusionnés', 'fusionnée', 'fusionnées'],
  ferme: ['fermé', 'fermés', 'fermée', 'fermées'],
  brouillon: ['brouillon', 'brouillons', 'brouillon', 'brouillons'],
  ok: ['réussi', 'réussis', 'réussie', 'réussies'],
  echec: ['en échec', 'en échec', 'en échec', 'en échec'],
  encours: ['en cours', 'en cours', 'en cours', 'en cours'],
  attente: ['en file', 'en file', 'en file', 'en file']
}

const NOMS: Partial<Record<UiDevIcone, [string, string, boolean]>> = {
  pr: ['pull request', 'pull requests', true],
  issue: ['issue', 'issues', true],
  commit: ['commit', 'commits', false],
  depot: ['dépôt', 'dépôts', false],
  projet: ['projet', 'projets', false],
  deploiement: ['déploiement', 'déploiements', false],
  workflow: ['exécution', 'exécutions', true],
  build: ['build', 'builds', false],
  ios: ['build', 'builds', false],
  android: ['build', 'builds', false],
  ligne: ['ligne', 'lignes', true]
}

/** « 5 pull requests », « 3 ouvertes », « 2 fusionnées », « 2 dépôts ». */
function resume(cartes: UiDevCarte[], total: number): UiConnecteur['resume'] {
  const nom = NOMS[cartes[0]?.icone ?? 'element']
  const feminin = nom?.[2] ?? false
  const out: UiConnecteur['resume'] = [{ label: nom ? (total > 1 ? nom[1] : nom[0]) : total > 1 ? 'éléments' : 'élément', valeur: String(total) }]
  const parTon = new Map<UiDevTon, number>()
  for (const c of cartes) if (c.statut && c.statut.ton !== 'neutre') parTon.set(c.statut.ton, (parTon.get(c.statut.ton) ?? 0) + 1)
  if (parTon.size > 1 || (parTon.size === 1 && cartes.length > 1)) {
    for (const [ton, n] of [...parTon].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
      const mots = ACCORDS[ton]
      if (mots) out.push({ label: mots[(feminin ? 2 : 0) + (n > 1 ? 1 : 0)]!, valeur: String(n), ton })
    }
  }
  const contextes = new Set(cartes.map((c) => c.contexte).filter(Boolean))
  if (contextes.size > 1) out.push({ label: cartes[0]?.icone === 'deploiement' ? 'projets' : cartes[0]?.icone === 'projet' ? 'comptes' : 'dépôts', valeur: String(contextes.size) })
  return out
}

// ── Titres ──────────────────────────────────────────────────────────────

const MOTS: Record<string, string> = {
  'pull requests': 'Pull requests',
  'pull request': 'Pull request',
  issues: 'Issues',
  issue: 'Issue',
  commits: 'Commits',
  commit: 'Commit',
  repositories: 'Dépôts',
  repository: 'Dépôt',
  repos: 'Dépôts',
  branches: 'Branches',
  releases: 'Versions publiées',
  release: 'Version publiée',
  tags: 'Étiquettes',
  'workflow runs': 'Exécutions des Actions',
  workflows: 'Workflows',
  'workflow run': 'Exécution',
  jobs: 'Tâches',
  notifications: 'Notifications',
  'code scanning alerts': 'Alertes de sécurité du code',
  'file contents': 'Fichier',
  files: 'Fichiers',
  file: 'Fichier',
  comments: 'Commentaires',
  reviews: 'Relectures',
  me: 'Mon profil',
  users: 'Utilisateurs',
  teams: 'Équipes',
  deployments: 'Déploiements',
  deployment: 'Déploiement',
  builds: 'Builds',
  build: 'Build',
  submissions: 'Soumissions',
  updates: 'Mises à jour',
  projects: 'Projets',
  project: 'Projet',
  versions: 'Versions',
  'app versions': 'Versions de l’application',
  documentation: 'Documentation',
  events: 'Évènements',
  metrics: 'Mesures',
  crashes: 'Plantages',
  reviews_store: 'Avis',
  diagram: 'Schéma',
  view: 'Schéma'
}

const VERBES = /^(search|list|get|read|fetch|find|view|show|describe|retrieve|lookup|query|observe|create|draw|run)\s+/i

/** « Search pull requests » / « list_workflow_runs » → « Pull requests » / « Exécutions des Actions ». */
export function titreFr(nom: string, titre?: string): string {
  const base = (titre ?? nom)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()
  const sans = base.replace(VERBES, '').replace(/^(my|all|the)\s+/, '')
  if (MOTS[sans]) return MOTS[sans]
  // « build list » → « builds » ; « build info » → « build ».
  const m = sans.match(/^(.*?)\s+(list|info|details|logs|status)$/)
  if (m && MOTS[m[1]!]) return m[2] === 'list' ? (MOTS[`${m[1]}s`] ?? MOTS[m[1]!]!) : m[2] === 'logs' ? `Journal · ${MOTS[m[1]!]}` : MOTS[m[1]!]!
  for (const [en, fr] of Object.entries(MOTS)) if (sans.endsWith(en)) return fr
  const humain = (titre ?? nom).replace(/[_-]+/g, ' ').trim()
  return humain.charAt(0).toUpperCase() + humain.slice(1)
}

// ── Point d'entrée ──────────────────────────────────────────────────────

/** Le tableau d'éléments d'une réponse : elle-même, ou sa première liste d'objets (« items », « deployments »…). */
function rowsOf(data: unknown): Obj[] | null {
  if (Array.isArray(data)) return data.filter(isObj)
  if (!isObj(data)) return null
  for (const v of Object.values(data)) if (Array.isArray(v) && v.length && isObj(v[0])) return v.filter(isObj)
  for (const v of Object.values(data)) if (Array.isArray(v) && v.length === 0) return []
  return null
}

/** Le panneau d'un résultat de connecteur. */
export function renderConnecteur(service: string, source: string, titre: string, text: string): UiConnecteur {
  const base = { kind: 'connecteur' as const, service, source, titre }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    const t = text.trim()
    return { ...base, disposition: 'texte', resume: [], cartes: [], total: 0, texte: t.length > MAX_TEXTE ? `${t.slice(0, MAX_TEXTE)}\n\n…` : t }
  }
  const rows = rowsOf(data)
  if (rows === null) {
    if (isObj(data)) {
      const c = carte(data)
      return { ...base, disposition: 'fiche', resume: [], cartes: [c], total: 1 }
    }
    return { ...base, disposition: 'texte', resume: [], cartes: [], total: 0, texte: String(data) }
  }
  const total = isObj(data) && typeof data.total_count === 'number' ? data.total_count : rows.length
  const cartes = rows.slice(0, MAX_CARTES).map(carte)
  return { ...base, disposition: disposition(cartes), resume: cartes.length ? resume(cartes, total) : [], cartes, total }
}
