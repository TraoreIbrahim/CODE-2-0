import type { UiContact } from '@code/protocol'
import { initiales } from './gmail.ts'

/** Une personne telle que la renvoie l'API People (champs demandés dans `CHAMPS`). */
export type Personne = {
  resourceName?: string
  names?: { displayName?: string }[]
  emailAddresses?: { value?: string }[]
  phoneNumbers?: { value?: string; formattedType?: string }[]
  organizations?: { name?: string; title?: string }[]
  addresses?: { formattedValue?: string }[]
  birthdays?: { date?: { day?: number; month?: number; year?: number } }[]
}

/** Ce qu'on lit d'un contact du carnet ; les « autres contacts » n'ont que les trois premiers. */
export const CHAMPS = 'names,emailAddresses,phoneNumbers,organizations,addresses,birthdays'
export const CHAMPS_AUTRES = 'names,emailAddresses,phoneNumbers'

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** Un contact de l'API People, prêt pour l'écran ; null s'il n'a ni nom ni adresse ni numéro. */
export function contactDe(p: Personne, echange = false): UiContact | null {
  const emails = [...new Set((p.emailAddresses ?? []).map((e) => e.value?.trim().toLowerCase()).filter((e): e is string => !!e))]
  const telephones = (p.phoneNumbers ?? []).filter((t) => t.value?.trim()).map((t) => ({ numero: t.value!.trim(), ...(t.formattedType ? { type: t.formattedType } : {}) }))
  const nom = p.names?.[0]?.displayName?.trim() || emails[0] || telephones[0]?.numero
  if (!nom) return null
  const org = p.organizations?.[0]
  const naissance = p.birthdays?.find((b) => b.date?.day && b.date?.month)?.date
  return {
    nom,
    initiales: initiales(nom),
    ...(org?.name?.trim() ? { organisation: org.name.trim() } : {}),
    ...(org?.title?.trim() ? { fonction: org.title.trim() } : {}),
    emails,
    telephones,
    ...(p.addresses?.[0]?.formattedValue?.trim() ? { adresse: p.addresses[0].formattedValue.trim().replace(/\n+/g, ', ') } : {}),
    ...(naissance ? { anniversaire: `${naissance.day} ${MOIS[naissance.month! - 1]}` } : {}),
    ...(echange ? { echange: true } : {})
  }
}

/** Carnet d'abord, puis les échanges ; une même adresse n'apparaît qu'une fois. */
export function fusionner(carnet: UiContact[], echanges: UiContact[]): UiContact[] {
  const vues = new Set(carnet.flatMap((c) => c.emails))
  return [...carnet, ...echanges.filter((c) => !c.emails.some((e) => vues.has(e)))]
}

/** Pour Claude : une ligne par personne, ses coordonnées complètes. */
export function contactsPourClaude(liste: UiContact[]): string {
  return liste
    .map((c) => {
      const qui = [c.nom, c.fonction, c.organisation].filter(Boolean).join(' · ')
      const tels = c.telephones.map((t) => `${t.numero}${t.type ? ` (${t.type})` : ''}`).join(', ')
      return `- ${qui}${c.echange ? ' [hors carnet : échanges de mails]' : ''}${c.emails.length ? ` · ${c.emails.join(', ')}` : ''}${tels ? ` · tél. ${tels}` : ''}${c.adresse ? ` · ${c.adresse}` : ''}${c.anniversaire ? ` · anniversaire le ${c.anniversaire}` : ''}`
    })
    .join('\n')
}
