import { randomBytes, randomUUID } from 'node:crypto'
import type { PontReponse } from '@code/protocol'
import { setPreviewPublisher } from '../previews.ts'
import { FICHIERS } from '../tools/fichiers-outils.ts'
import { CONTENU_BRUT, contenuLocal } from '../tools/pieces.ts'
import type { ToolContext } from '../tools/types.ts'

/**
 * Le pont, côté Mac : ce que l'app CODE du Mac exécute quand le serveur hébergé le lui demande. Les mêmes
 * outils de fichiers que sur un serveur installé sur le Mac, avec les mêmes dossiers autorisés. Une
 * modification n'est jamais faite ici d'office : elle attend sous une clé que l'utilisateur ait dit « oui »
 * sur le serveur (15 minutes au plus). Les fichiers à afficher sont déposés au serveur par `deposer`.
 */

const ATTENTE_MS = 15 * 60_000
const attente = new Map<string, { execute: () => Promise<void>; expire: number }>()
/** Où vont le journal et les annonces de l'action en train de se faire. */
let enCours: { log: (l: string) => void; announce: (t: string) => void } | null = null

/** Une exécution à la fois : l'adresse des aperçus est notée au niveau du module. */
let file: Promise<unknown> = Promise.resolve()
function enFile<T>(fn: () => Promise<T>): Promise<T> {
  const suite = file.then(fn, fn)
  file = suite.catch(() => {})
  return suite
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Exécute un outil de fichiers. `deposer` envoie un fichier au serveur et rend son adresse d'aperçu
 * (null si trop gros ou refusé : l'aperçu manque, le reste s'affiche).
 */
export function executerOutil(nom: string, input: Record<string, unknown>, deposer: (chemin: string) => Promise<string | null>): Promise<PontReponse> {
  return enFile(async () => {
    // Une pièce à joindre à un mail : le contenu brut d'un fichier autorisé, rien d'autre.
    if (nom === CONTENU_BRUT) return { resultat: { content: JSON.stringify(contenuLocal(String(input.chemin ?? ''))), summary: 'Pièce jointe' } }
    const tool = FICHIERS.find((t) => t.name === nom)
    if (!tool) return { erreur: `outil inconnu sur ce Mac : ${nom}` }
    const now = Date.now()
    for (const [cle, a] of attente) if (a.expire < now) attente.delete(cle)
    const apercus: { jeton: string; chemin: string }[] = []
    let confirmation: PontReponse['confirmation']
    const ctx = {
      fichiers: true,
      requestConfirmation: (titre: string, resume: string, execute: () => Promise<void>) => {
        const cle = randomUUID()
        attente.set(cle, { execute, expire: Date.now() + ATTENTE_MS })
        confirmation = { titre, resume, cle }
      },
      // Une modification note et annonce au moment où elle est faite (voir `executerAction`).
      announce: (t: string) => enCours?.announce(t),
      log: (l: string) => enCours?.log(l)
    } as unknown as ToolContext
    const invalide = tool.validate(input, ctx)
    if (invalide) return { resultat: { content: invalide, isError: true, summary: `${nom} : entrée invalide` } }
    setPreviewPublisher((chemin) => {
      const jeton = `pont-apercu-${randomBytes(8).toString('hex')}`
      apercus.push({ jeton, chemin })
      return jeton
    })
    let r
    try {
      r = await tool.run(input, ctx)
    } catch (err) {
      return { erreur: message(err) }
    } finally {
      setPreviewPublisher(null)
    }
    let view = r.view
    if (view && apercus.length) {
      let json = JSON.stringify(view)
      for (const a of apercus) {
        const url = await deposer(a.chemin).catch(() => null)
        json = json.split(a.jeton).join(url ?? '')
      }
      view = JSON.parse(json) as typeof view
    }
    // Le contenu pour Claude peut être fait de blocs (image, PDF) : il part tel quel.
    return {
      resultat: { content: r.content as string | unknown[], ...(r.isError ? { isError: true } : {}), summary: r.summary, ...(view ? { view } : {}) },
      ...(confirmation ? { confirmation } : {})
    }
  })
}

/** Fait l'action préparée, maintenant que l'utilisateur a dit « oui ». */
export function executerAction(cle: string): Promise<PontReponse> {
  return enFile(async () => {
    const a = attente.get(cle)
    attente.delete(cle)
    if (!a || a.expire < Date.now()) return { erreur: 'cette action a expiré sur le Mac, redemandez-la' }
    const journal: string[] = []
    const annonces: string[] = []
    enCours = { log: (l) => journal.push(l), announce: (t) => annonces.push(t) }
    try {
      await a.execute()
      return { journal, annonces }
    } catch (err) {
      return { journal, erreur: message(err) }
    } finally {
      enCours = null
    }
  })
}
