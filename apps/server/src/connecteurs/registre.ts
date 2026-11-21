import type { ConnecteurInfo } from '@code/protocol'
import { listUsers } from '../users/users.ts'
import type { Tool } from '../tools/types.ts'
import { serviceOf } from './catalogue.ts'
import { Connexion, pendingFor } from './mcp.ts'
import { projetTool } from './projet.ts'
import { accesOf, listConnecteurs, type Connecteur } from './store.ts'

/** Les connexions de chaque utilisateur, une par connecteur enregistré ; jamais partagées. */
const byUser = new Map<number, Map<number, Connexion>>()

/** Préfixe des outils : l'identifiant du service, ou « mcp<id> » pour un serveur ajouté à la main. */
const prefixOf = (c: Connecteur) => (serviceOf(c.service) ? c.service : `mcp${c.id}`)

/** Ses connexions, accordées à ce qui est enregistré (un connecteur retiré ferme la sienne). */
export function connexionsFor(uid: number): Connexion[] {
  let mine = byUser.get(uid)
  if (!mine) byUser.set(uid, (mine = new Map()))
  const saved = listConnecteurs(uid)
  for (const [id, cx] of mine) {
    if (!saved.some((c) => c.id === id)) {
      cx.close()
      mine.delete(id)
    }
  }
  for (const c of saved) if (!mine.has(c.id)) mine.set(c.id, new Connexion(c, prefixOf(c), serviceOf(c.service)?.consigne))
  return [...mine.values()]
}

export function connexion(uid: number, id: number): Connexion | null {
  return connexionsFor(uid).find((cx) => cx.c.id === id) ?? null
}

/** Services dont CODE lit lui-même l'état des projets (`projet.ts`). */
const DEV = new Set(['github', 'vercel', 'expo'])

/** Les outils de ses connecteurs connectés, et l'état d'un projet dès qu'un service de développement l'est. */
export function connecteurTools(uid: number): Tool[] {
  const cxs = [...(byUser.get(uid)?.values() ?? [])]
  const dev = cxs.some((cx) => DEV.has(cx.c.service) && cx.tools().length)
  return [...(dev ? [projetTool] : []), ...cxs.flatMap((cx) => cx.tools())]
}

/** Les noms de ses connecteurs connectés, pour le prompt (« GitHub », « Figma »). */
export function connecteursConnectes(uid: number): string[] {
  return [...(byUser.get(uid)?.values() ?? [])].filter((cx) => cx.tools().length).map((cx) => cx.c.libelle)
}

/** Son Home Assistant relié, pour les touchers de l'écran (allumer une lampe, reprendre l'image d'une caméra). */
export function maisonDe(uid: number): Connexion['maison'] {
  return connexionsFor(uid).find((cx) => cx.c.service === 'homeassistant' && cx.maison)?.maison ?? null
}

/** Ce que l'écran voit de ses connecteurs (jamais l'accès). */
export function connecteursInfo(uid: number): ConnecteurInfo[] {
  return connexionsFor(uid).map((cx) => ({ id: cx.c.id, service: cx.c.service, libelle: cx.c.libelle, url: cx.c.url, ...cx.status(), ...(serviceOf(cx.c.service)?.complement && accesOf(cx.c).complement ? { complement: true } : {}) }))
}

/** Connecte (ou rafraîchit) les connecteurs de chacun ; appelé au démarrage puis toutes les 5 minutes. */
export async function refreshConnecteurs(): Promise<void> {
  await Promise.all(listUsers().flatMap((u) => connexionsFor(u.id).map((cx) => cx.init())))
}

type Listener = (uid: number, libelle: string, ok: boolean) => void
let listener: Listener = () => {}

/** Prévenu quand un consentement OAuth revient du navigateur (la passerelle met à jour les écrans). */
export function onConnecteurAutorise(fn: Listener): void {
  listener = fn
}

/** Retour du navigateur après le consentement ; renvoie ce que la page affiche. */
export async function finishOAuth(state: string, code: string): Promise<{ ok: boolean; message: string }> {
  const p = pendingFor(state)
  const cx = p && connexion(p.uid, p.id)
  if (!cx) return { ok: false, message: 'Cette demande a expiré. Relancez la connexion depuis CODE 2.0.' }
  try {
    await cx.finish(code)
    const st = cx.status()
    const ok = st.etat === 'connecte'
    listener(cx.c.uid, cx.c.libelle, ok)
    return ok ? { ok, message: `${cx.c.libelle} est relié à CODE 2.0. Vous pouvez fermer cette page.` } : { ok, message: `${cx.c.libelle} : ${st.message || 'connexion impossible'}.` }
  } catch (err) {
    listener(cx.c.uid, cx.c.libelle, false)
    return { ok: false, message: `${cx.c.libelle} : ${err instanceof Error ? err.message : String(err)}` }
  }
}
