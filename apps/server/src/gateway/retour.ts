import type { ConfirmRequest, PersoResume, UiRappel } from '@code/protocol'
import type { Execution, Tache } from '../scheduler/tasks.ts'

/**
 * Le point du retour : quand l'utilisateur revient après une longue absence (ordinateur
 * réveillé, téléphone rouvert), l'assistant lui résume ce qui le concerne
 * personnellement depuis son départ. Les faits sont rassemblés ici, sans
 * outil, pour que le résumé arrive vite.
 */

/** « 2 h 10 », « 1 h », « 45 min », « 3 jours ». */
export function absenceText(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h >= 48) return `${Math.floor(h / 24)} jours`
  const m = min % 60
  return m >= 5 ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

export type RetourFacts = {
  /** Début de l'absence (« 13:05 », « hier 18:40 »). */
  depuis: string
  absence: string
  rappels: UiRappel[]
  taches: { execution: Execution; tache: Tache | null }[]
  enAttente: ConfirmRequest | null
  perso: PersoResume | null
  /** Minutes depuis minuit, pour les rendez-vous qui restent. */
  maintenant: number
}

/** Les faits, en lignes courtes : ce que Claude résume, sans rien inventer. */
export function retourLines(f: RetourFacts): string[] {
  const out: string[] = []
  const sonnes = f.rappels.filter((r) => r.etat === 'sonne')
  const prochains = f.rappels.filter((r) => r.etat === 'a_venir' && r.jour === 'aujourd’hui').slice(0, 4)
  out.push(sonnes.length ? `Rappels qui ont sonné et attendent « fait » : ${sonnes.map((r) => `${r.texte} (${r.heure}${r.retard ? ', en retard' : ''})`).join(' ; ')}.` : 'Aucun rappel en attente.')
  if (prochains.length) out.push(`Prochains rappels aujourd’hui : ${prochains.map((r) => `${r.heure} ${r.texte}`).join(' ; ')}.`)
  if (f.taches.length) {
    out.push(
      `Tâches planifiées exécutées pendant l’absence : ${f.taches
        .map(({ execution: e, tache: t }) => `« ${t?.titre ?? 'tâche supprimée'} » ${e.statut === 'ok' ? `terminée : ${e.resume}` : `en échec : ${e.resume}`}`)
        .join(' ; ')}.`
    )
  } else out.push('Aucune tâche planifiée n’a tourné pendant l’absence.')
  if (f.enAttente) out.push(`En attente de son accord : ${f.enAttente.title} — ${f.enAttente.summary}.`)
  if (!f.perso || (f.perso.mails === null && f.perso.agenda === null)) {
    out.push(`Mails et agenda : non disponibles${f.perso?.erreur ? ` (${f.perso.erreur})` : ' (Google non connecté)'}.`)
  } else {
    const mails = f.perso.mails ?? []
    const unread = mails.filter((m) => m.nonLu)
    if (f.perso.mails === null) out.push('Mails : non disponibles.')
    else out.push(unread.length ? `Mails importants non lus : ${unread.map((m) => `${m.de} — « ${m.objet} » (${m.quand})`).join(' ; ')}.` : 'Aucun mail important non lu.')
    const rest = (f.perso.agenda ?? []).filter((e) => !e.journee && e.a > f.maintenant)
    if (f.perso.agenda === null) out.push('Agenda : non disponible.')
    else out.push(rest.length ? `Rendez-vous restants aujourd’hui : ${rest.map((e) => `${e.debut} ${e.titre}${e.lieu ? ` (${e.lieu})` : ''}`).join(' ; ')}.` : 'Plus aucun rendez-vous aujourd’hui.')
  }
  return out
}

/** Les panneaux que le point peut montrer : l'outil de chacun, et ce dont il parle. */
export const PANNEAUX_RETOUR = { rappels: 'rappels_lister', taches: 'taches_lister', mails: 'mails', agenda: 'agenda_evenements' } as const
export type PanneauRetour = keyof typeof PANNEAUX_RETOUR

/** Ceux qui ont quelque chose à montrer : pas de panneau vide pendant qu'il dit « rien de neuf ». */
export function panneauxRetour(f: RetourFacts): PanneauRetour[] {
  const out: PanneauRetour[] = []
  if (f.rappels.some((r) => r.etat === 'sonne' || (r.etat === 'a_venir' && r.jour === 'aujourd’hui'))) out.push('rappels')
  if (f.taches.length) out.push('taches')
  if (f.perso?.mails?.some((m) => m.nonLu)) out.push('mails')
  if (f.perso?.agenda?.some((e) => !e.journee && e.a > f.maintenant)) out.push('agenda')
  return out
}

/**
 * La consigne du tour : un message automatique, comme le briefing du matin. `panneaux` : ceux que le serveur a
 * déjà préparés (nom de la marque → sujet) ; l'assistant les fait apparaître en plaçant leur marque.
 */
export function retourPrompt(f: RetourFacts, name: string, panneaux: { marque: string; sujet: string }[] = []): string {
  return [
    `[Retour de ${name} après ${f.absence} d’absence (depuis ${f.depuis}) : message automatique de ton application, ce n’est pas lui qui parle.]`,
    'Voici ce qui le concerne personnellement depuis son départ :',
    ...retourLines(f).map((l) => `- ${l}`),
    `Fais-lui le point en quelques phrases naturelles : d’abord ce qui demande une action (rappel qui sonne, accord attendu, échec d’une tâche), puis les mails importants et le prochain rendez-vous. S’il ne s’est rien passé, dis-le en une phrase. N’appelle aucun outil pour ce point : tout est ci-dessus.${panneaux.length ? ` Des panneaux sont déjà prêts à l’écran, cachés : ${panneaux.map((p) => `${p.sujet} → [[voir:${p.marque}]]`).join(' ; ')}. Place chaque marque devant la phrase qui parle de son sujet, pour que le panneau apparaisse à ce moment-là ; aucune marque pour le reste.` : ''} Commence par un mot d’accueil bref (« Re-bonjour », « Bon retour »), sans répéter la durée exacte s’il n’y a rien à en dire. Termine en lui demandant s’il veut le détail de quelque chose.`
  ].join('\n')
}
