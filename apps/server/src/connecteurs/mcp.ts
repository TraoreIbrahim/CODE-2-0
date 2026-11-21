import { randomBytes } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { auth, UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { ConnecteurEtat } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import type { Tool } from '../tools/types.ts'
import { headersFor, serviceOf } from './catalogue.ts'
import { donneesDe, preparerMaps, vueMaps } from './maps.ts'
import { renderConnecteur, titreFr } from './rendu.ts'
import { appsExpo, comptesConnus, estNomSimple, parmi, slugProbable, trouverProjetExpo, type AppExpo } from './expo.ts'
import { resoudre } from './schema.ts'
import { nativeCheck, nativeTools } from './natifs.ts'
import { Maison } from './maison.ts'
import { accesOf, updateAcces, type Connecteur } from './store.ts'

/**
 * Un connecteur MCP d'un utilisateur : CODE se connecte au serveur MCP du service (Figma, GitHub, Vercel…)
 * avec son jeton personnel ou son accès OAuth, découvre ses outils et les propose à Claude sous le préfixe
 * du connecteur. Comme pour les autres outils, ceux de lecture s'exécutent seuls ; les autres passent par la
 * carte « VOTRE ACCORD ? » et ne tournent qu'après son oui.
 */

const MAX_FOR_CLAUDE = 40_000
const MAX_DESCRIPTION = 900
const RETRY_MS = 5 * 60_000 - 10_000
/** Une connexion OAuth commencée doit revenir dans ce délai. */
const PENDING_MS = 15 * 60_000

/** Retour du navigateur après le consentement (route servie par `http.ts`). */
export const OAUTH_PATH = '/connecteurs/retour'

/**
 * Où le service renvoie après le consentement : l'adresse publique du serveur hébergé, ou le serveur lui-même
 * sur cet ordinateur (adresse de bouclage, acceptée par les serveurs OAuth pour une application locale).
 */
export function retourOAuth(): string {
  return `${codeConfig.server.publicUrl || `http://127.0.0.1:${codeConfig.server.port}`}${OAUTH_PATH}`
}

type RemoteTool = {
  name: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string }
  /** MCP Apps : l'interface web de l'outil, et qui peut l'appeler (« app » seule : réservé à cette interface). */
  _meta?: { ui?: { resourceUri?: string; visibility?: string[] } }
}

/** Outils réservés à l'interface web d'une MCP App (enregistrer un état, exporter) : pas pour Claude. */
export const appOnly = (t: RemoteTool) => Boolean(t._meta?.ui?.visibility?.length) && !t._meta!.ui!.visibility!.includes('model')

/** Le dessin d'Excalidraw : CODE l'affiche lui-même (voir `schema.ts`). */
const isExcalidrawView = (t: RemoteTool) => t._meta?.ui?.resourceUri?.startsWith('ui://excalidraw') === true

/** En tête de chaque outil Expo : la description du service, tronquée, ne doit pas le faire oublier. */
const PROJET_EXPO = 'Projet : mets simplement son nom dans appFullName (« atlas »), l’identifiant est retrouvé tout seul ; ne le demande jamais à l’utilisateur. La liste des projets : expo_projets.'

/** Schémas gardés pour leur reprise (« restoreCheckpoint »). */
const MAX_SCHEMAS = 30

/** Lecture d'après les annotations du serveur ; sans annotation, d'après le nom (get_, list_, search_…). */
const READ_NAME = /^(get|list|search|read|fetch|find|describe|view|show|query|retrieve|lookup|whoami|check|count|download|export)([_-]|$)/i

export function isReadOnly(t: RemoteTool): boolean {
  if (t.annotations?.readOnlyHint !== undefined) return t.annotations.readOnlyHint
  return READ_NAME.test(t.name)
}

/** « github » + « list_pull_requests » → « github_list_pull_requests » (les noms d'outils de Claude : [a-zA-Z0-9_-], 64 au plus). */
export function toolName(prefix: string, name: string): string {
  return `${prefix}_${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
}

/** Le texte d'un résultat ; à défaut, son contenu structuré en JSON. */
const textOf = (result: Record<string, unknown>) =>
  ((result.content as { type: string; text?: string }[] | undefined) ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n') || (result.structuredContent ? JSON.stringify(result.structuredContent) : '')

/** Les connexions OAuth en cours : l'état renvoyé par le service désigne l'utilisateur et le connecteur. */
const pending = new Map<string, { uid: number; id: number; until: number }>()

export function pendingFor(state: string): { uid: number; id: number } | null {
  const p = pending.get(state)
  pending.delete(state)
  return p && p.until > Date.now() ? p : null
}

/** L'accès OAuth d'un connecteur, rangé chiffré dans sa ligne ; le client s'inscrit lui-même auprès du service (RFC 7591). */
class Provider implements OAuthClientProvider {
  /** Où envoyer l'utilisateur pour son consentement, quand le service le demande. */
  authorizationUrl: URL | null = null

  constructor(private readonly c: Connecteur) {}

  get redirectUrl(): string {
    return retourOAuth()
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'CODE 2.0',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  }

  state(): string {
    const s = randomBytes(24).toString('base64url')
    pending.set(s, { uid: this.c.uid, id: this.c.id, until: Date.now() + PENDING_MS })
    return s
  }

  clientInformation() {
    return accesOf(this.c).oauth?.client
  }

  saveClientInformation(client: NonNullable<ReturnType<Provider['clientInformation']>>): void {
    updateAcces(this.c, (a) => ({ ...a, oauth: { ...a.oauth, client } }))
  }

  tokens() {
    return accesOf(this.c).oauth?.tokens
  }

  saveTokens(tokens: NonNullable<ReturnType<Provider['tokens']>>): void {
    updateAcces(this.c, (a) => ({ ...a, oauth: { ...a.oauth, tokens } }))
  }

  redirectToAuthorization(url: URL): void {
    this.authorizationUrl = url
  }

  saveCodeVerifier(verifier: string): void {
    updateAcces(this.c, (a) => ({ ...a, oauth: { ...a.oauth, verifier } }))
  }

  codeVerifier(): string {
    const v = accesOf(this.c).oauth?.verifier
    if (!v) throw new Error('connexion OAuth à recommencer')
    return v
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    updateAcces(this.c, (a) => {
      const o = { ...a.oauth }
      if (scope === 'all' || scope === 'client') delete o.client
      if (scope === 'all' || scope === 'tokens') delete o.tokens
      if (scope === 'all' || scope === 'verifier') delete o.verifier
      return { ...a, oauth: o }
    })
  }
}

export class Connexion {
  private client: Client | null = null
  private list: Tool[] = []
  private lastAttempt = 0
  private state: ConnecteurEtat = 'inactif'
  private lastError = ''
  private readonly schemas = new Map<string, Record<string, unknown>[]>()
  /** Expo : la liste des projets lue avec le jeton complémentaire, gardée dix minutes. */
  private apps: { at: number; liste: AppExpo[] } | null = null
  /** Home Assistant : l'installation, pour les touchers de l'écran (allumer, image d'une caméra). */
  maison: Maison | null = null

  /** `prefix` : début du nom de ses outils (« github ») ; `consigne` : ce que Claude doit savoir de ce service (en tête de description, avant la coupe). */
  constructor(
    readonly c: Connecteur,
    private readonly prefix: string,
    private readonly consigne = ''
  ) {}

  status(): { etat: ConnecteurEtat; outils: number; actions: number; message: string } {
    return { etat: this.state, outils: this.list.length, actions: this.list.filter((t) => t.risk === 'sensible').length, message: this.lastError }
  }

  tools(): Tool[] {
    return this.list
  }

  private get oauth(): boolean {
    return accesOf(this.c).oauth !== undefined
  }

  /** Jeton (en-têtes du service), OAuth, ou rien (Excalidraw). */
  private transport(): StreamableHTTPClientTransport {
    const { jeton, oauth } = accesOf(this.c)
    if (jeton) return new StreamableHTTPClientTransport(new URL(this.c.url), { requestInit: { headers: headersFor(this.c.service, jeton) } })
    return new StreamableHTTPClientTransport(new URL(this.c.url), oauth ? { authProvider: new Provider(this.c) } : {})
  }

  /** Se connecte et charge les outils ; réessaie au plus toutes les 5 minutes, recharge la liste au même rythme. */
  async init(force = false): Promise<void> {
    if (!force && Date.now() - this.lastAttempt < RETRY_MS) return
    this.lastAttempt = Date.now()
    if (this.oauth && !accesOf(this.c).oauth?.tokens) {
      // Jamais autorisé : rien à tenter avant que l'utilisateur ait donné son accord.
      this.state = 'a_autoriser'
      this.lastError = 'Autorisation à donner'
      return
    }
    const natif = serviceOf(this.c.service)?.natif
    if (natif) {
      // Figma, Vercel : outils de CODE sur leur API, le jeton vérifié par un appel léger.
      try {
        const jeton = accesOf(this.c).jeton ?? ''
        if (natif === 'homeassistant') {
          const m = new Maison(this.c.url, jeton, this.c.libelle)
          await m.verifier()
          this.maison = m
          this.list = m.outils()
        } else {
          await nativeCheck(natif, jeton)
          this.list = nativeTools(natif, this.c.libelle, jeton)
        }
        this.state = 'connecte'
        this.lastError = ''
      } catch (err) {
        this.list = []
        this.maison = null
        this.state = 'erreur'
        this.lastError = err instanceof Error ? err.message : String(err)
        console.warn(`[connecteurs] ${this.c.libelle} (utilisateur ${this.c.uid}) : ${this.lastError}`)
      }
      return
    }
    try {
      if (!this.client) {
        const c = new Client({ name: 'code', version: '0.3.0' })
        await c.connect(this.transport())
        this.client = c
      }
      const { tools } = await this.client.listTools()
      const masques = serviceOf(this.c.service)?.masques ?? []
      this.list = (tools as RemoteTool[]).filter((t) => !appOnly(t) && !masques.includes(t.name)).map((t) => (isExcalidrawView(t) ? this.excalidraw(t) : this.wrap(t)))
      if (this.c.service === 'expo' && accesOf(this.c).complement) this.list.push(this.projetsExpo())
      this.state = 'connecte'
      this.lastError = ''
    } catch (err) {
      void this.client?.close().catch(() => {})
      this.client = null
      this.list = []
      if (err instanceof UnauthorizedError || (this.oauth && !accesOf(this.c).oauth?.tokens)) {
        this.state = 'a_autoriser'
        this.lastError = 'Autorisation à donner'
      } else {
        this.state = 'erreur'
        this.lastError = err instanceof Error ? err.message : String(err)
      }
      console.warn(`[connecteurs] ${this.c.libelle} (utilisateur ${this.c.uid}) : ${this.lastError}`)
    }
  }

  /**
   * Commence la connexion OAuth : renvoie l'adresse du consentement à ouvrir dans le navigateur, ou null si
   * l'accès est déjà valable.
   */
  async authorize(): Promise<string | null> {
    const provider = new Provider(this.c)
    const result = await auth(provider, { serverUrl: this.c.url })
    if (result === 'AUTHORIZED') return null
    return provider.authorizationUrl?.toString() ?? null
  }

  /** Retour du consentement : échange le code contre les jetons, puis se connecte. */
  async finish(code: string): Promise<void> {
    await auth(new Provider(this.c), { serverUrl: this.c.url, authorizationCode: code })
    this.client = null
    await this.init(true)
  }

  close(): void {
    void this.client?.close().catch(() => {})
    this.client = null
    this.list = []
    this.maison = null
  }

  private async call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.client) await this.init(true)
    if (!this.client) throw new Error(`${this.c.libelle} est injoignable pour le moment.`)
    try {
      return (await this.client.callTool({ name, arguments: args })) as Record<string, unknown>
    } catch (err) {
      this.client = null
      throw err
    }
  }

  /** L'outil de dessin d'Excalidraw : le service garde l'état, CODE dessine le schéma dans son panneau. */
  private excalidraw(remote: RemoteTool): Tool {
    const service = this.c.libelle
    return {
      name: toolName(this.prefix, remote.name),
      description: `[${service}, lecture] Dessine un schéma (style croquis) affiché à l'écran de l'utilisateur. ${remote.description ?? ''} Appelle d'abord ${toolName(this.prefix, 'read_me')} pour le format des éléments (une fois par conversation). Libellés en français, sans emoji. Pour modifier le dernier schéma, commence par {"type":"restoreCheckpoint","id":"<id>"} puis ajoute ou supprime ({"type":"delete","ids":"a,b"}).`.slice(0, MAX_DESCRIPTION),
      risk: 'lecture',
      deferred: true,
      ui: { kind: 'schema', title: () => `${service} · Schéma` },
      input_schema: { type: 'object', ...(remote.inputSchema as object) } as Tool['input_schema'],
      validate: (input) => {
        if (typeof input.elements !== 'string') return 'Champ « elements » manquant (tableau JSON en texte).'
        try {
          return Array.isArray(JSON.parse(input.elements)) ? null : '« elements » doit être un tableau JSON.'
        } catch {
          return '« elements » n’est pas du JSON valide (pas de commentaire ni de virgule finale).'
        }
      },
      run: async (input) => {
        const brut = JSON.parse(String(input.elements)) as unknown[]
        const result = await this.call(remote.name, input)
        if (result.isError) return { content: textOf(result) || `Erreur ${service}.`, isError: true, summary: `${service} : schéma (échec)` }
        const id = String((result.structuredContent as { checkpointId?: string } | undefined)?.checkpointId ?? textOf(result).match(/Checkpoint id: "([^"]+)"/)?.[1] ?? `local-${Date.now()}`)
        const { elements, camera } = resoudre(brut, (prev) => this.schemas.get(prev))
        const titre = String(elements.find((e) => e.type === 'text' && typeof e.text === 'string')?.text ?? 'Schéma').split('\n')[0]!.slice(0, 80)
        this.schemas.set(id, elements)
        while (this.schemas.size > MAX_SCHEMAS) this.schemas.delete(this.schemas.keys().next().value!)
        return {
          content: `Le schéma est dessiné à l'écran (${elements.length} éléments, id « ${id} »). Dis-le en une phrase. Pour le modifier, rappelle cet outil en commençant par {"type":"restoreCheckpoint","id":"${id}"}. Depuis le panneau, l'utilisateur peut l'agrandir ou le télécharger pour Excalidraw.`,
          summary: `${service} : schéma « ${titre} »`,
          view: { kind: 'schema', source: service, titre, id, elements, ...(camera ? { camera } : {}) }
        }
      }
    }
  }

  /** Les projets Expo du compte, par le jeton complémentaire (l'API d'Expo, pas le serveur MCP). */
  private async listeExpo(): Promise<AppExpo[]> {
    if (this.apps && Date.now() - this.apps.at < 10 * 60_000) return this.apps.liste
    const liste = await appsExpo(accesOf(this.c).complement ?? '')
    this.apps = { at: Date.now(), liste }
    return liste
  }

  private projetsExpo(): Tool {
    const service = this.c.libelle
    return {
      name: toolName(this.prefix, 'projets'),
      description: `[${service}, lecture] Tous les projets (applications) Expo du compte et de ses organisations : nom, @compte/slug, identifiant. Pour « quelles apps j'ai sur Expo », ou pour retrouver un projet.`,
      risk: 'lecture',
      deferred: true,
      ui: { kind: 'connecteur', title: () => `${service} · Projets` },
      input_schema: { type: 'object', properties: {} },
      validate: () => null,
      run: async () => {
        this.apps = null
        const liste = await this.listeExpo()
        const text = JSON.stringify(liste)
        return {
          content: `${text.slice(0, MAX_FOR_CLAUDE)}\nCe résultat est affiché à l'écran : résume l'essentiel à voix haute.`,
          summary: `${service} : ${liste.length} projet${liste.length > 1 ? 's' : ''}`,
          view: renderConnecteur('expo', service, 'Projets', text)
        }
      }
    }
  }

  /**
   * « atlas » → « @octocat/atlas » avant l'appel ; un identifiant complet passe tel quel. Dans l'ordre : la
   * liste des projets (jeton Expo), le app.json du dépôt GitHub, puis le compte déjà connu (« @octocat/nova »).
   */
  private async projetExpo(input: Record<string, unknown>): Promise<{ input: Record<string, unknown>; note: string } | { erreur: string }> {
    if (!estNomSimple(input.appFullName) || input.appId) return { input, note: '' }
    const nom = input.appFullName
    const { appFullName: _, ...reste } = input
    const avec = (id: string, source: string) => ({ input: { ...reste, appFullName: id }, note: `Projet « ${nom} » : ${id} (${source}). Dis lequel tu as pris.\n` })
    const complement = Boolean(accesOf(this.c).complement)
    const apps = complement ? await this.listeExpo().catch(() => null) : null
    const app = apps && parmi(apps, nom)
    if (app) return avec(app.appFullName, `compte ${app.compte}`)
    const p = await trouverProjetExpo(this.c.uid, nom).catch(() => null)
    if (p) return p.appFullName ? avec(p.appFullName, `dépôt GitHub ${p.depot}`) : { input: { ...reste, appId: p.appId }, note: `Projet « ${nom} » : dépôt GitHub ${p.depot}.\n` }
    if (apps) return { erreur: `Aucun projet Expo ne ressemble à « ${nom} ». Projets du compte : ${apps.map((a) => a.appFullName).join(', ') || 'aucun'}.` }
    const compte = comptesConnus(this.c.uid)[0]
    if (compte) return avec(`@${compte}/${slugProbable(nom)}`, 'supposé d’après votre compte, sans dépôt GitHub trouvé ; s’il n’existe pas, dis-le')
    return { erreur: `Projet Expo « ${nom} » introuvable : pas de dépôt GitHub à ce nom. Pour voir tous les projets, ajoutez un jeton d'accès Expo dans Réglages › Connecteurs › Expo ; sinon demande le nom exact (@compte/projet).` }
  }

  private wrap(remote: RemoteTool): Tool {
    const service = this.c.libelle
    const label = remote.title ?? remote.annotations?.title ?? remote.name
    const titre = titreFr(remote.name, remote.title ?? remote.annotations?.title)
    const read = isReadOnly(remote)
    const props = (remote.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>
    // Expo : un nom de projet suffit (« atlas »), le serveur retrouve l'identifiant (voir expo.ts).
    const projetExpo = this.c.service === 'expo' && 'appFullName' in props
    const description = `[${service}${read ? ', lecture' : ", ACTION : seulement à sa demande explicite ; une carte de validation s'affiche, rien n'est fait avant son oui"}] ${this.consigne ? `(${this.consigne}) ` : ''}${projetExpo ? `${PROJET_EXPO} ` : ''}${remote.description ?? label}`
    const schema = projetExpo ? { ...remote.inputSchema, properties: { ...props, appFullName: { ...props.appFullName, description: '« @compte/slug », ou simplement le nom du projet tel que l’utilisateur le dit (« atlas ») : il est retrouvé.' } } } : remote.inputSchema
    const base = {
      name: toolName(this.prefix, remote.name),
      description: description.slice(0, MAX_DESCRIPTION),
      deferred: true,
      ui: { kind: 'connecteur' as const, title: () => `${service} · ${titre}` },
      input_schema: { type: 'object', ...(schema as object) } as Tool['input_schema'],
      validate: () => null
    }
    if (read) {
      return {
        ...base,
        risk: 'lecture',
        run: async (brut) => {
          const projet = projetExpo ? await this.projetExpo(brut) : { input: brut, note: '' }
          if ('erreur' in projet) return { content: projet.erreur, isError: true, summary: `${service} : projet introuvable` }
          const { note } = projet
          const input = this.c.service === 'maps' ? preparerMaps(remote.name, projet.input) : projet.input
          const result = await this.call(remote.name, input)
          const text = textOf(result)
          if (result.isError) return { content: `${note}${text || `Erreur ${service}.`}`, isError: true, summary: `${service} : ${titre} (échec)` }
          // Google Maps : la carte des lieux ou du trajet, et pour Claude l'essentiel sans tracé ni jetons.
          const maps = this.c.service === 'maps' ? vueMaps(remote.name, input, donneesDe(result, text)) : null
          if (maps) return { content: maps.claude, summary: `${service} : ${titre}`, view: maps.view }
          return {
            content: `${note}${text.slice(0, MAX_FOR_CLAUDE)}${text.length > MAX_FOR_CLAUDE ? '\n(Résultat tronqué.)' : ''}\nCe résultat est affiché à l'écran : résume l'essentiel à voix haute.`,
            summary: `${service} : ${titre}`,
            // « read_me » : le mode d'emploi du service, pour Claude seul.
            ...(remote.name === 'read_me' ? {} : { view: renderConnecteur(this.c.service, service, titre, text) })
          }
        }
      }
    }
    return {
      ...base,
      risk: 'sensible',
      run: async (brut, ctx) => {
        const projet = projetExpo ? await this.projetExpo(brut) : { input: brut, note: '' }
        if ('erreur' in projet) return { content: projet.erreur, isError: true, summary: `${service} : projet introuvable` }
        const { input } = projet
        const details = Object.entries(input)
          .map(([k, v]) => `${k} : ${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join('\n')
          .slice(0, 1200)
        ctx.requestConfirmation(`${service} : ${label}`, details || label, async () => {
          const done = await this.call(remote.name, input)
          const out = textOf(done)
          if (done.isError) {
            ctx.log(`${service} : ${label} refusé — ${out.slice(0, 200)}`)
            ctx.announce(`${service} a refusé : ${out.slice(0, 200)}`)
            return
          }
          ctx.log(`${service} : ${label} fait`)
          ctx.announce(`C'est fait sur ${service}.`)
        })
        return {
          content: `En attente de validation : ${label} sur ${service}.\nUne carte « VOTRE ACCORD ? » est affichée. Annonce en une phrase ce qui va être fait et demande son accord ; ne prétends pas que c'est fait.`,
          summary: `${service} : ${label} (en attente de votre oui)`
        }
      }
    }
  }
}
