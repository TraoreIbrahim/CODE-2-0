import type { UiTache, UiTacheResultat, UiTaches } from '@code/protocol'
import { dayLabel, describeRecurrence, timeLabel } from './rules.ts'
import type { Execution, Tache } from './tasks.ts'

/** Tâches planifiées : liste, résultat d'une exécution, et ce que Claude en lit. */

const at = (ms: number, now: number, tz: string) => `${dayLabel(ms, now, tz)} à ${timeLabel(ms, tz)}`

export function whenLabel(t: Tache, now: number, tz: string): string {
  if (t.recurrence) return describeRecurrence(t.recurrence)
  return t.echeance ? at(t.echeance, now, tz) : 'une seule fois'
}

export function toUiTache(t: Tache, last: Execution | null, running: boolean, now: number, tz: string): UiTache {
  const etat = t.etat === 'supprimee' ? 'terminee' : t.etat
  const prochaine = etat === 'active' ? t.echeance : null
  return {
    id: t.id,
    titre: t.titre,
    consigne: t.consigne,
    quand: whenLabel(t, now, tz),
    prochaine,
    prochaineLabel: prochaine ? `${dayLabel(prochaine, now, tz)} · ${timeLabel(prochaine, tz)}` : etat === 'pause' ? 'en pause' : 'terminée',
    etat,
    enCours: running,
    ...(last && last.statut !== 'en_cours' && last.fin
      ? { derniere: { id: last.id, fin: last.fin, quand: at(last.fin, now, tz), statut: last.statut, resume: last.resume } }
      : {})
  }
}

export function tachesView(taches: UiTache[], focus?: number): UiTaches {
  const active = taches.filter((t) => t.etat === 'active')
  const next = active.filter((t) => t.prochaine).sort((a, b) => a.prochaine! - b.prochaine!)[0]
  const sub = [`${active.length} TÂCHE${active.length > 1 ? 'S' : ''} ACTIVE${active.length > 1 ? 'S' : ''}`]
  if (next) sub.push(`PROCHAINE ${next.prochaineLabel.toUpperCase()}`)
  return { kind: 'taches', titre: 'Tâches planifiées', sousTitre: sub.join(' · '), taches, ...(focus ? { focus } : {}) }
}

export function resultView(t: Tache, e: Execution, history: Execution[], now: number, tz: string): UiTacheResultat {
  return {
    kind: 'tache',
    executionId: e.id,
    tacheId: t.id,
    titre: t.titre,
    quand: at(e.fin ?? e.debut, now, tz),
    statut: e.statut,
    resume: e.resume,
    texte: e.texte,
    retard: e.retard,
    precedentes: history.filter((h) => h.id !== e.id).map((h) => ({ id: h.id, quand: at(h.fin ?? h.debut, now, tz), statut: h.statut }))
  }
}

export function tachesForClaude(v: UiTaches): string {
  if (v.taches.length === 0) return 'Aucune tâche planifiée.'
  return v.taches
    .map(
      (t) =>
        `- [${t.id}] « ${t.titre} » : ${t.quand} — ${t.etat === 'active' ? `prochaine ${t.prochaineLabel}` : t.prochaineLabel}${t.enCours ? ' (en cours)' : ''}${
          t.derniere ? ` ; dernière exécution ${t.derniere.quand} (${t.derniere.statut === 'ok' ? 'réussie' : 'en échec'}, résultat ${t.derniere.id})` : ''
        }\n  Consigne : ${t.consigne.length > 240 ? `${t.consigne.slice(0, 240)}…` : t.consigne}`
    )
    .join('\n')
}

/** Markdown → texte d'une ligne (notification, liste). */
export function plainLine(md: string): string {
  return md
    .replace(/^#+\s*/, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Sépare la ligne de résumé (demandée en tête de chaque résultat) du contenu.
 * Sans ligne de résumé, le résumé reprend le début du contenu.
 */
export function splitResult(raw: string): { resume: string; texte: string } {
  const text = raw.trim()
  const m = /^(?:\*\*)?R[ée]sum[ée]\s*(?:\*\*)?\s*:\s*(.+)\n+/i.exec(text)
  if (m) return { resume: plainLine(m[1]!).slice(0, 200), texte: text.slice(m[0].length).trim() }
  const first = text.split('\n').map(plainLine).find((l) => l.length > 0) ?? ''
  return { resume: first.length > 160 ? `${first.slice(0, 157)}…` : first, texte: text }
}
