import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { GoogleStatus } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import { db } from '../db.ts'
import { deleteSecret, getSecret } from '../secrets.ts'
import { decrypt, encrypt } from '../users/crypto.ts'
import { currentUserId } from '../users/scope.ts'
import { ensureOwner } from '../users/users.ts'

/**
 * Accès au compte Google de chacun (Gmail, Agenda, Drive, Sheets). Un client OAuth par installation, créé par
 * le propriétaire dans son projet Google Cloud et collé dans Réglages › Connecteurs (chiffré en base), ou
 * donné par l'environnement du serveur (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET). Chaque utilisateur relie
 * son propre compte Google ; son jeton de rafraîchissement est chiffré dans sa ligne de `google_acces`.
 *
 * Serveur sur l'ordinateur : client « Application de bureau », retour sur une boucle locale
 * http://127.0.0.1:<port> ouverte le temps de la connexion. Serveur hébergé (CODE_PUBLIC_URL) : client
 * « Application Web », retour sur `<adresse publique>/google/retour`, depuis n'importe quel appareil.
 *
 * Projet Google Cloud en mode test : le jeton de rafraîchissement expire 7 jours après la connexion.
 * Google répond alors `invalid_grant` : CODE passe à l'état « expire » et demande de reconnecter.
 */

/** Durée de vie d'un jeton de rafraîchissement en mode test. */
export const TEST_MODE_LIFETIME_MS = 7 * 24 * 3600_000

export const SCOPES = {
  gmailRead: 'https://www.googleapis.com/auth/gmail.readonly',
  /** Brouillons et envoi. */
  gmailCompose: 'https://www.googleapis.com/auth/gmail.compose',
  agenda: 'https://www.googleapis.com/auth/calendar.events',
  /** Tout le Drive en lecture (Docs, Sheets, PDF…), Sheets compris. */
  driveRead: 'https://www.googleapis.com/auth/drive.readonly',
  /** Création de fichiers : rangés dans le dossier « CODE 2.0 ». */
  driveFile: 'https://www.googleapis.com/auth/drive.file',
  /** Écrire dans un Google Sheets existant (tableur_ecrire, toujours après « oui »). */
  sheets: 'https://www.googleapis.com/auth/spreadsheets',
  /** Les contacts, en lecture seule (contacts_chercher). */
  contacts: 'https://www.googleapis.com/auth/contacts.readonly',
  /** Les « autres contacts » : les gens avec qui il a échangé des mails, sans les avoir enregistrés. */
  autresContacts: 'https://www.googleapis.com/auth/contacts.other.readonly'
} as const

/** CODE_GOOGLE_URL : faux Google des tests de bout en bout (le trousseau n'est alors ni lu ni modifié). */
const FAKE = process.env.CODE_GOOGLE_URL?.replace(/\/$/, '')

export const endpoints = {
  auth: FAKE ? `${FAKE}/auth` : 'https://accounts.google.com/o/oauth2/v2/auth',
  token: FAKE ? `${FAKE}/token` : 'https://oauth2.googleapis.com/token',
  revoke: FAKE ? `${FAKE}/revoke` : 'https://oauth2.googleapis.com/revoke',
  gmail: FAKE ? `${FAKE}/gmail/v1` : 'https://gmail.googleapis.com/gmail/v1',
  gmailUpload: FAKE ? `${FAKE}/upload/gmail/v1` : 'https://gmail.googleapis.com/upload/gmail/v1',
  calendar: FAKE ? `${FAKE}/calendar/v3` : 'https://www.googleapis.com/calendar/v3',
  drive: FAKE ? `${FAKE}/drive/v3` : 'https://www.googleapis.com/drive/v3',
  driveUpload: FAKE ? `${FAKE}/upload/drive/v3` : 'https://www.googleapis.com/upload/drive/v3',
  sheets: FAKE ? `${FAKE}/sheets/v4` : 'https://sheets.googleapis.com/v4',
  people: FAKE ? `${FAKE}/people/v1` : 'https://people.googleapis.com/v1'
}

/** Ce qui est chiffré dans `google_acces` (et était rangé dans le trousseau sous GOOGLE_TOKEN avant le multi-utilisateur). */
export type StoredToken = { refresh: string; obtenu: number; email?: string; scopes: string[] }

/** Le compte n'est pas (ou plus) utilisable : Claude doit le dire, l'interface propose de reconnecter. */
export class GoogleAccessError extends Error {
  constructor(
    message: string,
    readonly etat: 'non_configure' | 'deconnecte' | 'expire'
  ) {
    super(message)
  }
}

const RECONNECT = 'Reconnectez Google dans Réglages › Connecteurs.'

/** Retour de Google sur un serveur hébergé. */
export const GOOGLE_PATH = '/google/retour'

const heberge = () => !!codeConfig.server.publicUrl
const retourHeberge = () => `${codeConfig.server.publicUrl}${GOOGLE_PATH}`

/** Ouvre une page dans le navigateur de l'ordinateur qui fait tourner le serveur. */
function ouvrir(url: string): void {
  if (FAKE) return
  if (process.platform === 'darwin') execFile('open', [url], () => {})
  else if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url.replace(/&/g, '^&')], () => {})
  else execFile('xdg-open', [url], () => {})
}

/**
 * Identifiants d'un client OAuth tels que la console Google les donne, nettoyés, ou pourquoi ils sont refusés.
 * L'identifiant finit par `.apps.googleusercontent.com` ; le code secret commence en général par `GOCSPX-`.
 */
export function checkClient(rawId: unknown, rawSecret: unknown): { id: string; secret: string } | { erreur: string } {
  const id = typeof rawId === 'string' ? rawId.trim() : ''
  const secret = typeof rawSecret === 'string' ? rawSecret.trim() : ''
  if (!/^[\w-]{6,}\.apps\.googleusercontent\.com$/.test(id)) return { erreur: 'L’ID client se termine par « .apps.googleusercontent.com » : copiez-le depuis la page du client, dans la console Google.' }
  if (secret.length < 10 || secret.length > 200 || !/^[\x21-\x7e]+$/.test(secret)) return { erreur: 'Code secret illisible : copiez le « Code secret du client » tel quel, sans espace.' }
  return { id, secret }
}

// ── Fonctions pures (testées) ─────────────────────────────────────────────

/** Fin probable de l'accès et temps restant, d'après la date de connexion. */
export function tokenLife(obtenu: number, now = Date.now()): { expireLe: number; restantMs: number; bientot: boolean } {
  const expireLe = obtenu + TEST_MODE_LIFETIME_MS
  const restantMs = expireLe - now
  return { expireLe, restantMs, bientot: restantMs < 24 * 3600_000 }
}

/** « expire dans 5 jours », « expire demain », « expire dans 3 h », « a sans doute expiré ». */
export function describeExpiry(obtenu: number, now = Date.now()): string {
  const { restantMs } = tokenLife(obtenu, now)
  if (restantMs <= 0) return 'a sans doute expiré'
  const heures = Math.floor(restantMs / 3600_000)
  if (heures < 1) return 'expire dans moins d’une heure'
  if (heures < 24) return `expire dans ${heures} h`
  const jours = Math.floor(heures / 24)
  return jours === 1 ? 'expire demain' : `expire dans ${jours} jours`
}

/**
 * Réponse d'échec du point de jeton : `expire` quand le jeton de rafraîchissement n'est plus valable
 * (7 jours écoulés, accès révoqué, mot de passe changé), `temporaire` sinon (réseau, quota, panne).
 */
export function classifyTokenError(status: number, body: unknown): 'expire' | 'temporaire' {
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
  if (error === 'invalid_grant') return 'expire'
  if (status === 400 && error === 'unauthorized_client') return 'expire'
  return 'temporaire'
}

const b64url = (buf: Buffer) => buf.toString('base64url')

/** PKCE (RFC 7636) : vérificateur gardé ici, défi envoyé à Google. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}

export function authUrl(clientId: string, redirect: string, challenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: Object.values(SCOPES).join(' '),
    access_type: 'offline',
    // Toujours redemander le consentement : sans lui, Google ne renvoie pas de nouveau jeton de rafraîchissement.
    prompt: 'consent',
    include_granted_scopes: 'true',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  })
  return `${endpoints.auth}?${params}`
}

// ── Comptes (un par utilisateur) ──────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS google_acces (
    utilisateur_id INTEGER PRIMARY KEY REFERENCES utilisateurs(id),
    jeton TEXT NOT NULL,
    maj INTEGER NOT NULL
  );
`)

const q = {
  get: db.prepare('SELECT jeton FROM google_acces WHERE utilisateur_id = ?'),
  set: db.prepare('INSERT INTO google_acces (utilisateur_id, jeton, maj) VALUES (?, ?, ?) ON CONFLICT (utilisateur_id) DO UPDATE SET jeton = excluded.jeton, maj = excluded.maj'),
  remove: db.prepare('DELETE FROM google_acces WHERE utilisateur_id = ?'),
  users: db.prepare('SELECT utilisateur_id AS uid FROM google_acces WHERE utilisateur_id IS NOT NULL')
}

const contexte = (uid: number) => `google:${uid}`

function loadToken(uid: number): StoredToken | null {
  const row = q.get.get(uid) as { jeton: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(decrypt(row.jeton, contexte(uid))) as StoredToken
  } catch {
    console.warn(`[google] Accès de l’utilisateur ${uid} illisible : il devra reconnecter Google.`)
    return null
  }
}

function saveToken(uid: number, t: StoredToken): void {
  q.set.run(uid, encrypt(JSON.stringify(t), contexte(uid)), Date.now())
}

let client: { id: string; secret: string } | null = null
/** D'où vient le client : environnement ou trousseau (`serveur`), Réglages du propriétaire (`reglages`). */
let clientSource: GoogleStatus['identifiants'] = null

db.exec(`
  CREATE TABLE IF NOT EXISTS google_client (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    valeur TEXT NOT NULL,
    maj INTEGER NOT NULL
  );
`)

const qClient = {
  get: db.prepare('SELECT valeur FROM google_client WHERE id = 1'),
  set: db.prepare('INSERT INTO google_client (id, valeur, maj) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET valeur = excluded.valeur, maj = excluded.maj')
}

function clientRange(): { id: string; secret: string } | null {
  const row = qClient.get.get() as { valeur: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(decrypt(row.valeur, 'google:client')) as { id: string; secret: string }
  } catch {
    console.warn('[google] Identifiants du client illisibles (clé maîtresse changée ?) : à recoller dans Réglages › Connecteurs.')
    return null
  }
}

type Account = {
  uid: number
  stored: StoredToken | null
  access: { token: string; expires: number } | null
  refreshing: Promise<string> | null
  etat: GoogleStatus['etat']
  lastError: string
  flow: { server: Server; url: string; timer: NodeJS.Timeout } | null
  /** Hébergé : la page de consentement de la connexion en cours (le retour passe par `GOOGLE_PATH`). */
  pageHebergee: string | null
}

const accounts = new Map<number, Account>()

function account(uid: number): Account {
  let a = accounts.get(uid)
  if (!a) {
    const stored = loadToken(uid)
    a = { uid, stored, access: null, refreshing: null, etat: !client ? 'non_configure' : stored ? 'connecte' : 'deconnecte', lastError: '', flow: null, pageHebergee: null }
    accounts.set(uid, a)
  }
  return a
}

const listeners = new Set<(uid: number, s: GoogleStatus) => void>()

/** Changement d'état du compte Google d'un utilisateur (connexion, expiration, déconnexion). */
export function onGoogleStatus(fn: (uid: number, s: GoogleStatus) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function setEtat(a: Account, next: GoogleStatus['etat'], error = ''): void {
  a.etat = next
  a.lastError = error
  const s = statusOf(a)
  for (const fn of listeners) fn(a.uid, s)
}

/** État du compte Google de l'utilisateur (par défaut : l'utilisateur courant). */
export function googleStatus(uid = currentUserId(), now = Date.now()): GoogleStatus {
  return statusOf(account(uid), now)
}

function statusOf(a: Account, now = Date.now()): GoogleStatus {
  const { etat, stored } = a
  const scopes = new Set(stored?.scopes ?? [])
  const base = {
    etat,
    mode: heberge() ? ('heberge' as const) : ('local' as const),
    ...(heberge() ? { retour: retourHeberge() } : {}),
    identifiants: clientSource,
    gmail: etat === 'connecte' && scopes.has(SCOPES.gmailRead),
    agenda: etat === 'connecte' && scopes.has(SCOPES.agenda),
    drive: etat === 'connecte' && scopes.has(SCOPES.driveRead),
    ...(stored?.email ? { email: stored.email } : {}),
    ...(stored ? { expireLe: tokenLife(stored.obtenu, now).expireLe } : {})
  }
  switch (etat) {
    case 'non_configure':
      return { ...base, message: 'Google n’est pas encore relié à cette installation : le propriétaire colle les identifiants de son projet Google Cloud dans Réglages › Connecteurs.' }
    case 'deconnecte':
      return { ...base, message: 'Google n’est pas connecté.' }
    case 'connexion':
      return {
        ...base,
        message: a.pageHebergee ? 'Validez l’accès dans la page Google.' : 'Validez l’accès dans la page Google ouverte dans le navigateur de cet ordinateur.',
        ...(a.flow ? { url: a.flow.url } : a.pageHebergee ? { url: a.pageHebergee } : {})
      }
    case 'expire':
      return { ...base, message: 'L’accès Google a expiré (7 jours en mode test). Reconnectez Google.' }
    case 'erreur':
      return { ...base, message: `Google injoignable : ${a.lastError}` }
    case 'connecte':
      return { ...base, message: `Connecté${stored?.email ? ` · ${stored.email}` : ''} · ${describeExpiry(stored!.obtenu, now)}` }
  }
}

/**
 * Charge les identifiants du client, reprend l'accès d'avant le multi-utilisateur (GOOGLE_TOKEN du
 * trousseau, ou de l'environnement avec le faux Google) pour le premier utilisateur, puis vérifie que
 * l'accès de chaque utilisateur connecté répond encore.
 */
export async function initGoogle(): Promise<void> {
  // Faux Google des tests : uniquement les variables d'environnement, jamais le trousseau.
  const read = (name: 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'GOOGLE_TOKEN') => (FAKE ? Promise.resolve(process.env[name]) : getSecret(name))
  const [id, secret, legacy] = await Promise.all([read('GOOGLE_CLIENT_ID'), read('GOOGLE_CLIENT_SECRET'), read('GOOGLE_TOKEN')])
  if (id && secret) {
    client = { id, secret }
    clientSource = 'serveur'
  } else {
    client = clientRange()
    clientSource = client ? 'reglages' : null
  }
  if (legacy) {
    const owner = ensureOwner()
    if (!q.get.get(owner)) {
      try {
        saveToken(owner, JSON.parse(legacy) as StoredToken)
        console.log('[google] Accès Google existant rattaché au premier utilisateur.')
      } catch {
        console.warn('[google] GOOGLE_TOKEN illisible : pas repris.')
      }
    }
  }
  accounts.clear()
  if (!client) return
  await Promise.all(
    (q.users.all() as { uid: number }[]).map(({ uid }) => {
      const a = account(uid)
      if (!a.stored) return
      return accessToken(uid).then(
        () => console.log(`[google] Utilisateur ${uid} connecté${a.stored?.email ? ` : ${a.stored.email}` : ''} (${describeExpiry(a.stored!.obtenu)})`),
        (err) => console.warn(`[google] Utilisateur ${uid} : ${err instanceof Error ? err.message : err}`)
      )
    })
  )
}

/** Jeton d'accès valable (rafraîchi au besoin). Lève GoogleAccessError si le compte doit être (re)connecté. */
export async function accessToken(uid = currentUserId()): Promise<string> {
  const a = account(uid)
  if (a.access && a.access.expires > Date.now() + 60_000) return a.access.token
  if (!client) throw new GoogleAccessError('Google n’est pas encore relié à cette installation : le propriétaire colle les identifiants de son projet Google Cloud dans Réglages › Connecteurs.', 'non_configure')
  if (!a.stored) throw new GoogleAccessError(`Google n’est pas connecté. ${RECONNECT}`, 'deconnecte')
  if (a.etat === 'expire') throw new GoogleAccessError(`L’accès Google a expiré (7 jours en mode test). ${RECONNECT}`, 'expire')
  a.refreshing ??= refresh(a, client, a.stored).finally(() => (a.refreshing = null))
  return a.refreshing
}

async function refresh(a: Account, c: { id: string; secret: string }, s: StoredToken): Promise<string> {
  let res: Response
  try {
    res = await fetch(endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: s.refresh, grant_type: 'refresh_token' }),
      signal: AbortSignal.timeout(15_000)
    })
  } catch (err) {
    setEtat(a, 'erreur', 'réseau')
    throw new Error(`Google injoignable (${err instanceof Error ? err.message : err}).`)
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!res.ok || !body.access_token) {
    a.access = null
    if (classifyTokenError(res.status, body) === 'expire') {
      setEtat(a, 'expire')
      throw new GoogleAccessError(`L’accès Google a expiré (7 jours en mode test). ${RECONNECT}`, 'expire')
    }
    setEtat(a, 'erreur', body.error_description || body.error || `HTTP ${res.status}`)
    throw new Error(`Google refuse le rafraîchissement : ${body.error_description || body.error || res.status}.`)
  }
  a.access = { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 }
  if (a.etat !== 'connecte') setEtat(a, 'connecte')
  return a.access.token
}

/** L'accès en service de cet utilisateur, et sa fin probable ; null s'il n'est pas connecté. */
export function googleCompte(uid: number, now = Date.now()): { obtenu: number; expireLe: number } | null {
  const a = account(uid)
  if (!client || a.etat !== 'connecte' || !a.stored) return null
  return { obtenu: a.stored.obtenu, expireLe: tokenLife(a.stored.obtenu, now).expireLe }
}

/** Le jeton d'accès vient d'être refusé (401) : on en redemandera un. */
export function dropAccessToken(uid = currentUserId()): void {
  account(uid).access = null
}

/** Un 401 juste après un rafraîchissement réussi : l'accès a été retiré côté Google. */
export function markExpired(uid = currentUserId()): void {
  const a = account(uid)
  a.access = null
  setEtat(a, 'expire')
}

// ── Identifiants du client (propriétaire) ────────────────────────────────

/**
 * Relie l'installation au client OAuth du propriétaire. Google est interrogé avec un jeton factice : il répond
 * `invalid_client` si l'ID ou le code secret est faux, `invalid_grant` s'ils sont bons. Sans réseau, les
 * identifiants sont gardés tels quels (la connexion le dira).
 */
export async function setGoogleClient(rawId: unknown, rawSecret: unknown): Promise<{ ok: boolean; message: string }> {
  if (clientSource === 'serveur') return { ok: false, message: 'Les identifiants Google viennent de la configuration du serveur (GOOGLE_CLIENT_ID) : changez-les là.' }
  const c = checkClient(rawId, rawSecret)
  if ('erreur' in c) return { ok: false, message: c.erreur }
  let verifie = false
  try {
    const res = await fetch(endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: 'verification', grant_type: 'refresh_token' }),
      signal: AbortSignal.timeout(10_000)
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (body.error === 'invalid_client' || body.error === 'unauthorized_client') return { ok: false, message: 'Google ne reconnaît pas ces identifiants : vérifiez l’ID client et le code secret (même client, sans espace).' }
    verifie = body.error === 'invalid_grant'
  } catch {}
  qClient.set.run(encrypt(JSON.stringify(c), 'google:client'), Date.now())
  client = c
  clientSource = 'reglages'
  // Chacun garde son accès ; ceux qui n'en avaient pas peuvent maintenant se connecter.
  for (const a of accounts.values()) {
    a.access = null
    if (a.etat === 'non_configure') setEtat(a, a.stored ? 'connecte' : 'deconnecte')
  }
  console.log(`[google] Client OAuth enregistré depuis les Réglages${verifie ? ' (vérifié auprès de Google)' : ''}`)
  return { ok: true, message: verifie ? 'Identifiants reconnus par Google. Vous pouvez connecter votre compte.' : 'Identifiants enregistrés (Google n’a pas pu les vérifier tout de suite). Vous pouvez essayer de connecter votre compte.' }
}

// ── Connexion (consentement dans le navigateur) ───────────────────────────

/** Connexions hébergées en cours, par `state` : Google revient sur l'adresse publique du serveur. */
const enAttente = new Map<string, { uid: number; verifier: string; avant: GoogleStatus['etat']; timer: NodeJS.Timeout }>()

/**
 * Commence la connexion de cet utilisateur et renvoie la page de consentement Google. Serveur sur
 * l'ordinateur : elle s'ouvre dans son navigateur, et une boucle locale attend le retour. Hébergé : l'écran
 * l'ouvre, Google revient sur `GOOGLE_PATH`.
 */
export async function startGoogleConnect(uid: number): Promise<string> {
  if (!client) await initGoogle()
  if (!client) throw new Error('Google n’est pas encore relié à cette installation : suivez le guide dans Réglages › Connecteurs.')
  const a = account(uid)
  if (a.flow) {
    // Onglet fermé par mégarde : on rouvre la même page.
    ouvrir(a.flow.url)
    return a.flow.url
  }
  const c = client
  const avant = a.etat === 'connexion' ? 'deconnecte' : a.etat
  const { verifier, challenge } = pkcePair()
  const state = b64url(randomBytes(18))

  if (heberge()) {
    for (const [k, p] of enAttente) if (p.uid === uid) (clearTimeout(p.timer), enAttente.delete(k))
    const timer = setTimeout(() => {
      if (!enAttente.delete(state)) return
      a.pageHebergee = null
      if (a.etat === 'connexion') setEtat(a, avant)
    }, 10 * 60_000)
    timer.unref()
    enAttente.set(state, { uid, verifier, avant, timer })
    const url = authUrl(c.id, retourHeberge(), challenge, state)
    a.pageHebergee = url
    setEtat(a, 'connexion')
    return url
  }

  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const url = authUrl(c.id, redirect, challenge, state)
  const end = (next: GoogleStatus['etat'], error = '') => {
    if (!a.flow || a.flow.server !== server) return
    clearTimeout(a.flow.timer)
    a.flow = null
    server.close()
    setEtat(a, next, error)
  }
  const timer = setTimeout(() => end(avant), 5 * 60_000)
  a.flow = { server, url, timer }

  server.on('request', (req, res) => {
    const q = new URL(req.url ?? '/', redirect)
    if (q.pathname !== '/') return void res.writeHead(404).end()
    if (q.searchParams.get('state') !== state) return repondre(res, false, 'Lien invalide', 'Cette page ne vient pas de la connexion en cours. Relancez-la depuis Réglages › Connecteurs.')
    void terminer(a, c, q.searchParams, verifier, redirect).then((r) => {
      repondre(res, r.ok, r.titre, r.texte)
      end(r.etat ?? avant, r.erreur)
    })
  })

  setEtat(a, 'connexion')
  ouvrir(url)
  return url
}

/** Ce que Google a renvoyé : refus, code à échanger. */
async function terminer(
  a: Account,
  c: { id: string; secret: string },
  params: URLSearchParams,
  verifier: string,
  redirect: string
): Promise<{ ok: boolean; titre: string; texte: string; etat?: GoogleStatus['etat']; erreur?: string }> {
  if (params.get('error')) return { ok: false, titre: 'Accès refusé', texte: 'Google n’a pas donné l’accès. Rien n’a changé ; vous pouvez relancer la connexion depuis Réglages › Connecteurs.' }
  const code = params.get('code')
  if (!code) return { ok: false, titre: 'Réponse incomplète', texte: 'Google n’a pas renvoyé de code. Relancez la connexion depuis Réglages › Connecteurs.' }
  try {
    const email = await exchange(a, c, code, verifier, redirect)
    console.log(`[google] Utilisateur ${a.uid} connecté${email ? ` : ${email}` : ''}`)
    return { ok: true, titre: 'Google est connecté', texte: `${email ? `Compte ${email}. ` : ''}Vous pouvez fermer cet onglet. Tant que le projet Google reste en mode test, Google demandera de reconnecter dans 7 jours ; vous serez prévenu la veille.`, etat: 'connecte' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, titre: 'Connexion impossible', texte: message, etat: 'erreur', erreur: message }
  }
}

function repondre(res: ServerResponse, ok: boolean, titre: string, texte: string): void {
  res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(page(ok, titre, texte))
}

/** Retour de Google sur le serveur hébergé (`GOOGLE_PATH`). */
export async function serveGoogleReturn(url: URL, res: ServerResponse): Promise<void> {
  const state = url.searchParams.get('state') ?? ''
  const p = enAttente.get(state)
  if (!p || !client) return repondre(res, false, 'Lien expiré', 'Cette connexion n’est plus en cours (10 minutes au plus). Relancez-la depuis Réglages › Connecteurs.')
  enAttente.delete(state)
  clearTimeout(p.timer)
  const a = account(p.uid)
  a.pageHebergee = null
  const r = await terminer(a, client, url.searchParams, p.verifier, retourHeberge())
  repondre(res, r.ok, r.titre, r.texte)
  setEtat(a, r.etat ?? p.avant, r.erreur)
}

async function exchange(a: Account, c: { id: string; secret: string }, code: string, verifier: string, redirect: string): Promise<string | undefined> {
  const res = await fetch(endpoints.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(15_000)
  })
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string; error?: string }
  if (!res.ok || !body.access_token) throw new Error(`Google refuse l’échange : ${body.error_description || body.error || res.status}.`)
  if (!body.refresh_token) throw new Error('Google n’a pas fourni d’accès durable. Retirez l’application de myaccount.google.com/permissions, puis reconnectez.')
  const scopes = (body.scope ?? '').split(/\s+/).filter(Boolean)
  a.access = { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 }
  let email: string | undefined
  if (scopes.includes(SCOPES.gmailRead)) {
    const profile = await fetch(`${endpoints.gmail}/users/me/profile`, { headers: { Authorization: `Bearer ${body.access_token}` } })
    if (profile.ok) email = ((await profile.json()) as { emailAddress?: string }).emailAddress
  }
  a.stored = { refresh: body.refresh_token, obtenu: Date.now(), scopes, ...(email ? { email } : {}) }
  saveToken(a.uid, a.stored)
  return email
}

/** Retire l'accès de cet utilisateur : jeton révoqué chez Google (au mieux) et effacé de la base. */
export async function disconnectGoogle(uid: number): Promise<void> {
  const a = account(uid)
  const token = a.stored?.refresh
  a.stored = null
  a.access = null
  q.remove.run(uid)
  if (token) await fetch(`${endpoints.revoke}?${new URLSearchParams({ token })}`, { method: 'POST', signal: AbortSignal.timeout(10_000) }).catch(() => {})
  // L'ancien emplacement (d'avant le multi-utilisateur) ne doit pas le faire revenir au prochain démarrage.
  if (!FAKE && uid === ensureOwner()) await deleteSecret('GOOGLE_TOKEN').catch(() => {})
  setEtat(a, client ? 'deconnecte' : 'non_configure')
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

/** Page affichée dans le navigateur au retour de Google. */
function page(ok: boolean, title: string, text: string): string {
  const tone = ok ? '#46d7ff' : '#ffb547'
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CODE 2.0 · Google</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#04070b;color:#e6f4fa;font:16px/1.5 system-ui,sans-serif}
main{max-width:440px;padding:32px;border:1px solid ${tone}55;box-shadow:0 0 60px ${tone}22,inset 0 0 40px ${tone}0d;background:rgba(8,18,25,.85)}
b{display:block;font:600 12px ui-monospace,monospace;letter-spacing:.24em;color:${tone};margin-bottom:14px}h1{font-size:22px;margin:0 0 10px}p{margin:0;color:#c9dce5}</style></head>
<body><main><b>CODE 2.0 · ${ok ? 'ACCÈS ACCORDÉ' : 'ACCÈS NON ACCORDÉ'}</b><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></main></body></html>`
}

// ── Appels aux API ────────────────────────────────────────────────────────

/** Appel authentifié à une API Google ; réessaie une fois avec un jeton neuf sur un 401. */
type GoogleInit = {
  method?: string
  /** Corps JSON. */
  body?: unknown
  /** Corps brut (envoi de fichier) et son type. */
  raw?: { data: Buffer | string; type: string }
  query?: Record<string, string | number | undefined>
}

/**
 * Requête authentifiée : nouvel essai après un 401 (jeton d'accès périmé), erreurs Google traduites.
 * Renvoie la réponse brute (export de fichier, téléchargement) ; googleFetch pour du JSON.
 */
export async function googleRequest(url: string, init: GoogleInit = {}): Promise<Response> {
  const full = new URL(url)
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) full.searchParams.set(k, String(v))
  const uid = currentUserId()
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken(uid)
    const res = await fetch(full, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.raw ? { 'Content-Type': init.raw.type } : init.body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      ...(init.raw ? { body: init.raw.data } : init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(30_000)
    })
    if (res.status === 401) {
      if (attempt === 0) {
        dropAccessToken(uid)
        continue
      }
      markExpired(uid)
      throw new GoogleAccessError(`L’accès Google a été retiré. ${RECONNECT}`, 'expire')
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } }
      if (res.status === 403 && /insufficient|scope/i.test(`${body.error?.status} ${body.error?.message}`)) {
        throw new GoogleAccessError(`Autorisation Google insuffisante : reconnectez Google en acceptant tous les accès demandés. ${RECONNECT}`, 'deconnecte')
      }
      throw new Error(`Google (${res.status}) : ${body.error?.message ?? 'erreur inconnue'}`)
    }
    return res
  }
}

export async function googleFetch<T>(url: string, init: GoogleInit = {}): Promise<T> {
  const res = await googleRequest(url, init)
  if (res.status === 204) return undefined as T
  return (await res.json().catch(() => ({}))) as T
}

/** Adresse du compte de l'utilisateur courant (pour reconnaître « moi » dans les fils). */
export function googleEmail(): string | undefined {
  return account(currentUserId()).stored?.email
}
