import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, repoRoot } from '../paths.ts'

/**
 * Les compétences : des méthodes écrites en texte simple, une par fichier Markdown (« comment je veux mes
 * comptes rendus », « préparer un déplacement »). En tête, un nom et une description qui dit quand s'en
 * servir ; dessous, la méthode. L'assistant ne voit que la liste (nom et description) et lit la méthode
 * quand une demande y correspond : cent compétences ne coûtent pas plus qu'une ligne chacune.
 *
 * Le format reprend celui des « skills » de Claude (`name`, `description` en tête d'un SKILL.md) : un fichier
 * écrit pour l'un s'importe dans l'autre. Chacun a son dossier, qu'il peut aussi remplir avec un éditeur de texte.
 */

export type Competence = {
  /** Le nom du fichier, sans « .md » (« compte-rendu-de-reunion »). */
  id: string
  nom: string
  /** Quand s'en servir : c'est ce que l'assistant lit pour choisir. */
  description: string
  /** La méthode, en Markdown. */
  corps: string
  modifieLe: number
}

const listeners = new Set<(uid: number) => void>()
/** Prévient quand les compétences d'un compte changent (Réglages ouverts, par la voix ou un autre appareil). */
export function onCompetencesChange(fn: (uid: number) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const changed = (uid: number) => {
  for (const fn of listeners) fn(uid)
}

export const LIMITES = { nom: 60, description: 300, corps: 12_000, nombre: 40 } as const

/** Le dossier des compétences d'un compte. */
export function dossierCompetences(uid: number): string {
  const dir = join(dataDir, 'competences', String(uid))
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** Les modèles livrés avec CODE 2.0, à ajouter d'un geste depuis les Réglages. */
export const dossierModeles = join(repoRoot, 'config', 'competences')

const propre = (s: string) => s.replace(/\s+/g, ' ').trim()

/** « Compte rendu de réunion » → « compte-rendu-de-reunion ». */
export function slug(nom: string): string {
  return (
    nom
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'competence'
  )
}

export const ID_VALIDE = /^[a-z0-9][a-z0-9-]{0,47}$/

/** Une valeur d'en-tête, sans guillemets ; « > » et « | » (YAML sur plusieurs lignes) : les lignes qui suivent. */
function valeur(lignes: string[], i: number): string {
  const brut = lignes[i]!.slice(lignes[i]!.indexOf(':') + 1).trim()
  if (brut === '>' || brut === '|' || brut === '>-' || brut === '|-') {
    const suite: string[] = []
    for (let j = i + 1; j < lignes.length && /^\s+\S/.test(lignes[j]!); j++) suite.push(lignes[j]!.trim())
    return suite.join(' ')
  }
  if (/^".*"$/.test(brut)) {
    try {
      return String(JSON.parse(brut))
    } catch {
      return brut.slice(1, -1)
    }
  }
  return /^'.*'$/.test(brut) ? brut.slice(1, -1).replace(/''/g, "'") : brut
}

/**
 * Lit un fichier de compétence. Avec un en-tête `---` (nom/name, description) ; sans en-tête, le premier
 * titre donne le nom et le premier paragraphe la description. `nomParDefaut` : le nom du fichier.
 */
export function lireTexte(texte: string, nomParDefaut = ''): Omit<Competence, 'id' | 'modifieLe'> | { erreur: string } {
  const t = texte.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  let nom = ''
  let description = ''
  let corps = t
  const entete = t.match(/^---\n([\s\S]*?)\n---\n?/)
  if (entete) {
    const lignes = entete[1]!.split('\n')
    lignes.forEach((l, i) => {
      const cle = l.match(/^([A-Za-zéÉ_-]+)\s*:/)?.[1]?.toLowerCase()
      if (cle === 'nom' || cle === 'name' || cle === 'titre') nom = valeur(lignes, i)
      if (cle === 'description' || cle === 'quand') description = valeur(lignes, i)
    })
    corps = t.slice(entete[0].length)
  }
  if (!nom) {
    const titre = corps.match(/^#\s+(.+)$/m)
    if (titre) {
      nom = titre[1]!
      if (!entete) corps = corps.replace(titre[0], '')
    } else nom = nomParDefaut.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]+/g, ' ')
  }
  if (!description) {
    description = corps
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('#')) ?? ''
    // Tirée du texte : coupée à la limite plutôt que refusée.
    if (description.length > LIMITES.description) description = `${propre(description).slice(0, LIMITES.description - 1).replace(/\s+\S*$/, '')}…`
  }
  return valider({ nom, description, corps })
}

/** Les limites et le minimum : un nom, une description, une méthode. */
export function valider(c: { nom: string; description: string; corps: string }): Omit<Competence, 'id' | 'modifieLe'> | { erreur: string } {
  const nom = propre(c.nom).replace(/^#+\s*/, '')
  const description = propre(c.description)
  const corps = c.corps.replace(/\r\n?/g, '\n').trim()
  if (!nom) return { erreur: 'Donnez-lui un nom.' }
  if (nom.length > LIMITES.nom) return { erreur: `Un nom court, ${LIMITES.nom} caractères au plus.` }
  if (!description) return { erreur: 'Dites quand s’en servir : c’est ce que lit l’assistant pour la choisir.' }
  if (description.length > LIMITES.description) return { erreur: `La description tient en ${LIMITES.description} caractères au plus ; la méthode va dessous.` }
  if (!corps) return { erreur: 'Écrivez la méthode : ce qu’il faut faire, et comment.' }
  if (corps.length > LIMITES.corps) return { erreur: `La méthode dépasse ${LIMITES.corps.toLocaleString('fr-FR')} caractères : découpez-la en plusieurs compétences.` }
  return { nom, description, corps }
}

/** Le fichier tel qu'il est écrit : en-tête simple, puis la méthode. */
export function versTexte(c: Pick<Competence, 'nom' | 'description' | 'corps'>): string {
  const ligne = (s: string) => (/^[\s"'>|]|:\s|#/.test(s) ? JSON.stringify(s) : s)
  return `---\nnom: ${ligne(c.nom)}\ndescription: ${ligne(c.description)}\n---\n\n${c.corps.trim()}\n`
}

function lireDossier(dir: string): Competence[] {
  let fichiers: string[]
  try {
    fichiers = readdirSync(dir)
  } catch {
    return []
  }
  const liste: Competence[] = []
  for (const f of fichiers) {
    // Un fichier `nom.md`, ou un dossier `nom/SKILL.md` (format des skills de Claude).
    const id = f.replace(/\.md$/i, '')
    if (!ID_VALIDE.test(id)) continue
    const chemin = f.toLowerCase().endsWith('.md') ? join(dir, f) : join(dir, f, 'SKILL.md')
    try {
      const st = statSync(chemin)
      if (!st.isFile() || st.size > LIMITES.corps * 2) continue
      const lu = lireTexte(readFileSync(chemin, 'utf8'), f)
      if ('erreur' in lu) continue
      liste.push({ id, ...lu, modifieLe: st.mtimeMs })
    } catch {
      // Fichier illisible ou absent (dossier sans SKILL.md) : ignoré.
    }
  }
  return liste.sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).slice(0, LIMITES.nombre)
}

/** Les compétences d'un compte, par nom. Un fichier mal formé est ignoré, jamais bloquant. */
export function listCompetences(uid: number): Competence[] {
  return lireDossier(dossierCompetences(uid))
}

export function getCompetence(uid: number, idOuNom: string): Competence | null {
  const liste = listCompetences(uid)
  const cle = slug(idOuNom)
  return liste.find((c) => c.id === idOuNom) ?? liste.find((c) => slug(c.nom) === cle) ?? liste.find((c) => c.id.includes(cle) || cle.includes(c.id)) ?? null
}

/**
 * Enregistre une compétence : `id` pour remplacer celle-là (renommée si son nom change), sinon nouvelle ;
 * `remplacer` : une nouvelle du même nom remplace l'ancienne au lieu d'être refusée.
 * L'écriture passe par un fichier temporaire : jamais de fichier à moitié écrit.
 */
export function saveCompetence(uid: number, c: { nom: string; description: string; corps: string }, opts: { id?: string; remplacer?: boolean } = {}): Competence | { erreur: string } {
  const { id, remplacer = false } = opts
  const ok = valider(c)
  if ('erreur' in ok) return ok
  const dir = dossierCompetences(uid)
  const liste = listCompetences(uid)
  const ancien = id ? liste.find((x) => x.id === id) : undefined
  if (id && !ancien) return { erreur: 'Cette compétence n’existe plus.' }
  let nouvelId = slug(ok.nom)
  const memeNom = liste.find((x) => x.id === nouvelId)
  // Un autre fichier porte déjà ce nom : un suffixe, sauf si c'est la même compétence ou une mise à jour par le nom.
  if (memeNom && ancien && memeNom.id !== ancien.id) {
    let n = 2
    while (liste.some((x) => x.id === `${nouvelId}-${n}`)) n++
    nouvelId = `${nouvelId}-${n}`
  }
  if (!ancien && memeNom && !remplacer) return { erreur: `« ${memeNom.nom} » existe déjà : modifiez-la, ou choisissez un autre nom.` }
  if (!ancien && !memeNom && liste.length >= LIMITES.nombre) return { erreur: `${LIMITES.nombre} compétences au plus : retirez-en une d’abord.` }
  const chemin = join(dir, `${nouvelId}.md`)
  const tmp = `${chemin}.${process.pid}.tmp`
  writeFileSync(tmp, versTexte(ok), { mode: 0o600 })
  renameSync(tmp, chemin)
  if (ancien && ancien.id !== nouvelId) supprimerFichier(dir, ancien.id)
  changed(uid)
  return { id: nouvelId, ...ok, modifieLe: Date.now() }
}

function supprimerFichier(dir: string, id: string): boolean {
  const fichier = join(dir, `${id}.md`)
  if (existsSync(fichier)) {
    unlinkSync(fichier)
    return true
  }
  // Format dossier : on retire seulement le SKILL.md, le reste du dossier n'est pas à nous.
  const skill = join(dir, id, 'SKILL.md')
  if (existsSync(skill)) {
    unlinkSync(skill)
    return true
  }
  return false
}

export function removeCompetence(uid: number, id: string): boolean {
  const ok = ID_VALIDE.test(id) && supprimerFichier(dossierCompetences(uid), id)
  if (ok) changed(uid)
  return ok
}

/** Les modèles livrés (dossier `config/competences`). */
export function modeles(): Competence[] {
  return lireDossier(dossierModeles)
}
