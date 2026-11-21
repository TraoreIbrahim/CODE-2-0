import type { BancResultat, BancScenario, ChoixMoteur } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import { db } from '../db.ts'
import { forget, learnWord, remember } from '../tools/memory.ts'
import { reminderTools } from '../tools/rappels.ts'
import { taskTools } from '../tools/taches.ts'
import { weather } from '../tools/meteo.ts'
import { showWebResults } from '../tools/web.ts'
import { sourceWeb } from '../tools/web-libre.ts'
import type { Tool, ToolContext } from '../tools/types.ts'
import type { Utilisateur } from '../users/users.ts'
import type { Brain, BrainEvent } from './brain.ts'
import { costOf } from './usage.ts'

/**
 * Banc d'essai : les mêmes demandes vocales posées à un moteur, avec des outils simulés (vraie validation des
 * entrées, aucun effet : rien n'est créé ni retenu). Le verdict s'affiche dans Réglages › Moteurs.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS bancs (
    fournisseur TEXT NOT NULL,
    modele TEXT NOT NULL,
    resultat TEXT NOT NULL,
    PRIMARY KEY (fournisseur, modele)
  )
`)

const q = {
  tous: db.prepare('SELECT resultat FROM bancs ORDER BY rowid'),
  garder: db.prepare('INSERT INTO bancs (fournisseur, modele, resultat) VALUES (?, ?, ?) ON CONFLICT (fournisseur, modele) DO UPDATE SET resultat = excluded.resultat')
}

/** Les derniers bancs de l'installation, un par moteur (le modèle se comporte pareil pour tout le monde). */
export function listBancs(): BancResultat[] {
  return (q.tous.all() as { resultat: string }[]).map((r) => JSON.parse(r.resultat) as BancResultat)
}

/** Les appels d'outils d'une réponse : nom et réussite, dans l'ordre. */
type Trace = { texte: string; outils: { name: string; failed: boolean }[] }

type Scenario = {
  id: string
  nom: string
  question: (user: Utilisateur) => string
  /** null : réussi ; sinon ce qui manque. */
  verifier: (t: Trace) => string | null
  /** Le scénario ne s'applique pas à ce moteur (pas de recherche web disponible). */
  ignorer?: (web: boolean) => string | null
}

const appele = (t: Trace, nom: string | RegExp) => t.outils.some((o) => (typeof nom === 'string' ? o.name === nom : nom.test(o.name)) && !o.failed)
const attendu = (t: Trace, nom: string) => (appele(t, nom) ? null : t.outils.some((o) => o.name === nom) ? `${nom} appelé avec une entrée refusée` : `${nom} pas appelé`)

export const SCENARIOS: Scenario[] = [
  {
    id: 'presentation',
    nom: 'Présentation',
    question: () => 'Présente-toi en une phrase.',
    verifier: (t) => (t.texte.trim().length < 10 ? 'réponse vide' : /[#*`]|https?:/.test(t.texte) ? 'mise en forme écrite dans une réponse parlée' : null)
  },
  {
    id: 'rappel',
    nom: 'Rappel',
    question: () => 'Rappelle-moi dans deux heures d’appeler le garage.',
    verifier: (t) => attendu(t, 'rappel_creer')
  },
  {
    id: 'meteo',
    nom: 'Météo',
    question: (u) => `Quel temps fera-t-il demain à ${u.reglages.ville} ?`,
    verifier: (t) => attendu(t, 'meteo')
  },
  {
    id: 'memoire',
    nom: 'Mémoire',
    question: () => 'Retiens que je préfère les réunions le matin.',
    verifier: (t) => attendu(t, 'memoire_retenir')
  },
  {
    id: 'enchainement',
    nom: 'Enchaînement',
    question: () => 'Rappelle-moi demain à neuf heures d’envoyer le devis, puis dis-moi quels rappels j’ai.',
    verifier: (t) => attendu(t, 'rappel_creer') ?? attendu(t, 'rappels_lister')
  },
  {
    id: 'recherche_outils',
    nom: 'Recherche d’outils',
    question: () => 'Tous les vendredis à dix-sept heures, fais-moi le bilan de la semaine.',
    verifier: (t) => attendu(t, 'tache_creer')
  },
  {
    id: 'web',
    nom: 'Web',
    question: () => 'Cherche sur le web la date de la prochaine éclipse solaire visible en France.',
    verifier: (t) => (appele(t, /^(web_search|web_rechercher)$/) ? null : 'aucune recherche web'),
    ignorer: (web) => (web ? null : 'aucune recherche web sur ce serveur (clé Brave ou SearXNG)')
  }
]

/** Réponses simulées : assez vraies pour que le modèle continue, sans rien toucher. */
const REPONSES: Record<string, string> = {
  rappels_lister: JSON.stringify([{ id: 1, texte: 'envoyer le devis', echeance: 'demain 09:00' }]),
  taches_lister: '[]',
  meteo: JSON.stringify({ lieu: 'demandé', demain: { ciel: 'éclaircies', min: 9, max: 17, pluie: '10 %' } })
}

/** La version simulée d'un outil : même nom, description, schéma et validation ; l'exécution ne fait rien. */
export function simule(t: Tool): Tool {
  return {
    ...t,
    async run() {
      return { content: REPONSES[t.name] ?? 'Fait.', summary: `${t.name} (essai)` }
    }
  }
}

export function outilsSimules(): Tool[] {
  const web = codeConfig.brain.web.enabled ? [showWebResults] : []
  return [remember, forget, learnWord, ...reminderTools, ...taskTools, weather, ...web].map(simule)
}

/** Le verdict d'après les scénarios : tous réussis, au moins la moitié, ou moins. */
export function verdict(scenarios: BancScenario[]): BancResultat['etat'] {
  const comptes = scenarios.filter((s) => !s.ignore)
  const ok = comptes.filter((s) => s.ok).length
  return comptes.length && ok === comptes.length ? 'teste' : ok * 2 >= comptes.length && ok > 0 ? 'limite' : 'echec'
}

/**
 * Pose chaque scénario au moteur choisi, l'un après l'autre (chacun borné à `bancDelaiMs`). `progres` reçoit le
 * résultat à chaque étape (état « en_cours »), puis le résultat final, gardé pour l'installation.
 */
export async function lancerBanc(brain: Brain, user: Utilisateur, choix: ChoixMoteur, progres: (r: BancResultat) => void, signal?: AbortSignal): Promise<BancResultat> {
  const moteur = brain.moteur(choix.fournisseur)
  const web = codeConfig.brain.web.enabled && (moteur.webNatif || sourceWeb(brain.cleBrave) !== null)
  const outils = outilsSimules()
  const r: BancResultat = { ...choix, etat: 'en_cours', scenarios: [], cout: 0, le: Date.now() }
  const ctx: ToolContext = { user, fichiers: false, requestConfirmation() {}, announce() {}, log() {} }
  for (const s of SCENARIOS) {
    if (signal?.aborted) break
    const raison = s.ignorer?.(web)
    if (raison) {
      r.scenarios.push({ id: s.id, nom: s.nom, ok: false, ignore: true, detail: raison, ms: 0 })
      continue
    }
    const debut = Date.now()
    const trace: Trace = { texte: '', outils: [] }
    const arret = AbortSignal.any([AbortSignal.timeout(codeConfig.brain.bancDelaiMs), ...(signal ? [signal] : [])])
    let detail: string | null
    try {
      const evts: AsyncGenerator<BrainEvent> = brain.reply([], s.question(user), arret, ctx, {
        moteur: choix,
        outils,
        surUsage: (m, u) => {
          r.cout += costOf(m, u)
        }
      })
      for await (const e of evts) {
        if (e.type === 'text') trace.texte += e.text
        else if (e.type === 'tool') trace.outils.push({ name: e.name, failed: e.failed })
      }
      detail = s.verifier(trace)
    } catch (err) {
      detail = arret.aborted && !signal?.aborted ? 'trop long' : err instanceof Error ? err.message.slice(0, 160) : String(err)
    }
    r.scenarios.push({ id: s.id, nom: s.nom, ok: detail === null, ...(detail ? { detail } : {}), ms: Date.now() - debut })
    progres({ ...r, scenarios: [...r.scenarios] })
  }
  const fin: BancResultat = { ...r, etat: verdict(r.scenarios), le: Date.now() }
  if (!signal?.aborted) q.garder.run(fin.fournisseur, fin.modele, JSON.stringify(fin))
  return fin
}
