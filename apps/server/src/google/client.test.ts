import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Base isolée, faux Google (le trousseau n'est jamais lu), serveur hébergé.
process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-google-'))
process.env.CODE_GOOGLE_URL = 'https://google.invalid'
process.env.CODE_PUBLIC_URL = 'https://assistant.exemple.fr'
delete process.env.GOOGLE_CLIENT_ID
delete process.env.GOOGLE_CLIENT_SECRET
delete process.env.GOOGLE_TOKEN
const { setMasterKey } = await import('../users/crypto.ts')
setMasterKey(randomBytes(32))
const { ensureOwner } = await import('../db.ts')
const google = await import('./oauth.ts')
const { alerteDue } = await import('./alerte.ts')

const ID = '123456789-abcdef.apps.googleusercontent.com'
const SECRET = 'GOCSPX-exemple-de-test'

/** Remplace fetch le temps d'un test : `reponses` dit ce que Google répond, selon l'adresse appelée. */
function fauxGoogle(reponses: (url: string, body: URLSearchParams) => unknown): () => void {
  const avant = globalThis.fetch
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const body = new URLSearchParams(typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body : '')
    return new Response(JSON.stringify(reponses(url, body)), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return () => (globalThis.fetch = avant)
}

function fausseReponse() {
  const r = { status: 0, html: '' }
  const res = {
    writeHead(status: number) {
      r.status = status
      return res
    },
    end(html?: string) {
      r.html = html ?? ''
    }
  } as unknown as ServerResponse
  return { r, res }
}

test('identifiants du client : la forme donnée par la console Google, rien d’autre', () => {
  assert.deepEqual(google.checkClient(`  ${ID} `, ` ${SECRET}\n`), { id: ID, secret: SECRET })
  assert.match((google.checkClient('123456789', SECRET) as { erreur: string }).erreur, /apps\.googleusercontent\.com/)
  assert.match((google.checkClient(ID, 'court') as { erreur: string }).erreur, /Code secret/)
  assert.match((google.checkClient(ID, 'GOCSPX avec espace') as { erreur: string }).erreur, /Code secret/)
})

test('sans client, Google attend le propriétaire ; un client refusé par Google n’est pas gardé', async () => {
  await google.initGoogle()
  const owner = ensureOwner()
  const avant = google.googleStatus(owner)
  assert.equal(avant.etat, 'non_configure')
  assert.equal(avant.identifiants, null)
  assert.match(avant.message, /Réglages › Connecteurs/)
  const fin = fauxGoogle(() => ({ error: 'invalid_client' }))
  try {
    const r = await google.setGoogleClient(ID, SECRET)
    assert.equal(r.ok, false)
    assert.equal(google.googleStatus(owner).etat, 'non_configure')
  } finally {
    fin()
  }
})

test('client reconnu : gardé chiffré, relu au démarrage, et la connexion hébergée revient sur l’adresse publique', async () => {
  const owner = ensureOwner()
  let fin = fauxGoogle(() => ({ error: 'invalid_grant' }))
  try {
    const r = await google.setGoogleClient(ID, SECRET)
    assert.equal(r.ok, true)
    assert.match(r.message, /reconnus/)
  } finally {
    fin()
  }
  await google.initGoogle()
  const s = google.googleStatus(owner)
  assert.equal(s.etat, 'deconnecte')
  assert.equal(s.identifiants, 'reglages')
  assert.equal(s.mode, 'heberge')
  assert.equal(s.retour, 'https://assistant.exemple.fr/google/retour')

  const page = new URL(await google.startGoogleConnect(owner))
  assert.equal(page.searchParams.get('client_id'), ID)
  assert.equal(page.searchParams.get('redirect_uri'), 'https://assistant.exemple.fr/google/retour')
  assert.equal(google.googleStatus(owner).etat, 'connexion')
  assert.equal(google.googleStatus(owner).url, page.toString())

  // Un retour sans la bonne `state` est refusé.
  const faux = fausseReponse()
  await google.serveGoogleReturn(new URL('https://assistant.exemple.fr/google/retour?state=autre&code=x'), faux.res)
  assert.equal(faux.r.status, 400)

  let echange: URLSearchParams | null = null
  fin = fauxGoogle((url, body) => {
    if (url.endsWith('/token')) {
      echange = body
      return { access_token: 'acces', refresh_token: 'durable', expires_in: 3600, scope: Object.values(google.SCOPES).join(' ') }
    }
    return { emailAddress: 'proprietaire@exemple.fr' }
  })
  try {
    const ok = fausseReponse()
    await google.serveGoogleReturn(new URL(`https://assistant.exemple.fr/google/retour?state=${page.searchParams.get('state')}&code=le-code`), ok.res)
    assert.equal(ok.r.status, 200)
    assert.equal(echange!.get('redirect_uri'), 'https://assistant.exemple.fr/google/retour')
    assert.equal(echange!.get('code'), 'le-code')
  } finally {
    fin()
  }
  const apres = google.googleStatus(owner)
  assert.equal(apres.etat, 'connecte')
  assert.equal(apres.email, 'proprietaire@exemple.fr')
  assert.ok(google.googleCompte(owner))
})

test('alerte d’expiration : la veille seulement, une fois par connexion', () => {
  const H = 3600_000
  const compte = { obtenu: 1_000, expireLe: 1_000 + 7 * 24 * H }
  assert.equal(alerteDue(compte, null, compte.expireLe - 30 * H), false, 'trop tôt')
  assert.equal(alerteDue(compte, null, compte.expireLe - 20 * H), true)
  assert.equal(alerteDue(compte, '1000', compte.expireLe - 20 * H), false, 'déjà annoncée')
  assert.equal(alerteDue(compte, '999', compte.expireLe - 20 * H), true, 'nouvelle connexion, nouvelle alerte')
  assert.equal(alerteDue(compte, null, compte.expireLe + H), false, 'déjà expiré : l’écran le dit')
  assert.equal(alerteDue(null, null, 0), false)
})
