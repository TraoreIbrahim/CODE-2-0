import { FOURNISSEURS, type FournisseurId, type UsageKind, type UsagePeriode, type UsageResume, type UsageTotals } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import { db, userIndex } from '../db.ts'
import { localDay, zonedTime } from '../google/calendar.ts'
import { prixCatalogue, type Prix } from './moteurs/tarifs.ts'

/**
 * Compteur de tokens : chaque appel à Claude garde l'`usage` renvoyé par l'API (entrée, sortie,
 * lecture et écriture du cache), le modèle qui a réellement répondu, l'utilisateur et l'usage
 * (conversation, tâche, briefing, retour, veille). Le coût est calculé ici, avec les tarifs de la
 * configuration, au moment de l'appel (un changement de tarif ne réécrit pas le passé).
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS usage_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    ts INTEGER NOT NULL,
    usage TEXT NOT NULL CHECK (usage IN ('conversation', 'tache', 'briefing', 'retour', 'veille')),
    modele TEXT NOT NULL,
    entree INTEGER NOT NULL,
    sortie INTEGER NOT NULL,
    cache_lecture INTEGER NOT NULL,
    cache_ecriture INTEGER NOT NULL,
    cout REAL NOT NULL
  );
`)
userIndex('usage_tokens', 'ts')

/** Ce que l'API renvoie dans `usage` (champs utiles au compteur). */
export type ApiUsage = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  /** Recherches web faites côté serveur pendant l'appel (facturées à l'unité). */
  server_tool_use?: { web_search_requests?: number | null; web_fetch_requests?: number | null } | null
  /** Coût exact donné par le fournisseur (OpenRouter), qui prime sur le tarif. */
  cout?: number | null
}

/**
 * Le modèle tel que le compteur le garde : nu pour Claude (« claude-haiku-5-5 »), précédé de son
 * fournisseur pour les autres (« openai:gpt-5.5 », « ollama:qwen3:8b »).
 */
export const modeleCompte = (fournisseur: FournisseurId, modele: string) => (fournisseur === 'anthropic' ? modele : `${fournisseur}:${modele}`)

function fournisseurDe(model: string): { fournisseur: FournisseurId; modele: string } {
  const i = model.indexOf(':')
  const f = model.slice(0, i) as FournisseurId
  return i > 0 && FOURNISSEURS.includes(f) ? { fournisseur: f, modele: model.slice(i + 1) } : { fournisseur: 'anthropic', modele: model }
}

const GRATUIT: Prix = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/**
 * Tarif d'un modèle : la configuration, puis le catalogue public (autres fournisseurs) ; Ollama est gratuit.
 * Un modèle inconnu (repli imprévu, catalogue indisponible) est compté au tarif du modèle puissant, par prudence.
 */
export function priceOf(model: string): Prix {
  const prices = codeConfig.brain.prices
  const { fournisseur, modele } = fournisseurDe(model)
  if (fournisseur === 'ollama') return GRATUIT
  if (fournisseur === 'anthropic') {
    const p = prices[modele] ?? prices[Object.keys(prices).find((k) => modele.startsWith(k)) ?? '']
    if (p) return p
  }
  return prices[model] ?? prixCatalogue(fournisseur, modele) ?? prices[codeConfig.brain.deep]!
}

/** Coût en dollars d'un appel. */
export function costOf(model: string, u: ApiUsage): number {
  if (typeof u.cout === 'number' && Number.isFinite(u.cout)) return u.cout
  const p = priceOf(model)
  const tokens = ((u.input_tokens ?? 0) * p.input + (u.output_tokens ?? 0) * p.output + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) / 1_000_000
  return tokens + (u.server_tool_use?.web_search_requests ?? 0) * codeConfig.brain.web.searchPrice
}

const q = {
  insert: db.prepare('INSERT INTO usage_tokens (utilisateur_id, ts, usage, modele, entree, sortie, cache_lecture, cache_ecriture, cout) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  since: db.prepare(
    `SELECT usage, SUM(cout) AS cout, SUM(entree) AS entree, SUM(sortie) AS sortie, SUM(cache_lecture) AS cacheLecture, SUM(cache_ecriture) AS cacheEcriture, COUNT(*) AS appels
     FROM usage_tokens WHERE utilisateur_id = ? AND ts >= ? GROUP BY usage`
  ),
  // Vue d'ensemble du premier utilisateur : chaque personne, chacune filtrée par son identifiant.
  person: db.prepare('SELECT COALESCE(SUM(cout), 0) AS cout FROM usage_tokens WHERE utilisateur_id = ? AND ts >= ?')
}

const listeners = new Set<(uid: number) => void>()
/** Un appel vient d'être compté pour cet utilisateur. */
export function onUsage(fn: (uid: number) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function recordUsage(uid: number, kind: UsageKind, model: string, u: ApiUsage, now = Date.now()): number {
  const cout = costOf(model, u)
  q.insert.run(uid, now, kind, model, u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0, cout)
  for (const fn of listeners) fn(uid)
  return cout
}

const empty = (): UsageTotals => ({ cout: 0, entree: 0, sortie: 0, cacheLecture: 0, cacheEcriture: 0, appels: 0 })

function periode(uid: number, since: number): UsagePeriode {
  const total = empty()
  const parUsage: UsagePeriode['parUsage'] = {}
  for (const r of q.since.all(uid, since) as (UsageTotals & { usage: UsageKind })[]) {
    const { usage, ...t } = r
    parUsage[usage] = t
    for (const k of Object.keys(total) as (keyof UsageTotals)[]) total[k] += t[k]
  }
  return { total, parUsage }
}

/** Début du jour et du mois, à l'heure de l'utilisateur. */
export function periodStarts(now: number, tz: string): { jour: number; mois: number } {
  const day = localDay(now, tz)
  return { jour: zonedTime(day, 0, tz).getTime(), mois: zonedTime(`${day.slice(0, 8)}01`, 0, tz).getTime() }
}

/**
 * Coût du jour et du mois de l'utilisateur, par usage. `people` (premier utilisateur seulement) :
 * la même chose pour chaque personne, en total.
 */
export function usageResume(uid: number, tz: string, people: { id: number; nom: string }[] | null = null, now = Date.now()): UsageResume {
  const { jour, mois } = periodStarts(now, tz)
  return {
    at: now,
    jour: periode(uid, jour),
    mois: periode(uid, mois),
    ...(people
      ? {
          parPersonne: people.map((p) => ({
            utilisateurId: p.id,
            nom: p.nom,
            jour: (q.person.get(p.id, jour) as { cout: number }).cout,
            mois: (q.person.get(p.id, mois) as { cout: number }).cout
          }))
        }
      : {})
  }
}

/** Dépense du jour de l'utilisateur (dollars), à son heure. */
export function costToday(uid: number, tz: string, now = Date.now()): number {
  return periode(uid, periodStarts(now, tz).jour).total.cout
}

/**
 * Plafond par jour : au-delà, tout passe sur le modèle rapide jusqu'à minuit. `alerte` : le seuil franchi
 * par ce dernier appel (80 % puis 100 %), une seule fois par jour et par seuil.
 */
export type Budget = { plafond: number | null; depense: number; depasse: boolean }

export function budgetOf(uid: number, tz: string, plafond: number | null, now = Date.now()): Budget {
  const depense = costToday(uid, tz, now)
  return { plafond, depense, depasse: plafond !== null && depense >= plafond }
}

const announced = new Map<number, string>()

/** Le seuil (80 ou 100 %) que la dépense vient de franchir aujourd'hui, s'il n'a pas encore été annoncé. */
export function budgetThreshold(uid: number, tz: string, plafond: number | null, now = Date.now()): { seuil: 80 | 100; depense: number } | null {
  if (plafond === null) return null
  const depense = costToday(uid, tz, now)
  const seuil = depense >= plafond ? 100 : depense >= plafond * 0.8 ? 80 : null
  if (!seuil) return null
  const key = `${localDay(now, tz)}:${seuil}`
  const last = announced.get(uid)
  // 100 % annoncé : 80 % ne revient pas le même jour.
  if (last === key || (seuil === 80 && last === `${localDay(now, tz)}:100`)) return null
  announced.set(uid, key)
  return { seuil, depense }
}
