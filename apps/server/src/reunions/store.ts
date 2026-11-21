import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MIC_SAMPLE_RATE } from '@code/protocol'
import { db, hasColumn, userIndex } from '../db.ts'
import { dataDir } from '../paths.ts'

/**
 * Les réunions : enregistrées par un appareil ou importées d'un fichier audio. L'appareil envoie l'audio par
 * morceaux (WAV 16 kHz mono) ; chaque morceau est transcrit puis son fichier effacé : il ne reste que le texte,
 * avec l'instant de chaque morceau. L'assistant y ajoute ensuite un titre, un résumé et les actions à mener.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS reunions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    titre TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('micro', 'fichier')),
    etat TEXT NOT NULL DEFAULT 'enregistrement' CHECK (etat IN ('enregistrement', 'transcription', 'prete', 'erreur', 'supprimee')),
    debut INTEGER NOT NULL,
    duree_s REAL NOT NULL DEFAULT 0,
    -- Qui a transcrit, et ce que cela a coûté (estimation, en dollars).
    service TEXT,
    cout REAL NOT NULL DEFAULT 0,
    resume TEXT,
    -- Actions relevées par l'assistant : [{ quoi, qui, quand }] en JSON.
    actions TEXT,
    participants TEXT,
    erreur TEXT,
    -- La fin de la transcription a été annoncée à la personne.
    annoncee INTEGER NOT NULL DEFAULT 0,
    range_le INTEGER
  );
  CREATE TABLE IF NOT EXISTS reunion_segments (
    reunion_id INTEGER NOT NULL REFERENCES reunions(id),
    rang INTEGER NOT NULL,
    debut_s REAL NOT NULL,
    duree_s REAL NOT NULL,
    etat TEXT NOT NULL DEFAULT 'recu' CHECK (etat IN ('recu', 'transcrit', 'erreur')),
    texte TEXT,
    erreur TEXT,
    PRIMARY KEY (reunion_id, rang)
  );
`)
// Le rapport : ce qui a été décidé et ce qui reste à trancher, des listes de phrases en JSON.
for (const col of ['decisions', 'points']) if (!hasColumn('reunions', col)) db.exec(`ALTER TABLE reunions ADD COLUMN ${col} TEXT`)
userIndex('reunions', 'etat, debut')

export type EtatReunion = 'enregistrement' | 'transcription' | 'prete' | 'erreur'
export type ActionReunion = { quoi: string; qui?: string; quand?: string }

export type Reunion = {
  id: number
  uid: number
  titre: string
  source: 'micro' | 'fichier'
  etat: EtatReunion
  debut: number
  dureeS: number
  service: string | null
  cout: number
  resume: string | null
  actions: ActionReunion[]
  /** Ce qui a été décidé, et ce qui reste à trancher. */
  decisions: string[]
  points: string[]
  participants: string[]
  erreur: string | null
  annoncee: boolean
  rangeLe: number | null
  /** Morceaux reçus, transcrits, en échec. */
  segments: { recus: number; transcrits: number; echecs: number }
}

export type Segment = { rang: number; debutS: number; dureeS: number; etat: 'recu' | 'transcrit' | 'erreur'; texte: string | null; erreur: string | null }

type Row = { id: number; utilisateur_id: number; titre: string; source: 'micro' | 'fichier'; etat: EtatReunion; debut: number; duree_s: number; service: string | null; cout: number; resume: string | null; actions: string | null; decisions: string | null; points: string | null; participants: string | null; erreur: string | null; annoncee: number; range_le: number | null }
type SegRow = { rang: number; debut_s: number; duree_s: number; etat: Segment['etat']; texte: string | null; erreur: string | null }

const listeners = new Set<(uid: number, id: number) => void>()
/** Prévient à chaque étape d'une réunion (morceau transcrit, fin, rangement, suppression). */
export function onReunionsChange(fn: (uid: number, id: number) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const changed = (uid: number, id: number) => {
  for (const fn of listeners) fn(uid, id)
}

const dossier = (uid: number, id: number) => join(dataDir, 'reunions', String(uid), String(id))
export const fichierSegment = (uid: number, id: number, rang: number) => join(dossier(uid, id), `${String(rang).padStart(4, '0')}.wav`)

const q = {
  insert: db.prepare('INSERT INTO reunions (utilisateur_id, titre, source, debut) VALUES (?, ?, ?, ?)'),
  get: db.prepare("SELECT * FROM reunions WHERE utilisateur_id = ? AND id = ? AND etat != 'supprimee'"),
  parId: db.prepare("SELECT * FROM reunions WHERE id = ? AND etat != 'supprimee'"),
  list: db.prepare("SELECT * FROM reunions WHERE utilisateur_id = ? AND etat != 'supprimee' ORDER BY debut DESC, id DESC LIMIT 60"),
  enCours: db.prepare("SELECT * FROM reunions WHERE etat = 'transcription' ORDER BY id"),
  // Le dernier son reçu date de plus longtemps que le seuil (l'audio d'un micro avance avec l'horloge).
  abandonnees: db.prepare("SELECT r.* FROM reunions r WHERE r.etat = 'enregistrement' AND r.debut + 1000 * COALESCE((SELECT MAX(s.debut_s + s.duree_s) FROM reunion_segments s WHERE s.reunion_id = r.id), 0) < ?"),
  compte: db.prepare("SELECT etat, COUNT(*) AS n FROM reunion_segments WHERE reunion_id = ? GROUP BY etat"),
  segment: db.prepare('INSERT OR IGNORE INTO reunion_segments (reunion_id, rang, debut_s, duree_s) VALUES (?, ?, ?, ?)'),
  segments: db.prepare('SELECT rang, debut_s, duree_s, etat, texte, erreur FROM reunion_segments WHERE reunion_id = ? ORDER BY rang'),
  aTranscrire: db.prepare("SELECT rang, debut_s, duree_s, etat, texte, erreur FROM reunion_segments WHERE reunion_id = ? AND etat = 'recu' ORDER BY rang LIMIT 1"),
  precedent: db.prepare("SELECT texte FROM reunion_segments WHERE reunion_id = ? AND rang < ? AND etat = 'transcrit' ORDER BY rang DESC LIMIT 1"),
  texte: db.prepare("UPDATE reunion_segments SET etat = 'transcrit', texte = ?, erreur = NULL WHERE reunion_id = ? AND rang = ?"),
  echec: db.prepare("UPDATE reunion_segments SET etat = 'erreur', erreur = ? WHERE reunion_id = ? AND rang = ?"),
  duree: db.prepare('SELECT COALESCE(MAX(debut_s + duree_s), 0) AS fin, COALESCE(SUM(CASE WHEN etat = \'transcrit\' THEN duree_s ELSE 0 END), 0) AS transcrit FROM reunion_segments WHERE reunion_id = ?'),
  terminer: db.prepare("UPDATE reunions SET etat = 'transcription', duree_s = ? WHERE id = ? AND etat = 'enregistrement'"),
  prete: db.prepare("UPDATE reunions SET etat = 'prete', service = ?, cout = ?, erreur = ? WHERE id = ?"),
  erreur: db.prepare("UPDATE reunions SET etat = 'erreur', erreur = ? WHERE id = ?"),
  annoncee: db.prepare('UPDATE reunions SET annoncee = 1 WHERE id = ?'),
  ranger: db.prepare('UPDATE reunions SET titre = ?, resume = ?, actions = ?, decisions = ?, points = ?, participants = ?, range_le = ? WHERE utilisateur_id = ? AND id = ?'),
  supprimer: db.prepare("UPDATE reunions SET etat = 'supprimee', resume = NULL, actions = NULL, decisions = NULL, points = NULL, participants = NULL WHERE utilisateur_id = ? AND id = ?"),
  viderSegments: db.prepare('DELETE FROM reunion_segments WHERE reunion_id = ?')
}

function liste<T>(json: string | null, ok: (v: unknown) => v is T): T[] {
  try {
    const v = JSON.parse(json ?? '[]') as unknown
    return Array.isArray(v) ? v.filter(ok) : []
  } catch {
    return []
  }
}

function toReunion(r: Row): Reunion {
  const n = { recu: 0, transcrit: 0, erreur: 0 }
  for (const c of q.compte.all(r.id) as { etat: keyof typeof n; n: number }[]) n[c.etat] = c.n
  return {
    id: r.id,
    uid: r.utilisateur_id,
    titre: r.titre,
    source: r.source,
    etat: r.etat,
    debut: r.debut,
    dureeS: r.duree_s,
    service: r.service,
    cout: r.cout,
    resume: r.resume,
    actions: liste(r.actions, (a): a is ActionReunion => typeof (a as ActionReunion)?.quoi === 'string'),
    decisions: liste(r.decisions, (p): p is string => typeof p === 'string'),
    points: liste(r.points, (p): p is string => typeof p === 'string'),
    participants: liste(r.participants, (p): p is string => typeof p === 'string'),
    erreur: r.erreur,
    annoncee: !!r.annoncee,
    rangeLe: r.range_le,
    segments: { recus: n.recu + n.transcrit + n.erreur, transcrits: n.transcrit, echecs: n.erreur }
  }
}

export function creerReunion(uid: number, r: { titre: string; source: 'micro' | 'fichier' }, now: number): Reunion {
  const titre = r.titre.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Réunion'
  const { lastInsertRowid } = q.insert.run(uid, titre, r.source, now)
  changed(uid, Number(lastInsertRowid))
  return getReunion(uid, Number(lastInsertRowid))!
}

export function getReunion(uid: number, id: number): Reunion | null {
  const row = q.get.get(uid, id) as Row | undefined
  return row ? toReunion(row) : null
}

/** Sans le compte : pour la file de transcription, qui ne connaît que le numéro. */
export function reunionParId(id: number): Reunion | null {
  const row = q.parId.get(id) as Row | undefined
  return row ? toReunion(row) : null
}

export function listerReunions(uid: number): Reunion[] {
  return (q.list.all(uid) as Row[]).map(toReunion)
}

/** Celles dont la transcription n'est pas finie (reprise au démarrage du serveur). */
export function reunionsEnTranscription(): Reunion[] {
  return (q.enCours.all() as Row[]).map(toReunion)
}

const toSegment = (s: SegRow): Segment => ({ rang: s.rang, debutS: s.debut_s, dureeS: s.duree_s, etat: s.etat, texte: s.texte, erreur: s.erreur })

export function segmentsDe(id: number): Segment[] {
  return (q.segments.all(id) as SegRow[]).map(toSegment)
}

export function prochainSegment(id: number): Segment | null {
  const s = q.aTranscrire.get(id) as SegRow | undefined
  return s ? toSegment(s) : null
}

/** La fin du morceau précédent : donnée au service pour qu'il garde le fil (noms, phrase en cours). */
export function finDuPrecedent(id: number, rang: number): string {
  return ((q.precedent.get(id, rang) as { texte: string | null } | undefined)?.texte ?? '').slice(-200)
}

/** L'en-tête WAV attendu : PCM 16 bits, mono, 16 kHz (ce que les appareils envoient) ; renvoie les octets audio. */
export function audioDuWav(wav: Buffer): Buffer | { erreur: string } {
  if (wav.length < 44 + MIC_SAMPLE_RATE || wav.toString('latin1', 0, 4) !== 'RIFF' || wav.toString('latin1', 8, 12) !== 'WAVE') return { erreur: 'Un fichier WAV est attendu.' }
  if (wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt32LE(24) !== MIC_SAMPLE_RATE || wav.readUInt16LE(34) !== 16) return { erreur: 'WAV 16 kHz, mono, 16 bits attendu.' }
  return wav.subarray(44)
}

/**
 * Un morceau arrive : gardé sur le disque jusqu'à sa transcription. Renvoyer deux fois le même (reprise après
 * une coupure) ne le double pas.
 */
export function ajouterSegment(uid: number, id: number, s: { rang: number; debutS: number; wav: Buffer }): { ok: true; nouveau: boolean } | { erreur: string } {
  const r = getReunion(uid, id)
  if (!r) return { erreur: 'Réunion inconnue.' }
  if (r.etat !== 'enregistrement') return { erreur: 'Cette réunion est déjà terminée.' }
  const audio = audioDuWav(s.wav)
  if ('erreur' in audio) return audio
  const dureeS = audio.length / 2 / MIC_SAMPLE_RATE
  mkdirSync(dossier(uid, id), { recursive: true, mode: 0o700 })
  const { changes } = q.segment.run(id, s.rang, s.debutS, dureeS)
  if (changes) writeFileSync(fichierSegment(uid, id, s.rang), s.wav, { mode: 0o600 })
  changed(uid, id)
  return { ok: true, nouveau: !!changes }
}

function effacerAudio(uid: number, id: number, rang?: number): void {
  rmSync(rang === undefined ? dossier(uid, id) : fichierSegment(uid, id, rang), { recursive: true, force: true })
}

export function noterTexte(uid: number, id: number, rang: number, texte: string): void {
  q.texte.run(texte, id, rang)
  effacerAudio(uid, id, rang)
  changed(uid, id)
}

export function noterEchec(uid: number, id: number, rang: number, erreur: string): void {
  q.echec.run(erreur.slice(0, 300), id, rang)
  changed(uid, id)
}

/** L'enregistrement est fini : la réunion attend la fin de sa transcription. Sans aucun morceau, rien à transcrire. */
export function terminerReunion(uid: number, id: number): Reunion | null {
  const r = getReunion(uid, id)
  if (!r) return null
  if (r.etat === 'enregistrement') {
    const { fin } = q.duree.get(id) as { fin: number }
    if (!r.segments.recus) q.erreur.run('Rien n’a été enregistré.', id)
    else q.terminer.run(fin, id)
    changed(uid, id)
  }
  return getReunion(uid, id)
}

/** Tout est transcrit (ou en échec) : prête s'il y a du texte, avec le coût estimé ; sinon en erreur. */
export function cloreTranscription(uid: number, id: number, service: string, tarifHeure: number): Reunion | null {
  const r = getReunion(uid, id)
  if (!r || r.etat !== 'transcription') return r
  const { transcrit } = q.duree.get(id) as { transcrit: number }
  const segs = segmentsDe(id)
  if (!segs.some((s) => s.etat === 'transcrit')) q.erreur.run(segs.find((s) => s.erreur)?.erreur ?? 'La transcription a échoué.', id)
  else q.prete.run(service, Math.round((transcrit / 3600) * tarifHeure * 10_000) / 10_000, r.segments.echecs ? `${r.segments.echecs} passage(s) n’ont pas pu être transcrits.` : null, id)
  effacerAudio(uid, id)
  changed(uid, id)
  return getReunion(uid, id)
}

export function echecReunion(uid: number, id: number, erreur: string): void {
  q.erreur.run(erreur.slice(0, 300), id)
  changed(uid, id)
}

export function marquerAnnoncee(id: number): void {
  q.annoncee.run(id)
}

export type Rangement = { titre: string; resume: string; actions: ActionReunion[]; decisions?: string[]; points?: string[]; participants: string[] }

const phrases = (l: string[] | undefined) => JSON.stringify((l ?? []).map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 400)).filter(Boolean).slice(0, 40))

export function rangerReunion(uid: number, id: number, r: Rangement, now: number): Reunion | null {
  q.ranger.run(r.titre.replace(/\s+/g, ' ').trim().slice(0, 120), r.resume.trim().slice(0, 6000), JSON.stringify(r.actions.slice(0, 40)), phrases(r.decisions), phrases(r.points), JSON.stringify(r.participants.slice(0, 30)), now, uid, id)
  changed(uid, id)
  return getReunion(uid, id)
}

/** Supprimée : le texte et l'audio disparaissent, il ne reste que la ligne (masquée). */
export function supprimerReunion(uid: number, id: number): boolean {
  if (!getReunion(uid, id)) return false
  q.supprimer.run(uid, id)
  q.viderSegments.run(id)
  effacerAudio(uid, id)
  changed(uid, id)
  return true
}

/**
 * Un enregistrement resté ouvert (appareil éteint, app fermée, page rechargée) : clos d'office quand plus rien
 * n'arrive depuis `apresMs`. Ce qui a été reçu est transcrit ; rien reçu, la réunion passe en erreur.
 */
export function cloreAbandonnees(now: number, apresMs = 30 * 60_000): Reunion[] {
  return (q.abandonnees.all(now - apresMs) as Row[]).map((r) => terminerReunion(r.utilisateur_id, r.id)).filter((r): r is Reunion => !!r)
}

/** « 1:02:05 » ou « 12:40 ». */
export function horodatage(s: number): string {
  const t = Math.max(0, Math.floor(s))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** Le texte de la réunion, un paragraphe par morceau, chacun avec son instant. */
export function transcription(id: number): { debutS: number; texte: string }[] {
  return segmentsDe(id)
    .filter((s) => s.etat === 'transcrit' && s.texte?.trim())
    .map((s) => ({ debutS: s.debutS, texte: s.texte!.trim() }))
}
