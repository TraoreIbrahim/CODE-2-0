import type { PersoResume } from '@code/protocol'
import { eventsOfDay, localDay } from '../google/calendar.ts'
import { googleStatus } from '../google/oauth.ts'
import { runAsUser } from '../users/scope.ts'
import { contactsSearch } from './contacts.ts'
import { agendaEvents, agendaFree, agendaTools, listEvents } from './agenda.ts'
import { driveRead, driveSearch, driveTools } from './drive.ts'
import { IMPORTANT_QUERY, gmailImportants, gmailRead, gmailSearch, gmailTools, threadPage } from './gmail.ts'
import { reminderList } from './rappels.ts'
import { taskList, taskResult } from './taches.ts'
import { echeancesList } from './echeances.ts'
import { documentRead, documentsFind } from './documents.ts'
import { listesShow } from './listes.ts'
import { reunionLire, reunionsLister } from './reunions.ts'
import { competenceLire, competencesLister } from './competences.ts'
import { memoireVoir } from './memory.ts'
import type { Tool } from './types.ts'
import { weather } from './meteo.ts'
import { importantRows, mailRead, mailSearch, mailsImportants, mixRows } from './mail.ts'
import { listBoites } from '../mail/boites.ts'

/** Outils Gmail, Agenda et Drive, proposés à Claude. */
export const persoTools: Tool[] = [...gmailTools, ...agendaTools, ...driveTools, contactsSearch]

/** Lectures que l'interface peut lancer elle-même (page, ouverture d'un fil ou d'un fichier Drive, rappels, tâches, échéances, papiers, listes), sans passer par Claude. */
const FROM_INTERFACE = [weather, mailsImportants, mailRead, mailSearch, gmailImportants, gmailSearch, gmailRead, agendaEvents, agendaFree, driveSearch, driveRead, reminderList, taskList, taskResult, echeancesList, documentRead, documentsFind, listesShow, reunionsLister, reunionLire, competencesLister, competenceLire, memoireVoir]

export function persoPageable(name: string): Tool | null {
  return FROM_INTERFACE.find((t) => t.name === name) ?? null
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Rendez-vous du jour et mails importants de l'utilisateur, pour les panneaux du cockpit. */
export function persoResume(uid: number, tz: string, now = Date.now()): Promise<PersoResume> {
  return runAsUser(uid, () => resumeGoogle(uid, tz, now))
}

async function resumeGoogle(uid: number, tz: string, now: number): Promise<PersoResume> {
  const status = googleStatus(uid, now)
  const boites = listBoites(uid).length > 0
  // Sans Google mais avec des boîtes IMAP : les mails seulement.
  if (status.etat !== 'connecte' && !boites) return { at: now, agenda: null, mails: null, erreur: status.message }
  const today = localDay(now, tz)
  const errors: string[] = []
  const [agenda, mails] = await Promise.all([
    status.etat === 'connecte' && status.agenda
      ? listEvents(today, 1).then(
          (evs) => eventsOfDay(evs, today, now, tz),
          (err) => (errors.push(reason(err)), null)
        )
      : null,
    // Gmail et les boîtes IMAP, mêlés par date (chaque ligne porte sa boîte s'il y en a plusieurs).
    boites
      ? importantRows(uid, { perBox: 6 }, now).then(
          (r) => (r.erreurs.length && errors.push(r.erreurs[0]!), mixRows(r.rows, 8, 3)),
          (err) => (errors.push(reason(err)), null)
        )
      : status.gmail
        ? threadPage(IMPORTANT_QUERY, 1, 6).then(
            (p) => p.rows,
            (err) => (errors.push(reason(err)), null)
          )
        : null
  ])
  return { at: now, agenda, mails, ...(errors.length ? { erreur: errors[0] } : {}) }
}
