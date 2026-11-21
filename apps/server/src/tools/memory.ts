import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, memoryDir } from '../paths.ts'
import { ownerId } from '../users/users.ts'
import type { UiMemoire } from '@code/protocol'
import { checkStrings, type Tool } from './types.ts'

export const SUBJECTS = ['profil', 'projets', 'contacts', 'preferences', 'notes'] as const
export type Sujet = (typeof SUBJECTS)[number]

/**
 * Dossier des notes d'un utilisateur : `memory/` du dépôt pour le premier (ses notes d'avant le
 * multi-utilisateur y restent), un dossier à lui dans les données du serveur pour chacun des autres.
 */
export function memoryDirOf(uid: number): string {
  if (uid === ownerId()) return memoryDir
  const dir = join(dataDir, 'memoire', String(uid))
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

export function memoryFiles(uid: number): string[] {
  try {
    return readdirSync(memoryDirOf(uid)).filter((f) => f.endsWith('.md') && f !== 'LISEZMOI.md')
  } catch {
    return []
  }
}

/** Ajoute une note datée à une rubrique ; `false` si elle y figure déjà. */
export function addNote(uid: number, sujet: Sujet, fait: string): boolean {
  const fact = fait.replace(/\s+/g, ' ').trim().slice(0, 500)
  const file = join(memoryDirOf(uid), `${sujet}.md`)
  if (!fact || (existsSync(file) && readFileSync(file, 'utf8').toLowerCase().includes(fact.toLowerCase()))) return false
  appendFileSync(file, `- ${fact} (${new Date().toISOString().slice(0, 10)})\n`, { mode: 0o600 })
  return true
}

/**
 * Le lexique de sa voix (`lexique.md`, avec ses notes) : les mots que la transcription a mal entendus et
 * qu'il a corrigés, un par ligne. Ils passent en tête des mots-clés de la transcription (vocabulaire.ts),
 * et Claude les lit avec les notes : il sait qu'un « Lefèvre » transcrit est sans doute Lefebvre.
 */
const LEXIQUE = 'lexique.md'

/** Les mots du lexique, du plus récent au plus ancien. */
export function motsDuLexique(uid: number): string[] {
  try {
    const file = join(memoryDirOf(uid), LEXIQUE)
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.match(/^- (.+?)(?: \(entendu « .* »\))? \(\d{4}-\d{2}-\d{2}\)$/)?.[1]?.trim())
      .filter((m): m is string => !!m)
      .reverse()
  } catch {
    return []
  }
}

/** « Non, j'ai dit Lefebvre » : le mot juste entre dans le lexique de sa voix. */
export const learnWord: Tool = {
  name: 'voix_retenir_mot',
  description:
    "Apprend à la transcription un mot qu'elle a mal entendu : nom de personne, de lieu, sigle, mot du métier. À utiliser quand l'utilisateur corrige ce que tu as compris (« non, j'ai dit Lefebvre », « c'est Lou, L-O-U », « tu as mal entendu ») ou dit « apprends ce mot ». Le mot passe en tête du vocabulaire de sa voix pour les prochaines phrases. Pas pour une information à retenir sur lui : memoire_retenir.",
  risk: 'preparation',
  input_schema: {
    type: 'object',
    properties: {
      mot: { type: 'string', description: 'Le mot ou le nom bien écrit (« Lefebvre », « Croix-Rousse », « URSSAF »).' },
      entendu: { type: 'string', description: 'Ce que la transcription avait compris à la place, s’il est connu (« Lefèvre »).' }
    },
    required: ['mot'],
    additionalProperties: false
  },
  validate: (input) => checkStrings(input, ['mot']) ?? (String(input.mot).trim().length > 60 ? 'Un mot ou un nom court, pas une phrase.' : null),
  async run(input, ctx) {
    const mot = String(input.mot).replace(/\s+/g, ' ').trim()
    const entendu = typeof input.entendu === 'string' ? input.entendu.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
    if (motsDuLexique(ctx.user.id).some((m) => m.toLowerCase() === mot.toLowerCase())) return { content: 'Ce mot est déjà appris.', summary: `Lexique : ${mot}` }
    appendFileSync(join(memoryDirOf(ctx.user.id), LEXIQUE), `- ${mot}${entendu && entendu.toLowerCase() !== mot.toLowerCase() ? ` (entendu « ${entendu} »)` : ''} (${new Date().toISOString().slice(0, 10)})\n`, { mode: 0o600 })
    return { content: `Appris : « ${mot} » sera mieux reconnu dès la prochaine phrase.`, summary: `Lexique : ${mot}` }
  }
}

const RUBRIQUES: Record<Sujet, string> = { profil: 'Vous', projets: 'Projets', contacts: 'Personnes', preferences: 'Préférences', notes: 'Notes' }

const dateLisible = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** Les notes d'une rubrique : une par ligne « - fait (AAAA-MM-JJ) » ; la date est facultative. */
export function notesDe(uid: number, sujet: Sujet): { texte: string; date?: string }[] {
  try {
    const file = join(memoryDirOf(uid), `${sujet}.md`)
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => /^\s*[-*]\s+\S/.test(l))
      .map((l) => {
        const brut = l.replace(/^\s*[-*]\s+/, '').trim()
        const m = brut.match(/^(.*?)\s*\((\d{4}-\d{2}-\d{2})\)$/)
        return m ? { texte: m[1]!, date: dateLisible(m[2]!) } : { texte: brut }
      })
  } catch {
    return []
  }
}

/** Ce que l'assistant sait de la personne, pour l'écran. */
export function memoireView(uid: number, focus?: string): UiMemoire {
  const rubriques = SUBJECTS.map((id) => ({ id, nom: RUBRIQUES[id], notes: notesDe(uid, id) })).filter((r) => r.notes.length)
  const lexique = motsDuLexique(uid)
  const n = rubriques.reduce((t, r) => t + r.notes.length, 0)
  return {
    kind: 'memoire',
    titre: 'Ce que je sais de vous',
    sousTitre: n ? `${n} note${n > 1 ? 's' : ''}${lexique.length ? ` · ${lexique.length} mot${lexique.length > 1 ? 's' : ''} appris` : ''}` : 'Aucune note',
    rubriques,
    lexique,
    ...(focus ? { focus } : {})
  }
}

/** « Qu'est-ce que tu sais de moi ? » : les notes, à l'écran. */
export const memoireVoir: Tool = {
  name: 'memoire_voir',
  description:
    "Affiche à l'écran ce que tu sais de l'utilisateur : tes notes par rubrique et les mots appris. Pour « qu'est-ce que tu sais sur moi ? », « montre tes notes », « qu'as-tu retenu ? ». Tu connais déjà ces notes : résume-les en deux phrases, ne les relis pas.",
  risk: 'lecture',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  ui: { kind: 'memoire', title: () => 'Mémoire' },
  validate: () => null,
  async run(_input, ctx) {
    const view = memoireView(ctx.user.id)
    const n = view.rubriques.reduce((t, r) => t + r.notes.length, 0)
    return {
      content: n ? `${n} note(s) affichée(s) : ${view.rubriques.map((r) => `${r.nom} (${r.notes.length})`).join(', ')}${view.lexique.length ? ` ; ${view.lexique.length} mot(s) appris` : ''}.` : 'Aucune note pour l’instant : tu retiens ce qu’il te demande de retenir, et ce qu’il dit de durable sur lui.',
      summary: `Mémoire : ${n} note${n > 1 ? 's' : ''}`,
      view
    }
  }
}

/** « Retiens que… » : ajoute une note durable, lue à chaque conversation. */
export const remember: Tool = {
  name: 'memoire_retenir',
  description:
    "Retient durablement une information sur l'utilisateur, ses projets, ses contacts ou ses préférences. À utiliser quand il dit « retiens que… », « n'oublie pas que… », ou partage un fait stable utile plus tard. Une phrase claire et autonome par note.",
  risk: 'preparation',
  input_schema: {
    type: 'object',
    properties: {
      fait: { type: 'string', description: 'La note, formulée comme un fait autonome (« M. Bernard est le plombier, à Vaise »).' },
      sujet: { type: 'string', enum: [...SUBJECTS], description: 'Rubrique de la note.' }
    },
    required: ['fait', 'sujet'],
    additionalProperties: false
  },
  ui: { kind: 'memoire', title: () => 'Mémoire' },
  validate: (input) => checkStrings(input, ['fait', 'sujet']) ?? (SUBJECTS.includes(input.sujet as never) ? null : 'Sujet inconnu.'),
  async run(input, ctx) {
    const fact = String(input.fait).replace(/\s+/g, ' ').trim().slice(0, 500)
    const added = addNote(ctx.user.id, input.sujet as Sujet, fact)
    return { content: added ? `Retenu dans « ${input.sujet} ».` : 'Déjà en mémoire.', summary: `Mémoire : ${fact}`, view: memoireView(ctx.user.id, fact) }
  }
}

/** « Oublie que… » : supprimer une note est une modification, donc soumise à validation. */
export const forget: Tool = {
  name: 'memoire_oublier',
  description:
    "Supprime de la mémoire les notes contenant un passage donné. Action sensible : l'utilisateur devra valider. Utilise d'abord les notes déjà connues pour citer le passage exact.",
  risk: 'sensible',
  input_schema: {
    type: 'object',
    properties: { passage: { type: 'string', description: 'Un extrait exact de la note à oublier.' } },
    required: ['passage'],
    additionalProperties: false
  },
  validate: (input) => checkStrings(input, ['passage']),
  async run(input, ctx) {
    const needle = String(input.passage).trim().toLowerCase()
    const dir = memoryDirOf(ctx.user.id)
    const matches = memoryFiles(ctx.user.id).flatMap((f) =>
      readFileSync(join(dir, f), 'utf8')
        .split('\n')
        .filter((l) => l.toLowerCase().includes(needle))
        .map((line) => ({ file: f, line }))
    )
    if (matches.length === 0) return { content: 'Aucune note ne contient ce passage.', isError: true, summary: 'Mémoire : rien à oublier' }

    const preview = matches.map((m) => m.line.replace(/^- /, '')).join(' · ')
    ctx.requestConfirmation('Oublier une note', preview, async () => {
      for (const f of new Set(matches.map((m) => m.file))) {
        const path = join(dir, f)
        const kept = readFileSync(path, 'utf8').split('\n').filter((l) => !l.toLowerCase().includes(needle))
        writeFileSync(path, kept.join('\n'), { mode: 0o600 })
      }
      ctx.log(`Mémoire : ${matches.length} note(s) oubliée(s)`)
      ctx.announce('C’est oublié.')
    })
    return {
      content: `En attente de validation : ${matches.length} note(s) à oublier. Une carte est affichée. Dis-le en une phrase et demande son accord ; ne prétends pas que c'est fait.`,
      summary: `Mémoire : oubli demandé (${matches.length})`
    }
  }
}
