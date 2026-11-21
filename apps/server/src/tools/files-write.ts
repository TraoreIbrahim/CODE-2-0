import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { allowedRoots, confine, confineDir, deniedMessage, display, safeName, uniquePath } from './fs-safety.ts'
import { checkStrings, type Tool, type ToolResult } from './types.ts'

/**
 * Outils qui modifient les fichiers. Tous sont sensibles (docs/SPEC.md, 6.1) : ils préparent l'action,
 * l'affichent sur une carte, et ne l'exécutent qu'après un « oui ».
 */

const MAX_ITEMS = 50

function waiting(what: string): ToolResult['content'] {
  return `En attente de validation : ${what}. Une carte est affichée. Dis-le en une phrase et demande son accord ; ne prétends pas que c'est fait.`
}

/** Déplace en gérant les disques différents (rename échoue entre volumes). */
function move(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    cpSync(from, to, { recursive: true, preserveTimestamps: true })
    rmSync(from, { recursive: true, force: true })
  }
}

function list(paths: string[]): string {
  const names = paths.map((p) => basename(p))
  return names.length <= 4 ? names.join(', ') : `${names.slice(0, 3).join(', ')} et ${names.length - 3} autres`
}

/** Résout une liste de chemins ; renvoie les refusés à part. */
function resolveAll(raw: unknown): { ok: string[]; refused: string[] } {
  const items = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, MAX_ITEMS) : []
  const ok: string[] = []
  const refused: string[] = []
  for (const item of items) {
    const p = confine(item)
    // On ne touche jamais aux dossiers autorisés eux-mêmes.
    if (!p || allowedRoots().includes(p)) refused.push(item)
    else ok.push(p)
  }
  return { ok: [...new Set(ok)], refused }
}

function checkList(input: Record<string, unknown>, key: string): string | null {
  const v = input[key]
  if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string' && x.trim())) return `Champ « ${key} » : liste de chemins attendue.`
  return null
}

export const createFolder: Tool = {
  name: 'fichiers_creer_dossier',
  description: 'Crée un nouveau dossier dans un dossier autorisé. Demande la validation de l’utilisateur.',
  risk: 'sensible',
  input_schema: {
    type: 'object',
    properties: { dans: { type: 'string', description: 'Dossier parent.' }, nom: { type: 'string', description: 'Nom du nouveau dossier.' } },
    required: ['dans', 'nom'],
    additionalProperties: false
  },
  validate: (input) => checkStrings(input, ['dans', 'nom']),
  async run(input, ctx) {
    const parent = confineDir(String(input.dans))
    const name = safeName(String(input.nom))
    if (!parent || !name) return { content: parent ? 'Nom de dossier invalide.' : deniedMessage(), isError: true, summary: 'Création de dossier refusée' }
    const target = uniquePath(join(parent, name))
    ctx.requestConfirmation('Créer un dossier', display(target), async () => {
      mkdirSync(target)
      ctx.log(`Dossier créé : ${display(target)}`)
      ctx.announce('C’est fait, le dossier est créé.')
    })
    return { content: waiting(`créer ${display(target)}`), summary: `Création demandée : ${display(target)}` }
  }
}

export const writeFile: Tool = {
  name: 'fichiers_ecrire',
  description:
    "Crée un nouveau document texte (note, liste, compte rendu) en .txt, .md ou .csv dans un dossier autorisé. N'écrase jamais un fichier existant. Demande la validation de l'utilisateur.",
  risk: 'sensible',
  input_schema: {
    type: 'object',
    properties: {
      dans: { type: 'string', description: 'Dossier où créer le document.' },
      nom: { type: 'string', description: 'Nom du fichier, extension comprise (« compte-rendu Bernard.md »).' },
      contenu: { type: 'string', description: 'Texte du document.' }
    },
    required: ['dans', 'nom', 'contenu'],
    additionalProperties: false
  },
  validate: (input) => checkStrings(input, ['dans', 'nom', 'contenu']),
  async run(input, ctx) {
    const parent = confineDir(String(input.dans))
    const name = safeName(String(input.nom))
    if (!parent || !name) return { content: parent ? 'Nom de fichier invalide.' : deniedMessage(), isError: true, summary: 'Écriture refusée' }
    if (!/\.(txt|md|csv)$/i.test(name)) return { content: 'Seuls les fichiers .txt, .md et .csv sont pris en charge.', isError: true, summary: 'Écriture refusée (format)' }
    const content = String(input.contenu).slice(0, 200_000)
    const target = uniquePath(join(parent, name))
    const preview = content.length > 160 ? `${content.slice(0, 160)}…` : content
    ctx.requestConfirmation('Créer un document', `${display(target)} — « ${preview} »`, async () => {
      writeFileSync(target, content, { flag: 'wx' })
      ctx.log(`Document créé : ${display(target)}`)
      ctx.announce('C’est fait, le document est créé.')
    })
    return { content: waiting(`créer ${display(target)} (${content.length} caractères)`), summary: `Document demandé : ${display(target)}` }
  }
}

export const renameItem: Tool = {
  name: 'fichiers_renommer',
  description: 'Renomme un fichier ou un dossier (sans le déplacer). Demande la validation de l’utilisateur.',
  risk: 'sensible',
  input_schema: {
    type: 'object',
    properties: { chemin: { type: 'string' }, nouveau_nom: { type: 'string', description: 'Nouveau nom, extension comprise.' } },
    required: ['chemin', 'nouveau_nom'],
    additionalProperties: false
  },
  validate: (input) => checkStrings(input, ['chemin', 'nouveau_nom']),
  async run(input, ctx) {
    const { ok } = resolveAll([input.chemin])
    const from = ok[0]
    const name = safeName(String(input.nouveau_nom))
    if (!from || !name) return { content: from ? 'Nouveau nom invalide.' : deniedMessage(), isError: true, summary: 'Renommage refusé' }
    const to = join(dirname(from), name)
    if (existsSync(to)) return { content: `« ${name} » existe déjà dans ce dossier.`, isError: true, summary: 'Renommage refusé (nom pris)' }
    ctx.requestConfirmation('Renommer', `${basename(from)} → ${name}`, async () => {
      renameSync(from, to)
      ctx.log(`Renommé : ${display(from)} → ${name}`)
      ctx.announce('C’est renommé.')
    })
    return { content: waiting(`renommer ${basename(from)} en ${name}`), summary: `Renommage demandé : ${basename(from)}` }
  }
}

function transfer(kind: 'deplacer' | 'copier'): Tool {
  const verb = kind === 'deplacer' ? 'Déplacer' : 'Copier'
  return {
    name: `fichiers_${kind}`,
    description: `${verb} un ou plusieurs fichiers ou dossiers vers un dossier autorisé (jusqu'à ${MAX_ITEMS} à la fois). Un nom déjà pris reçoit « (2) ». Demande la validation de l'utilisateur.`,
    risk: 'sensible',
    input_schema: {
      type: 'object',
      properties: {
        sources: { type: 'array', items: { type: 'string' }, description: 'Chemins à traiter.' },
        destination: { type: 'string', description: 'Dossier de destination.' }
      },
      required: ['sources', 'destination'],
      additionalProperties: false
    },
    validate: (input) => checkList(input, 'sources') ?? checkStrings(input, ['destination']),
    async run(input, ctx) {
      const dest = confineDir(String(input.destination))
      const { ok, refused } = resolveAll(input.sources)
      if (!dest) return { content: deniedMessage(), isError: true, summary: `${verb} refusé : destination` }
      const sources = ok.filter((p) => dirname(p) !== dest && !dest.startsWith(`${p}/`) && dest !== p)
      if (sources.length === 0) return { content: `Rien à ${verb.toLowerCase()}${refused.length ? ` (refusés : ${refused.join(', ')})` : ''}.`, isError: true, summary: `${verb} : rien à faire` }
      ctx.requestConfirmation(`${verb} ${sources.length} élément(s)`, `${list(sources)} → ${display(dest)}`, async () => {
        for (const src of sources) {
          const target = uniquePath(join(dest, basename(src)))
          if (kind === 'deplacer') move(src, target)
          else cpSync(src, target, { recursive: true, preserveTimestamps: true, errorOnExist: true })
        }
        ctx.log(`${kind === 'deplacer' ? 'Déplacé' : 'Copié'} : ${sources.length} élément(s) → ${display(dest)}`)
        ctx.announce(`C’est fait : ${sources.length} élément${sources.length > 1 ? 's' : ''} ${kind === 'deplacer' ? 'déplacé' : 'copié'}${sources.length > 1 ? 's' : ''}.`)
      })
      return {
        content: waiting(`${verb.toLowerCase()} ${sources.length} élément(s) vers ${display(dest)}${refused.length ? ` ; refusés car hors des dossiers autorisés : ${refused.join(', ')}` : ''}`),
        summary: `${verb} demandé : ${sources.length} → ${display(dest)}`
      }
    }
  }
}

export const moveItems = transfer('deplacer')
export const copyItems = transfer('copier')

export const trashItems: Tool = {
  name: 'fichiers_corbeille',
  description:
    "Met un ou plusieurs fichiers ou dossiers à la corbeille du Mac (récupérables tant que la corbeille n'est pas vidée). Ne supprime jamais définitivement. Demande la validation de l'utilisateur.",
  risk: 'sensible',
  input_schema: {
    type: 'object',
    properties: { chemins: { type: 'array', items: { type: 'string' } } },
    required: ['chemins'],
    additionalProperties: false
  },
  validate: (input) => checkList(input, 'chemins'),
  async run(input, ctx) {
    const { ok, refused } = resolveAll(input.chemins)
    if (ok.length === 0) return { content: `Rien à mettre à la corbeille${refused.length ? ` (refusés : ${refused.join(', ')})` : ''}.`, isError: true, summary: 'Corbeille : rien à faire' }
    const items = ok.map((p) => ({ p, dir: statSync(p).isDirectory() }))
    ctx.requestConfirmation(`Mettre ${ok.length} élément(s) à la corbeille`, list(ok), async () => {
      const trash = join(homedir(), '.Trash')
      for (const { p } of items) move(p, uniquePath(join(trash, basename(p))))
      ctx.log(`Corbeille : ${ok.length} élément(s) (${list(ok)})`)
      ctx.announce('C’est fait, c’est dans la corbeille.')
    })
    const dirs = items.filter((i) => i.dir).length
    return {
      content: waiting(`mettre à la corbeille ${ok.length} élément(s)${dirs ? `, dont ${dirs} dossier(s) avec tout leur contenu` : ''}${refused.length ? ` ; refusés : ${refused.join(', ')}` : ''}`),
      summary: `Corbeille demandée : ${ok.length}`
    }
  }
}
