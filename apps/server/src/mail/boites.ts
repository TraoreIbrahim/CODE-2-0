import { resolveMx } from 'node:dns/promises'
import type { BoiteMail } from '@code/protocol'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { db } from '../db.ts'
import { decrypt, encrypt } from '../users/crypto.ts'

/**
 * Boîtes mail reliées par IMAP (lecture) et SMTP (envoi), en plus de Gmail : plusieurs par utilisateur.
 * Le mot de passe est chiffré (clé maîtresse du serveur), jamais renvoyé à un écran ni à Claude.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS boites_mail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    libelle TEXT NOT NULL,
    email TEXT NOT NULL,
    fournisseur TEXT NOT NULL,
    imap_hote TEXT NOT NULL,
    imap_port INTEGER NOT NULL,
    smtp_hote TEXT NOT NULL,
    smtp_port INTEGER NOT NULL,
    -- Mot de passe chiffré (AES-GCM, contexte « boite:<id utilisateur>:<adresse> »).
    mot_de_passe TEXT NOT NULL,
    defaut INTEGER NOT NULL DEFAULT 0,
    cree INTEGER NOT NULL,
    UNIQUE (utilisateur_id, email)
  )
`)

export type Serveurs = { fournisseur: string; imapHote: string; imapPort: number; smtpHote: string; smtpPort: number }
export type Boite = Serveurs & { id: number; uid: number; libelle: string; email: string; defaut: boolean }

/** Fournisseurs reconnus d'après le serveur de réception du domaine (MX) : les domaines hébergés chez eux. */
const BY_MX: { suffix: string; serveurs: Serveurs }[] = [
  // Les noms courts du domaine (imap.mondomaine.fr…) ne correspondent pas au certificat : on prend ceux d'OVHcloud.
  { suffix: '.mail.ovh.net', serveurs: { fournisseur: 'OVHcloud', imapHote: 'ssl0.ovh.net', imapPort: 993, smtpHote: 'ssl0.ovh.net', smtpPort: 465 } }
]
/** Fournisseurs reconnus d'après le domaine de l'adresse. */
const BY_DOMAIN: Record<string, Serveurs> = {
  'yahoo.com': { fournisseur: 'Yahoo', imapHote: 'imap.mail.yahoo.com', imapPort: 993, smtpHote: 'smtp.mail.yahoo.com', smtpPort: 465 },
  'yahoo.fr': { fournisseur: 'Yahoo', imapHote: 'imap.mail.yahoo.com', imapPort: 993, smtpHote: 'smtp.mail.yahoo.com', smtpPort: 465 },
  'icloud.com': { fournisseur: 'iCloud', imapHote: 'imap.mail.me.com', imapPort: 993, smtpHote: 'smtp.mail.me.com', smtpPort: 587 },
  'me.com': { fournisseur: 'iCloud', imapHote: 'imap.mail.me.com', imapPort: 993, smtpHote: 'smtp.mail.me.com', smtpPort: 587 }
}
/** Adresses à relier autrement (pas par mot de passe IMAP). */
const REFUSED: Record<string, string> = {
  'gmail.com': 'Pour Gmail, utilisez « Connecter Google » (Réglages, Connecteurs).',
  'googlemail.com': 'Pour Gmail, utilisez « Connecter Google » (Réglages, Connecteurs).',
  'outlook.com': 'Microsoft n’accepte plus la connexion IMAP par mot de passe : Outlook demande une connexion Microsoft, pas encore prise en charge.',
  'hotmail.com': 'Microsoft n’accepte plus la connexion IMAP par mot de passe : Outlook demande une connexion Microsoft, pas encore prise en charge.',
  'hotmail.fr': 'Microsoft n’accepte plus la connexion IMAP par mot de passe : Outlook demande une connexion Microsoft, pas encore prise en charge.',
  'live.com': 'Microsoft n’accepte plus la connexion IMAP par mot de passe : Outlook demande une connexion Microsoft, pas encore prise en charge.'
}

const EMAIL = /^[^\s@<>(),;:"[\]\\]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i

/** Une adresse simple et sûre (pas de nom, de commentaire ni de groupe) : sinon null. */
export function cleanEmail(value: string): string | null {
  const v = value.trim().toLowerCase()
  return EMAIL.test(v) ? v : null
}

/** Les serveurs d'une adresse : par son domaine, sinon par le serveur de réception (MX). `erreur` : à relier autrement. */
export async function guessServers(email: string, mx: (domain: string) => Promise<{ exchange: string }[]> = resolveMx): Promise<Serveurs | { erreur: string } | null> {
  const domain = email.split('@')[1]!.toLowerCase()
  if (REFUSED[domain]) return { erreur: REFUSED[domain]! }
  if (BY_DOMAIN[domain]) return BY_DOMAIN[domain]!
  const records = await mx(domain).catch(() => [])
  const hosts = records.map((r) => r.exchange.toLowerCase().replace(/\.$/, ''))
  for (const { suffix, serveurs } of BY_MX) if (hosts.some((h) => h.endsWith(suffix))) return serveurs
  if (hosts.some((h) => h.endsWith('.google.com') || h.endsWith('.googlemail.com'))) return { erreur: 'Cette adresse est chez Google : reliez-la avec « Connecter Google ».' }
  if (hosts.some((h) => h.endsWith('.outlook.com'))) return { erreur: 'Cette adresse est chez Microsoft 365 : la connexion Microsoft n’est pas encore prise en charge.' }
  return null
}

const keyOf = (uid: number, email: string) => `boite:${uid}:${email}`

const q = {
  list: db.prepare('SELECT * FROM boites_mail WHERE utilisateur_id = ? ORDER BY defaut DESC, id'),
  get: db.prepare('SELECT * FROM boites_mail WHERE id = ? AND utilisateur_id = ?'),
  insert: db.prepare('INSERT INTO boites_mail (utilisateur_id, libelle, email, fournisseur, imap_hote, imap_port, smtp_hote, smtp_port, mot_de_passe, defaut, cree) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (utilisateur_id, email) DO UPDATE SET libelle = excluded.libelle, fournisseur = excluded.fournisseur, imap_hote = excluded.imap_hote, imap_port = excluded.imap_port, smtp_hote = excluded.smtp_hote, smtp_port = excluded.smtp_port, mot_de_passe = excluded.mot_de_passe'),
  remove: db.prepare('DELETE FROM boites_mail WHERE id = ? AND utilisateur_id = ?'),
  clearDefault: db.prepare('UPDATE boites_mail SET defaut = 0 WHERE utilisateur_id = ?'),
  setDefault: db.prepare('UPDATE boites_mail SET defaut = 1 WHERE id = ? AND utilisateur_id = ?')
}

type Row = { id: number; utilisateur_id: number; libelle: string; email: string; fournisseur: string; imap_hote: string; imap_port: number; smtp_hote: string; smtp_port: number; mot_de_passe: string; defaut: number }

const toBoite = (r: Row): Boite => ({ id: r.id, uid: r.utilisateur_id, libelle: r.libelle, email: r.email, fournisseur: r.fournisseur, imapHote: r.imap_hote, imapPort: r.imap_port, smtpHote: r.smtp_hote, smtpPort: r.smtp_port, defaut: r.defaut === 1 })

export function listBoites(uid: number): Boite[] {
  return (q.list.all(uid) as Row[]).map(toBoite)
}

export function getBoite(uid: number, id: number): Boite | null {
  const r = q.get.get(id, uid) as Row | undefined
  return r ? toBoite(r) : null
}

/** Ce que l'écran voit d'une boîte (jamais le mot de passe). */
export function boiteInfo(b: Boite): BoiteMail {
  return { id: b.id, libelle: b.libelle, email: b.email, fournisseur: b.fournisseur, imap: `${b.imapHote}:${b.imapPort}`, smtp: `${b.smtpHote}:${b.smtpPort}`, defaut: b.defaut }
}

/** Mot de passe en clair, seulement pour ouvrir une connexion. */
export function passwordOf(b: Boite): string {
  const r = q.get.get(b.id, b.uid) as Row
  return decrypt(r.mot_de_passe, keyOf(b.uid, b.email))
}

export function saveBoite(uid: number, libelle: string, email: string, password: string, s: Serveurs): Boite {
  const first = listBoites(uid).length === 0
  q.insert.run(uid, libelle, email, s.fournisseur, s.imapHote, s.imapPort, s.smtpHote, s.smtpPort, encrypt(password, keyOf(uid, email)), first ? 1 : 0, Date.now())
  return listBoites(uid).find((b) => b.email === email)!
}

export function removeBoite(uid: number, id: number): boolean {
  const was = getBoite(uid, id)
  if (!was) return false
  q.remove.run(id, uid)
  // La boîte par défaut retirée : la suivante prend le relais.
  const rest = listBoites(uid)
  if (was.defaut && rest[0]) q.setDefault.run(rest[0].id, uid)
  return true
}

export function setDefaultBoite(uid: number, id: number): void {
  if (!getBoite(uid, id)) return
  q.clearDefault.run(uid)
  q.setDefault.run(id, uid)
}

// ── Connexions ──

/** Client IMAP d'une boîte (connexion chiffrée, certificat vérifié). */
export function imapClient(b: Serveurs & { email: string }, password: string): ImapFlow {
  return new ImapFlow({ host: b.imapHote, port: b.imapPort, secure: b.imapPort === 993, auth: { user: b.email, pass: password }, logger: false, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000, emitLogs: false })
}

/** Transport SMTP d'une boîte : SSL sur 465, STARTTLS obligatoire sinon. */
export function smtpTransport(b: Serveurs & { email: string }, password: string) {
  return nodemailer.createTransport({ host: b.smtpHote, port: b.smtpPort, secure: b.smtpPort === 465, requireTLS: b.smtpPort !== 465, auth: { user: b.email, pass: password }, connectionTimeout: 15_000, greetingTimeout: 15_000 })
}

/** Ouvre la boîte, fait le travail, referme (une connexion par appel : simple et sans état). */
export async function withImap<T>(b: Boite, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const client = imapClient(b, passwordOf(b))
  client.on('error', () => {})
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.logout().catch(() => client.close())
  }
}

/** Message d'erreur lisible pour une connexion refusée ou impossible. */
export function connectionError(err: unknown, what: 'lecture' | 'envoi'): string {
  const e = err as { authenticationFailed?: boolean; responseCode?: number; code?: string; message?: string }
  const of = what === 'envoi' ? 'd’envoi' : 'de lecture'
  if (e?.authenticationFailed || e?.responseCode === 535 || e?.code === 'EAUTH') return 'Adresse ou mot de passe refusé par le serveur.'
  if (e?.code === 'ENOTFOUND') return `Serveur ${of} introuvable.`
  if (e?.code === 'ETIMEDOUT' || e?.code === 'ECONNREFUSED' || /timeout/i.test(e?.message ?? '')) return `Serveur ${of} injoignable.`
  if (/certificate|self.signed|altname/i.test(e?.message ?? '')) return `Certificat du serveur ${of} invalide : connexion refusée par sécurité.`
  return `Connexion ${what === 'lecture' ? 'IMAP' : 'SMTP'} impossible (${(e?.message ?? String(err)).slice(0, 120)}).`
}

/** Teste la lecture puis l'envoi, sans rien lire ni envoyer. Renvoie l'erreur, ou null si tout passe. */
export async function testBoite(email: string, password: string, s: Serveurs): Promise<string | null> {
  const imap = imapClient({ ...s, email }, password)
  imap.on('error', () => {})
  try {
    await imap.connect()
    await imap.logout().catch(() => imap.close())
  } catch (err) {
    return connectionError(err, 'lecture')
  }
  try {
    await smtpTransport({ ...s, email }, password).verify()
  } catch (err) {
    return connectionError(err, 'envoi')
  }
  return null
}
