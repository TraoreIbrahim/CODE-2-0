import type { TypeAppareil, UiAppareil, UiCamera, UiMaison } from '@code/protocol'
import type { Tool, ToolContext } from '../tools/types.ts'

/**
 * La maison, par Home Assistant : CODE lit ses appareils et leur envoie des commandes par son API REST, avec
 * l'adresse de l'installation et un jeton d'accès longue durée. Home Assistant parle déjà à des milliers de
 * marques (clims, télés, volets, caméras…) ; les appareils à télécommande infrarouge passent par un émetteur
 * (Broadlink, SwitchBot), les plus simples par une prise connectée.
 *
 * Le confort (lumière, clim, ventilateur, télé, volets) s'exécute tout de suite ; ce qui touche à la sécurité
 * (serrure, alarme, portail ou porte de garage, vanne, sirène, caméra, script) attend le « oui » de la carte.
 * Les images des caméras ne sont gardées nulle part.
 */

const DELAI = 10_000
const MAX_FOR_CLAUDE = 30_000
/** Les pièces changent rarement : relues toutes les dix minutes. */
const DUREE_PIECES = 10 * 60_000

export type Etat = { entity_id: string; state: string; attributes: Record<string, unknown>; last_changed?: string }

/** « http://homeassistant.local:8123/ », « …/api », « …/lovelace/0 » → l'adresse de base de l'installation. */
export function baseMaison(brut: string): string {
  const u = new URL(brut.trim())
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('adresse http(s) attendue')
  const chemin = u.pathname.replace(/\/(api|lovelace|dashboard|config|profile|history|logbook|map|energy|media-browser|developer-tools)(\/.*)?$/, '').replace(/\/+$/, '')
  return `${u.origin}${chemin}`
}

// ── Les types d'appareils ──

const SANS_ACCENT = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/** Mots d'un nom, sans accents ni pluriels ni petits mots (« les lumières du salon » → lumiere, salon). */
const VIDES = new Set(['le', 'la', 'les', 'l', 'du', 'de', 'des', 'd', 'en', 'dans', 'au', 'aux', 'a', 'un', 'une', 'et', 'mon', 'ma', 'mes', 'the', 'of'])
export function mots(s: string): string[] {
  return SANS_ACCENT(s.toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((m) => m && !VIDES.has(m))
    .map((m) => (m.length > 3 && /[sx]$/.test(m) ? m.slice(0, -1) : m))
}

type Def = { type: TypeAppareil; libelle: string; synonymes: string }

const DOMAINES: Record<string, Def> = {
  light: { type: 'lumiere', libelle: 'Lumière', synonymes: 'lumiere lampe eclairage plafonnier spot lustre led ampoule light' },
  switch: { type: 'prise', libelle: 'Prise', synonymes: 'prise interrupteur switch plug' },
  input_boolean: { type: 'prise', libelle: 'Interrupteur', synonymes: 'interrupteur' },
  fan: { type: 'ventilateur', libelle: 'Ventilateur', synonymes: 'ventilateur ventilo brasseur fan' },
  climate: { type: 'clim', libelle: 'Clim / chauffage', synonymes: 'clim climatisation climatiseur chauffage radiateur thermostat pompe chaleur ac' },
  water_heater: { type: 'chauffe_eau', libelle: 'Chauffe-eau', synonymes: 'chauffe eau ballon cumulus' },
  cover: { type: 'volet', libelle: 'Volet', synonymes: 'volet store rideau persienne fenetre' },
  media_player: { type: 'media', libelle: 'Télé / son', synonymes: 'tele television tv ecran enceinte musique son radio chromecast' },
  remote: { type: 'media', libelle: 'Télécommande', synonymes: 'telecommande remote' },
  lock: { type: 'serrure', libelle: 'Serrure', synonymes: 'serrure verrou porte lock' },
  alarm_control_panel: { type: 'alarme', libelle: 'Alarme', synonymes: 'alarme alarm securite' },
  camera: { type: 'camera', libelle: 'Caméra', synonymes: 'camera surveillance video cam' },
  vacuum: { type: 'aspirateur', libelle: 'Aspirateur', synonymes: 'aspirateur robot vacuum' },
  humidifier: { type: 'humidificateur', libelle: 'Humidificateur', synonymes: 'humidificateur deshumidificateur' },
  scene: { type: 'scene', libelle: 'Scène', synonymes: 'scene ambiance' },
  script: { type: 'script', libelle: 'Script', synonymes: 'script routine' },
  valve: { type: 'vanne', libelle: 'Vanne', synonymes: 'vanne robinet eau gaz arrosage' },
  siren: { type: 'sirene', libelle: 'Sirène', synonymes: 'sirene' },
  button: { type: 'bouton', libelle: 'Bouton', synonymes: 'bouton' },
  sensor: { type: 'capteur', libelle: 'Capteur', synonymes: 'capteur temperature humidite' },
  binary_sensor: { type: 'detecteur', libelle: 'Détecteur', synonymes: 'detecteur capteur' }
}

/** Portails, portes de garage et portes motorisées : des volets à valider. */
const OUVRANTS_SENSIBLES = new Set(['garage', 'gate', 'door'])
/** Les capteurs utiles à voix haute ; les autres (batteries, signaux…) se comptent par centaines. */
const CAPTEURS = new Set(['temperature', 'humidity', 'carbon_dioxide', 'pm25', 'power'])
const DETECTEURS = new Set(['door', 'window', 'garage_door', 'opening', 'motion', 'occupancy', 'presence', 'smoke', 'moisture', 'gas', 'carbon_monoxide', 'lock'])

const domaine = (id: string) => id.split('.')[0] ?? ''
const classe = (e: Etat) => String(e.attributes.device_class ?? '')

/** L'entité est-elle un appareil qu'on montre (et non l'un des mille capteurs techniques) ? */
export function visible(e: Etat): boolean {
  const d = domaine(e.entity_id)
  if (!DOMAINES[d]) return false
  if (e.attributes.hidden === true) return false
  if (d === 'sensor') return CAPTEURS.has(classe(e))
  if (d === 'binary_sensor') return DETECTEURS.has(classe(e))
  return true
}

export function typeOf(e: Etat): TypeAppareil {
  const d = domaine(e.entity_id)
  if (d === 'cover' && OUVRANTS_SENSIBLES.has(classe(e))) return 'portail'
  return DOMAINES[d]?.type ?? 'prise'
}

/** Ce qui demande un « oui » avant d'agir. */
export function sensible(e: Etat, action?: Action): boolean {
  const d = domaine(e.entity_id)
  if (d === 'lock') return action !== 'verrouiller'
  if (d === 'cover') return OUVRANTS_SENSIBLES.has(classe(e))
  return ['alarm_control_panel', 'camera', 'valve', 'siren', 'script', 'button'].includes(d)
}

const nomDe = (e: Etat) => String(e.attributes.friendly_name ?? e.entity_id.split('.')[1]?.replace(/_/g, ' ') ?? e.entity_id).slice(0, 60)
const nombre = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)
const fr = (n: number, d = 1) => n.toLocaleString('fr-FR', { maximumFractionDigits: d })
const pct = (n: number) => `${Math.round(n)}\u00a0%`

const MODES_CLIM: Record<string, string> = { off: 'arrêt', cool: 'froid', heat: 'chaud', heat_cool: 'auto', auto: 'auto', dry: 'déshumidification', fan_only: 'ventilation' }
const ETATS_VOLET: Record<string, string> = { open: 'ouvert', closed: 'fermé', opening: 'ouverture…', closing: 'fermeture…', stopped: 'arrêté' }
const ETATS_SERRURE: Record<string, string> = { locked: 'verrouillée', unlocked: 'déverrouillée', locking: 'verrouillage…', unlocking: 'déverrouillage…', jammed: 'bloquée', open: 'ouverte', opening: 'ouverture…' }
const ETATS_ALARME: Record<string, string> = {
  disarmed: 'désarmée',
  armed_home: 'armée (présence)',
  armed_away: 'armée (absence)',
  armed_night: 'armée (nuit)',
  armed_vacation: 'armée (vacances)',
  armed_custom_bypass: 'armée',
  arming: 'armement…',
  pending: 'en attente',
  triggered: 'DÉCLENCHÉE',
  disarming: 'désarmement…'
}
const ETATS_MEDIA: Record<string, string> = { off: 'éteinte', on: 'allumée', idle: 'en veille', standby: 'en veille', playing: 'en lecture', paused: 'en pause', buffering: 'chargement…' }
const ETATS_ASPI: Record<string, string> = { cleaning: 'nettoie', docked: 'sur sa base', returning: 'rentre à sa base', idle: 'à l’arrêt', paused: 'en pause', error: 'en erreur' }
const DETECTION: Record<string, [string, string]> = {
  door: ['ouverte', 'fermée'],
  window: ['ouverte', 'fermée'],
  garage_door: ['ouverte', 'fermée'],
  opening: ['ouvert', 'fermé'],
  motion: ['mouvement', 'calme'],
  occupancy: ['occupé', 'libre'],
  presence: ['présence', 'personne'],
  smoke: ['FUMÉE', 'rien'],
  moisture: ['FUITE', 'sec'],
  gas: ['GAZ', 'rien'],
  carbon_monoxide: ['MONOXYDE', 'rien'],
  lock: ['déverrouillée', 'verrouillée']
}
const ALERTES = new Set(['smoke', 'moisture', 'gas', 'carbon_monoxide'])

/** L'état d'un appareil en mots, pour l'écran et pour Claude. */
export function appareil(e: Etat, piece?: string): UiAppareil {
  const d = domaine(e.entity_id)
  const type = typeOf(e)
  const s = e.state
  const a = e.attributes
  const base = { id: e.entity_id, nom: nomDe(e), type, ...(piece ? { piece } : {}), sensible: sensible(e) }
  if (s === 'unavailable' || s === 'unknown') return { ...base, etat: s === 'unknown' ? 'inconnu' : 'hors ligne', actif: false, indisponible: s === 'unavailable', basculable: false }
  let etat = s
  let detail: string | undefined
  let actif = s === 'on'
  let alerte = false
  const marche = s === 'on' ? 'allumé' : s === 'off' ? 'éteint' : s
  switch (d) {
    case 'light': {
      etat = s === 'on' ? 'allumée' : 'éteinte'
      const b = nombre(a.brightness)
      if (s === 'on' && b !== null) detail = pct((b / 255) * 100)
      break
    }
    case 'switch':
    case 'input_boolean':
    case 'humidifier':
    case 'siren':
    case 'remote':
      etat = marche
      break
    case 'fan': {
      etat = marche
      const p = nombre(a.percentage)
      if (s === 'on' && p !== null) detail = `vitesse ${pct(p)}`
      break
    }
    case 'climate': {
      actif = s !== 'off'
      const actuelle = nombre(a.current_temperature)
      const consigne = nombre(a.temperature)
      etat = MODES_CLIM[s] ?? s
      if (actuelle !== null) etat = `${fr(actuelle)}\u00a0°C · ${etat}`
      if (actif && consigne !== null) detail = `consigne ${fr(consigne)}\u00a0°C`
      break
    }
    case 'water_heater': {
      actif = s !== 'off'
      const consigne = nombre(a.temperature)
      etat = actif ? 'en marche' : 'arrêté'
      if (consigne !== null) detail = `consigne ${fr(consigne)}\u00a0°C`
      break
    }
    case 'cover':
    case 'valve': {
      actif = s === 'open' || s === 'opening'
      etat = ETATS_VOLET[s] ?? s
      if (d === 'valve') etat = etat.replace(/^ouvert/, 'ouverte').replace(/^fermé/, 'fermée')
      const p = nombre(a.current_position)
      if (p !== null && p > 0 && p < 100) detail = `ouvert à ${pct(p)}`
      alerte = type === 'portail' && actif
      break
    }
    case 'media_player': {
      actif = !['off', 'standby', 'idle'].includes(s)
      etat = ETATS_MEDIA[s] ?? s
      const titre = [a.media_title, a.media_artist].filter((x) => typeof x === 'string' && x).join(' · ')
      const appli = typeof a.app_name === 'string' ? a.app_name : typeof a.source === 'string' ? a.source : ''
      const vol = nombre(a.volume_level)
      detail = [titre || appli, vol !== null && actif ? `volume ${pct(vol * 100)}` : ''].filter(Boolean).join(' · ') || undefined
      break
    }
    case 'lock':
      etat = ETATS_SERRURE[s] ?? s
      actif = s !== 'locked'
      alerte = s === 'unlocked' || s === 'open' || s === 'jammed'
      break
    case 'alarm_control_panel':
      etat = ETATS_ALARME[s] ?? s
      actif = s.startsWith('armed') || s === 'triggered'
      alerte = s === 'triggered'
      break
    case 'camera':
      etat = s === 'recording' ? 'enregistre' : s === 'streaming' ? 'en direct' : 'en veille'
      actif = false
      break
    case 'vacuum':
      etat = ETATS_ASPI[s] ?? s
      actif = s === 'cleaning' || s === 'returning'
      alerte = s === 'error'
      break
    case 'scene':
    case 'script':
    case 'button':
      etat = d === 'script' && s === 'on' ? 'en cours' : 'prêt'
      actif = d === 'script' && s === 'on'
      break
    case 'sensor': {
      const v = nombre(s)
      const unite = typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : ''
      etat = v !== null ? `${fr(v)}${unite ? `\u00a0${unite}` : ''}` : s
      actif = false
      break
    }
    case 'binary_sensor': {
      const c = classe(e)
      const [oui, non] = DETECTION[c] ?? ['actif', 'inactif']
      etat = s === 'on' ? oui : non
      actif = s === 'on'
      alerte = s === 'on' && (ALERTES.has(c) || c === 'lock')
      break
    }
  }
  const basculable = !base.sensible && ['light', 'switch', 'input_boolean', 'fan', 'humidifier', 'climate', 'media_player', 'cover', 'scene', 'remote'].includes(d)
  return { ...base, etat, ...(detail ? { detail } : {}), actif, ...(alerte ? { alerte } : {}), basculable }
}

// ── Retrouver un appareil d'après ce que l'utilisateur dit ──

type Candidat = { e: Etat; piece?: string; nom: string[]; pieceMots: string[]; tout: Set<string> }

function candidat(e: Etat, piece?: string): Candidat {
  const nom = mots(nomDe(e))
  const pieceMots = piece ? mots(piece) : []
  const d = DOMAINES[domaine(e.entity_id)]
  const tout = new Set([...nom, ...pieceMots, ...mots(d?.synonymes ?? ''), ...mots(e.entity_id.split('.')[1] ?? '')])
  if (typeOf(e) === 'portail') for (const m of ['portail', 'garage', 'porte']) tout.add(m)
  return { e, piece, nom, pieceMots, tout }
}

const TYPES_DEMANDES: Record<string, TypeAppareil[]> = {
  lumiere: ['lumiere'],
  prise: ['prise'],
  ventilateur: ['ventilateur'],
  clim: ['clim'],
  chauffe_eau: ['chauffe_eau'],
  volet: ['volet', 'portail'],
  portail: ['portail'],
  media: ['media'],
  serrure: ['serrure'],
  alarme: ['alarme'],
  camera: ['camera'],
  aspirateur: ['aspirateur'],
  scene: ['scene'],
  capteur: ['capteur', 'detecteur'],
  detecteur: ['detecteur']
}

/**
 * Les appareils que désigne une phrase : l'identifiant exact, le nom exact, sinon ceux dont le nom, la pièce et
 * le type couvrent tous les mots (« lumière salon » : toutes les lumières du salon). À égalité, la pièce la plus
 * juste gagne (« chambre » plutôt que « chambre d'amis »).
 */
export function trouver(etats: Etat[], pieces: Map<string, string>, demande: string): Etat[] {
  const brut = demande.trim()
  const exact = etats.find((e) => e.entity_id === brut)
  if (exact) return [exact]
  const q = mots(brut)
  if (!q.length) return []
  const cands = etats.filter(visible).map((e) => candidat(e, pieces.get(e.entity_id)))
  const memeNom = cands.filter((c) => c.nom.join(' ') === q.join(' '))
  if (memeNom.length) return memeNom.map((c) => c.e)
  const couverts = cands.filter((c) => q.every((m) => c.tout.has(m)))
  if (couverts.length < 2) return couverts.map((c) => c.e)
  const ecart = (c: Candidat) => c.pieceMots.filter((m) => !q.includes(m)).length
  const min = Math.min(...couverts.map(ecart))
  const justes = couverts.filter((c) => ecart(c) === min)
  // Types différents (« porte » : la serrure « Porte d'entrée » et le garage) : le mot dans le nom l'emporte.
  if (new Set(justes.map((c) => typeOf(c.e))).size < 2) return justes.map((c) => c.e)
  const dansLeNom = (c: Candidat) => q.filter((m) => c.nom.includes(m)).length
  const max = Math.max(...justes.map(dansLeNom))
  return (max > 0 ? justes.filter((c) => dansLeNom(c) === max) : justes).map((c) => c.e)
}

// ── Les commandes ──

export const ACTIONS = ['allumer', 'eteindre', 'basculer', 'regler', 'ouvrir', 'fermer', 'arreter', 'verrouiller', 'deverrouiller', 'armer', 'desarmer', 'lecture', 'pause', 'suivant', 'precedent', 'activer'] as const
export type Action = (typeof ACTIONS)[number]

export type Reglages = { temperature?: number; mode?: string; luminosite?: number; couleur?: string; volume?: number; vitesse?: number; position?: number; source?: string }

const MODES: Record<string, string> = { froid: 'cool', clim: 'cool', chaud: 'heat', chauffage: 'heat', auto: 'heat_cool', automatique: 'heat_cool', ventilation: 'fan_only', deshumidification: 'dry', sec: 'dry', arret: 'off' }
const COULEURS: Record<string, Record<string, unknown>> = {
  rouge: { color_name: 'red' },
  vert: { color_name: 'green' },
  verte: { color_name: 'green' },
  bleu: { color_name: 'blue' },
  bleue: { color_name: 'blue' },
  jaune: { color_name: 'yellow' },
  orange: { color_name: 'orange' },
  violet: { color_name: 'purple' },
  violette: { color_name: 'purple' },
  rose: { color_name: 'pink' },
  cyan: { color_name: 'cyan' },
  turquoise: { color_name: 'turquoise' },
  magenta: { color_name: 'magenta' },
  blanc: { color_temp_kelvin: 4000 },
  blanche: { color_temp_kelvin: 4000 },
  'blanc chaud': { color_temp_kelvin: 2700 },
  'blanc froid': { color_temp_kelvin: 6000 },
  'blanc neutre': { color_temp_kelvin: 4000 }
}
const borne = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export type Appel = { domaine: string; service: string; donnees: Record<string, unknown> }

/** Le service Home Assistant pour une action sur un appareil, ou pourquoi ce n'est pas possible. */
export function serviceDe(e: Etat, action: Action, r: Reglages): Appel | { erreur: string } {
  const d = domaine(e.entity_id)
  const nom = nomDe(e)
  const appel = (service: string, donnees: Record<string, unknown> = {}, dom = d): Appel => ({ domaine: dom, service, donnees })
  const non = () => ({ erreur: `« ${nom} » (${DOMAINES[d]?.libelle.toLowerCase() ?? d}) ne sait pas « ${action} ».` })
  const onOff = (): Appel | null => (action === 'allumer' || action === 'activer' ? appel('turn_on') : action === 'eteindre' || action === 'arreter' ? appel('turn_off') : action === 'basculer' ? appel('toggle') : null)
  switch (d) {
    case 'light': {
      if (action === 'eteindre') return appel('turn_off')
      if (action === 'basculer') return appel('toggle')
      if (action !== 'allumer' && action !== 'regler') return non()
      const donnees: Record<string, unknown> = {}
      if (r.luminosite !== undefined) donnees.brightness_pct = borne(Math.round(r.luminosite), 1, 100)
      if (r.couleur) {
        const c = COULEURS[SANS_ACCENT(r.couleur.toLowerCase().trim())]
        if (!c) return { erreur: `Couleur « ${r.couleur} » inconnue : ${Object.keys(COULEURS).join(', ')}.` }
        Object.assign(donnees, c)
      }
      return appel('turn_on', donnees)
    }
    case 'climate': {
      const mode = r.mode ? MODES[SANS_ACCENT(r.mode.toLowerCase().trim())] : undefined
      if (r.mode && !mode) return { erreur: `Mode « ${r.mode} » inconnu : froid, chaud, auto, ventilation, déshumidification.` }
      if (action === 'eteindre' || action === 'arreter') return appel('turn_off')
      if (action === 'basculer') return appel('toggle')
      if (r.temperature !== undefined) {
        if (r.temperature < 10 || r.temperature > 32) return { erreur: `${r.temperature} °C : choisissez entre 10 et 32 °C.` }
        return appel('set_temperature', { temperature: r.temperature, ...(mode ? { hvac_mode: mode } : {}) })
      }
      if (mode) return appel('set_hvac_mode', { hvac_mode: mode })
      return action === 'allumer' ? appel('turn_on') : non()
    }
    case 'water_heater':
      if (r.temperature !== undefined) return appel('set_temperature', { temperature: borne(r.temperature, 30, 75) })
      return action === 'allumer' ? appel('turn_on') : action === 'eteindre' || action === 'arreter' ? appel('turn_off') : non()
    case 'fan':
      if (r.vitesse !== undefined && (action === 'regler' || action === 'allumer')) return appel(action === 'regler' ? 'set_percentage' : 'turn_on', { percentage: borne(Math.round(r.vitesse), 0, 100) })
      return onOff() ?? non()
    case 'switch':
    case 'input_boolean':
    case 'humidifier':
    case 'siren':
    case 'remote':
      return onOff() ?? non()
    case 'cover':
    case 'valve': {
      const s = d === 'cover' ? 'cover' : 'valve'
      if (r.position !== undefined) return appel(`set_${s}_position`, { position: borne(Math.round(r.position), 0, 100) })
      if (action === 'ouvrir') return appel(`open_${s}`)
      if (action === 'fermer') return appel(`close_${s}`)
      if (action === 'arreter') return appel(`stop_${s}`)
      if (action === 'basculer') return appel('toggle')
      return non()
    }
    case 'media_player': {
      if (r.volume !== undefined) return appel('volume_set', { volume_level: borne(Math.round(r.volume), 0, 100) / 100 })
      if (r.source) return appel('select_source', { source: r.source.slice(0, 80) })
      const s: Partial<Record<Action, string>> = { allumer: 'turn_on', eteindre: 'turn_off', basculer: 'toggle', lecture: 'media_play', pause: 'media_pause', arreter: 'media_stop', suivant: 'media_next_track', precedent: 'media_previous_track' }
      return s[action] ? appel(s[action]!) : non()
    }
    case 'lock':
      return action === 'verrouiller' || action === 'fermer' ? appel('lock') : action === 'deverrouiller' ? appel('unlock') : action === 'ouvrir' ? appel('open') : non()
    case 'alarm_control_panel': {
      if (action === 'desarmer') return appel('alarm_disarm')
      if (action !== 'armer') return non()
      const m = SANS_ACCENT((r.mode ?? '').toLowerCase())
      return appel(m === 'maison' || m === 'presence' ? 'alarm_arm_home' : m === 'nuit' ? 'alarm_arm_night' : 'alarm_arm_away')
    }
    case 'vacuum': {
      const s: Partial<Record<Action, string>> = { allumer: 'start', activer: 'start', lecture: 'start', pause: 'pause', arreter: 'stop', eteindre: 'return_to_base' }
      return s[action] ? appel(s[action]!) : non()
    }
    case 'camera':
      return action === 'allumer' ? appel('turn_on') : action === 'eteindre' ? appel('turn_off') : non()
    case 'scene':
    case 'script':
      return action === 'activer' || action === 'allumer' ? appel('turn_on') : non()
    case 'button':
      return action === 'activer' || action === 'allumer' ? appel('press') : non()
    default:
      return non()
  }
}

const heure = (secondes = false) => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', ...(secondes ? { second: '2-digit' } : {}) })

/** La vue « Maison » : les appareils rangés par pièce, les pièces sans nom à la fin. */
export function vueMaison(appareils: UiAppareil[], titre: string, focus?: string[]): UiMaison {
  const parPiece = new Map<string, UiAppareil[]>()
  for (const a of appareils) {
    const p = a.piece ?? ''
    parPiece.set(p, [...(parPiece.get(p) ?? []), a])
  }
  const pieces = [...parPiece.entries()]
    .sort(([a], [b]) => (a ? (b ? a.localeCompare(b, 'fr') : -1) : 1))
    .map(([nom, liste]) => ({ nom: nom || 'Sans pièce', appareils: liste.sort((x, y) => x.type.localeCompare(y.type) || x.nom.localeCompare(y.nom, 'fr')) }))
  const actifs = appareils.filter((a) => a.actif && !['camera', 'detecteur', 'capteur', 'serrure', 'alarme', 'portail'].includes(a.type)).length
  const alertes = appareils.filter((a) => a.alerte).length
  const sousTitre = [
    `${pieces.length} PIÈCE${pieces.length > 1 ? 'S' : ''}`,
    `${appareils.length} APPAREIL${appareils.length > 1 ? 'S' : ''}`,
    actifs ? `${actifs} EN MARCHE` : '',
    alertes ? `${alertes} À VOIR` : ''
  ]
    .filter(Boolean)
    .join(' · ')
  return { kind: 'maison', titre, sousTitre, pieces, ...(focus?.length ? { focus } : {}), heure: heure() }
}

// ── L'installation Home Assistant ──

export class Maison {
  private pieces: { at: number; map: Map<string, string> } | null = null

  constructor(
    readonly base: string,
    private readonly jeton: string,
    readonly libelle = 'Home Assistant'
  ) {}

  private async requete(chemin: string, init: RequestInit = {}): Promise<Response> {
    let res: Response
    try {
      res = await fetch(`${this.base}${chemin}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.jeton}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        signal: AbortSignal.timeout(DELAI)
      })
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause?.code
      throw new Error(
        err instanceof Error && err.name === 'TimeoutError'
          ? `${this.libelle} ne répond pas (${new URL(this.base).host}).`
          : `${this.libelle} injoignable à ${new URL(this.base).host}${cause ? ` (${cause})` : ''} : vérifiez l’adresse, et que ce serveur est sur le même réseau.`
      )
    }
    if (res.status === 401 || res.status === 403) throw new Error('jeton refusé : créez un jeton d’accès longue durée dans votre profil Home Assistant.')
    if (!res.ok) {
      const texte = (await res.text().catch(() => '')).slice(0, 200)
      throw new Error(`${this.libelle} : HTTP ${res.status}${texte ? ` (${texte})` : ''}`)
    }
    return res
  }

  /** Vérifie l'adresse et le jeton ; renvoie la version de Home Assistant si elle est connue. */
  async verifier(): Promise<void> {
    const res = await this.requete('/api/')
    const corps = (await res.json().catch(() => null)) as { message?: string } | null
    if (!corps?.message) throw new Error('cette adresse ne répond pas comme Home Assistant (attendu : http://homeassistant.local:8123).')
  }

  async etats(): Promise<Etat[]> {
    return (await (await this.requete('/api/states')).json()) as Etat[]
  }

  async etat(id: string): Promise<Etat | null> {
    try {
      return (await (await this.requete(`/api/states/${encodeURIComponent(id)}`)).json()) as Etat
    } catch {
      return null
    }
  }

  /** La pièce de chaque appareil, par un gabarit Home Assistant ; sans les droits d'administrateur, pas de pièces. */
  async lesPieces(): Promise<Map<string, string>> {
    if (this.pieces && Date.now() - this.pieces.at < DUREE_PIECES) return this.pieces.map
    const gabarit = '{% set ns = namespace(r=[]) %}{% for s in states %}{% set a = area_name(s.entity_id) %}{% if a %}{% set ns.r = ns.r + [[s.entity_id, a]] %}{% endif %}{% endfor %}{{ ns.r | tojson }}'
    let map = new Map<string, string>()
    try {
      const res = await this.requete('/api/template', { method: 'POST', body: JSON.stringify({ template: gabarit }) })
      map = new Map((JSON.parse(await res.text()) as [string, string][]).filter((p) => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string'))
    } catch {
      // Jeton d'un utilisateur non administrateur, ou gabarit refusé : les appareils restent sans pièce.
    }
    this.pieces = { at: Date.now(), map }
    return map
  }

  /** Tous les appareils montrables, avec leur pièce. */
  async appareils(): Promise<{ etats: Etat[]; pieces: Map<string, string>; liste: UiAppareil[] }> {
    const [etats, pieces] = await Promise.all([this.etats(), this.lesPieces()])
    return { etats, pieces, liste: etats.filter(visible).map((e) => appareil(e, pieces.get(e.entity_id))) }
  }

  async appeler(a: Appel, entite: string): Promise<void> {
    await this.requete(`/api/services/${encodeURIComponent(a.domaine)}/${encodeURIComponent(a.service)}`, { method: 'POST', body: JSON.stringify({ entity_id: entite, ...a.donnees }) })
  }

  /** Le nouvel état après une commande (les appareils mettent un instant à répondre). */
  async apres(ids: string[], pieces: Map<string, string>): Promise<UiAppareil[]> {
    await new Promise((r) => setTimeout(r, 700))
    const etats = await Promise.all(ids.map((id) => this.etat(id)))
    return etats.filter((e): e is Etat => Boolean(e)).map((e) => appareil(e, pieces.get(e.entity_id)))
  }

  /** L'image d'une caméra, réduite à 960 pixels de large. */
  async image(id: string): Promise<{ media: 'image/jpeg' | 'image/png' | 'image/webp'; data: Buffer }> {
    const res = await this.requete(`/api/camera_proxy/${encodeURIComponent(id)}?width=960`)
    const type = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim()
    const media = type === 'image/png' || type === 'image/webp' ? type : 'image/jpeg'
    const data = Buffer.from(await res.arrayBuffer())
    if (data.length < 100) throw new Error('la caméra n’a pas renvoyé d’image.')
    return { media, data }
  }

  /** Un toucher sur l'écran : allumer ou éteindre ce qui n'a pas besoin de validation. */
  async basculer(id: string): Promise<UiAppareil> {
    const e = await this.etat(id)
    if (!e) throw new Error('Cet appareil n’existe plus dans Home Assistant.')
    const pieces = await this.lesPieces()
    const avant = appareil(e, pieces.get(id))
    if (!avant.basculable) throw new Error(avant.sensible ? `« ${avant.nom} » se commande à la voix, avec votre validation.` : `« ${avant.nom} » ne s’allume pas d’un toucher.`)
    const d = domaine(id)
    await this.appeler(d === 'scene' ? { domaine: d, service: 'turn_on', donnees: {} } : d === 'cover' ? { domaine: d, service: e.state === 'open' ? 'close_cover' : 'open_cover', donnees: {} } : { domaine: d, service: 'toggle', donnees: {} }, id)
    return (await this.apres([id], pieces))[0] ?? avant
  }

  /** La vue d'une caméra, image comprise (rien n'est gardé). */
  async camera(id: string): Promise<UiCamera> {
    const [e, pieces] = await Promise.all([this.etat(id), this.lesPieces()])
    const nom = e ? nomDe(e) : id
    const piece = pieces.get(id)
    try {
      const { media, data } = await this.image(id)
      return { kind: 'camera', id, nom, ...(piece ? { piece } : {}), image: `data:${media};base64,${data.toString('base64')}`, heure: heure(true) }
    } catch (err) {
      return { kind: 'camera', id, nom, ...(piece ? { piece } : {}), heure: heure(true), erreur: err instanceof Error ? err.message : String(err) }
    }
  }

  outils(): Tool[] {
    return [outilEtat(this), outilCommande(this), outilCamera(this)]
  }
}

// ── Les outils de Claude ──

const TYPES_ENUM = Object.keys(TYPES_DEMANDES)
const ligne = (a: UiAppareil) => `${a.id} | ${a.nom}${a.piece ? ` | ${a.piece}` : ''} | ${a.type} | ${a.etat}${a.detail ? ` (${a.detail})` : ''}${a.sensible ? ' | validation' : ''}`

function filtrer(liste: UiAppareil[], q: { piece?: unknown; type?: unknown; recherche?: unknown }): UiAppareil[] {
  const piece = typeof q.piece === 'string' && q.piece.trim() ? mots(q.piece) : []
  const types = typeof q.type === 'string' ? TYPES_DEMANDES[q.type] : undefined
  const r = typeof q.recherche === 'string' && q.recherche.trim() ? mots(q.recherche) : []
  return liste.filter((a) => {
    if (types && !types.includes(a.type)) return false
    if (piece.length) {
      const p = mots(a.piece ?? '')
      if (!piece.every((m) => p.includes(m))) return false
    }
    if (r.length) {
      const tout = new Set([...mots(a.nom), ...mots(a.piece ?? ''), ...mots(a.id)])
      if (!r.every((m) => tout.has(m))) return false
    }
    return true
  })
}

function outilEtat(m: Maison): Tool {
  return {
    name: 'maison_etat',
    description: `[${m.libelle}, lecture] Les appareils de la maison et leur état, par pièce : lumières, clim et chauffage, volets, télé, prises, serrures, alarme, caméras, températures, portes et fenêtres. Pour « qu'est-ce qui est allumé ? », « il fait combien dans la chambre ? », « la porte est fermée ? ». Affiche la maison à l'écran.`,
    risk: 'lecture',
    ui: { kind: 'maison', title: () => 'Maison' },
    input_schema: {
      type: 'object',
      properties: {
        piece: { type: 'string', description: 'Une pièce (« salon »), si la question porte sur elle.' },
        type: { type: 'string', enum: TYPES_ENUM, description: 'Un type d’appareil, si la question porte sur lui.' },
        recherche: { type: 'string', description: 'Un nom d’appareil (« plafonnier »).' },
        allumes: { type: 'boolean', description: 'Seulement ce qui est en marche (« qu’est-ce qui est allumé ? »).' }
      }
    },
    validate: () => null,
    run: async (input) => {
      const { liste } = await m.appareils()
      let choisis = filtrer(liste, input)
      if (input.allumes === true) choisis = choisis.filter((a) => a.actif && !['camera', 'capteur', 'serrure', 'alarme'].includes(a.type))
      const titre = typeof input.piece === 'string' && input.piece.trim() ? input.piece.trim().replace(/^./, (c) => c.toUpperCase()) : input.allumes === true ? 'En marche' : 'Maison'
      if (!choisis.length) {
        const pieces = [...new Set(liste.map((a) => a.piece).filter(Boolean))].join(', ')
        return { content: `Aucun appareil ne correspond.${pieces ? ` Pièces connues : ${pieces}.` : ''} ${liste.length} appareils en tout.`, summary: `${m.libelle} : aucun appareil` }
      }
      const texte = choisis.map(ligne).join('\n')
      return {
        content: `${texte.slice(0, MAX_FOR_CLAUDE)}${texte.length > MAX_FOR_CLAUDE ? '\n(Liste tronquée.)' : ''}\nLa maison est affichée à l'écran : réponds à la question en une ou deux phrases, sans relire la liste ni les identifiants.`,
        summary: `${m.libelle} : ${choisis.length} appareil${choisis.length > 1 ? 's' : ''}`,
        view: vueMaison(choisis.slice(0, 160), titre)
      }
    }
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : undefined)

function reglagesDe(input: Record<string, unknown>): Reglages {
  const r: Reglages = {}
  for (const k of ['temperature', 'luminosite', 'volume', 'vitesse', 'position'] as const) {
    const v = num(input[k])
    if (v !== undefined) r[k] = v
  }
  for (const k of ['mode', 'couleur', 'source'] as const) if (typeof input[k] === 'string' && (input[k] as string).trim()) r[k] = (input[k] as string).trim()
  return r
}

function outilCommande(m: Maison): Tool {
  return {
    name: 'maison_commande',
    description: `[${m.libelle}] Commande les appareils de la maison : allumer ou éteindre la lumière, régler la clim (température, mode), le ventilateur, ouvrir ou fermer les volets, la télé (allumer, pause, volume, source), lancer l'aspirateur, une scène ; verrouiller ou déverrouiller, armer l'alarme, ouvrir le portail. Appelle-la directement avec les mots de l'utilisateur (« lumière salon », « clim chambre », « télé ») : l'appareil est retrouvé par son nom, sa pièce et son type, sans passer par maison_etat. Le confort s'exécute tout de suite ; serrure, alarme, portail ou garage, vanne, sirène, caméra et scripts affichent une carte de validation : rien n'est fait avant son oui.`,
    risk: 'preparation',
    ui: { kind: 'maison', title: () => 'Maison' },
    input_schema: {
      type: 'object',
      properties: {
        appareils: { type: 'array', items: { type: 'string' }, description: 'Ce que l’utilisateur désigne (« lumière salon », « clim », « volets chambre ») ou des identifiants (« light.salon »). Plusieurs appareils du même type dans la pièce : tous.' },
        piece: { type: 'string', description: 'Une pièce entière, avec type : « éteins tout le salon » → piece salon sans type.' },
        type: { type: 'string', enum: TYPES_ENUM, description: 'Avec piece, ou seul : « ferme tous les volets » → type volet.' },
        action: { type: 'string', enum: [...ACTIONS], description: 'regler : changer température, luminosité, volume, vitesse ou position sans allumer ni éteindre.' },
        temperature: { type: 'number', description: 'Consigne en °C (clim, chauffage, chauffe-eau).' },
        mode: { type: 'string', description: 'Clim : froid, chaud, auto, ventilation, déshumidification. Alarme : absence, maison, nuit.' },
        luminosite: { type: 'number', description: 'Lumière, de 1 à 100 %.' },
        couleur: { type: 'string', description: 'Lumière : rouge, bleu, vert, jaune, orange, violet, rose, blanc chaud, blanc froid…' },
        volume: { type: 'number', description: 'Télé ou enceinte, de 0 à 100 %.' },
        vitesse: { type: 'number', description: 'Ventilateur, de 0 à 100 %.' },
        position: { type: 'number', description: 'Volet ou vanne, de 0 (fermé) à 100 % (ouvert).' },
        source: { type: 'string', description: 'Télé : entrée ou application (« HDMI 1 », « Netflix »).' }
      },
      required: ['action']
    },
    validate: (input) => {
      if (!ACTIONS.includes(input.action as Action)) return `Action inconnue : ${ACTIONS.join(', ')}.`
      const appareils = input.appareils
      if (appareils !== undefined && (!Array.isArray(appareils) || appareils.some((a) => typeof a !== 'string'))) return '« appareils » : une liste de noms.'
      if (!(Array.isArray(appareils) && appareils.length) && !input.piece && !input.type) return 'Dites quels appareils : « appareils », ou « piece » et « type ».'
      return null
    },
    run: async (input, ctx) => commander(m, input, ctx)
  }
}

async function commander(m: Maison, input: Record<string, unknown>, ctx: ToolContext) {
  const action = input.action as Action
  const r = reglagesDe(input)
  const { etats, pieces } = await m.appareils()
  const cibles = new Map<string, Etat>()
  const introuvables: string[] = []
  const ambigus: string[] = []
  for (const demande of (input.appareils as string[] | undefined) ?? []) {
    const trouves = trouver(etats, pieces, demande).filter((e) => !['sensor', 'binary_sensor'].includes(domaine(e.entity_id)))
    const types = new Set(trouves.map(typeOf))
    if (!trouves.length) introuvables.push(demande)
    else if (types.size > 1) ambigus.push(`« ${demande} » : ${trouves.slice(0, 8).map((e) => `${nomDe(e)} (${e.entity_id})`).join(', ')}`)
    else for (const e of trouves) cibles.set(e.entity_id, e)
  }
  if (!(input.appareils as string[] | undefined)?.length) {
    const choisis = filtrer(
      etats.filter(visible).map((e) => appareil(e, pieces.get(e.entity_id))),
      { piece: input.piece, type: input.type }
    ).filter((a) => a.type !== 'capteur' && a.type !== 'detecteur' && a.type !== 'camera' && !(input.type === undefined && (a.sensible || a.type === 'scene' || a.type === 'bouton')))
    for (const a of choisis) cibles.set(a.id, etats.find((e) => e.entity_id === a.id)!)
  }
  if (ambigus.length) return { content: `Plusieurs appareils correspondent : ${ambigus.join(' ; ')}. Demande lequel, ou précise le type.`, isError: true, summary: `${m.libelle} : appareil à préciser` }
  if (!cibles.size) {
    const pieces2 = [...new Set([...pieces.values()])].slice(0, 30).join(', ')
    return { content: `Introuvable : ${introuvables.join(', ') || 'aucun appareil pour cette pièce ou ce type'}.${pieces2 ? ` Pièces : ${pieces2}.` : ''} Cherche avec maison_etat, puis réessaie avec l'identifiant.`, isError: true, summary: `${m.libelle} : appareil introuvable` }
  }
  const appels: { e: Etat; appel: Appel }[] = []
  const refus: string[] = []
  for (const e of cibles.values()) {
    const a = serviceDe(e, action, r)
    if ('erreur' in a) refus.push(a.erreur)
    else appels.push({ e, appel: a })
  }
  if (!appels.length) return { content: refus.join(' '), isError: true, summary: `${m.libelle} : commande impossible` }
  const noms = appels.map(({ e }) => nomDe(e))
  const quoi = `${ACTION_FR[action]} ${noms.length > 3 ? `${noms.slice(0, 3).join(', ')} et ${noms.length - 3} autre${noms.length > 4 ? 's' : ''}` : noms.join(', ')}${resume(r)}`
  const executer = async () => {
    const echecs: string[] = []
    await Promise.all(
      appels.map(({ e, appel }) =>
        m.appeler(appel, e.entity_id).catch((err) => {
          echecs.push(`${nomDe(e)} : ${err instanceof Error ? err.message : String(err)}`)
        })
      )
    )
    return { echecs, apres: await m.apres(appels.map(({ e }) => e.entity_id), pieces) }
  }
  const aValider = appels.some(({ e }) => sensible(e, action))
  if (aValider) {
    if (ctx.unattended) return { content: `${quoi} : refusé dans une tâche planifiée (cela demande une validation). Propose-le dans ton résultat.`, isError: true, summary: `${m.libelle} : refusé (tâche planifiée)` }
    ctx.requestConfirmation(`${m.libelle} : ${quoi}`, appels.map(({ e, appel }) => `${nomDe(e)} → ${appel.domaine}.${appel.service}`).join('\n'), async () => {
      const { echecs, apres } = await executer()
      if (echecs.length) {
        ctx.log(`${m.libelle} : ${quoi} — échec (${echecs.join(' ; ').slice(0, 200)})`)
        ctx.announce(`${m.libelle} a refusé : ${echecs[0]}`)
        return
      }
      ctx.log(`${m.libelle} : ${quoi}`)
      ctx.announce(`C'est fait : ${apres.map((a) => `${a.nom} ${a.etat}`).join(', ') || quoi}.`)
    })
    return {
      content: `En attente de validation : ${quoi}.${refus.length ? ` Non compris : ${refus.join(' ')}` : ''}\nUne carte « VOTRE ACCORD ? » est affichée. Annonce en une phrase ce qui va être fait et demande son accord ; ne prétends pas que c'est fait.`,
      summary: `${m.libelle} : ${quoi} (en attente de votre oui)`
    }
  }
  const { echecs, apres } = await executer()
  ctx.log(`${m.libelle} : ${quoi}${echecs.length ? ` (${echecs.length} échec${echecs.length > 1 ? 's' : ''})` : ''}`)
  const etatsApres = apres.map((a) => `${a.nom} : ${a.etat}${a.detail ? ` (${a.detail})` : ''}`).join('\n')
  return {
    content: `${echecs.length ? `Échecs : ${echecs.join(' ; ')}\n` : ''}${refus.length ? `Non compris : ${refus.join(' ')}\n` : ''}Fait. État maintenant :\n${etatsApres}\nConfirme en quelques mots (« C'est allumé. »), sans relire d'identifiant. Si l'état n'a pas encore changé, l'appareil met un instant à répondre.`,
    isError: echecs.length === appels.length,
    summary: `${m.libelle} : ${quoi}`,
    view: vueMaison(apres, noms.length === 1 ? noms[0]! : 'Maison', apres.map((a) => a.id))
  }
}

const ACTION_FR: Record<Action, string> = {
  allumer: 'allumer',
  eteindre: 'éteindre',
  basculer: 'basculer',
  regler: 'régler',
  ouvrir: 'ouvrir',
  fermer: 'fermer',
  arreter: 'arrêter',
  verrouiller: 'verrouiller',
  deverrouiller: 'déverrouiller',
  armer: 'armer',
  desarmer: 'désarmer',
  lecture: 'lancer la lecture sur',
  pause: 'mettre en pause',
  suivant: 'passer à la suite sur',
  precedent: 'revenir en arrière sur',
  activer: 'activer'
}

function resume(r: Reglages): string {
  const p: string[] = []
  if (r.temperature !== undefined) p.push(`${fr(r.temperature)}\u00a0°C`)
  if (r.mode) p.push(r.mode)
  if (r.luminosite !== undefined) p.push(`${Math.round(r.luminosite)}\u00a0%`)
  if (r.couleur) p.push(r.couleur)
  if (r.volume !== undefined) p.push(`volume ${Math.round(r.volume)}\u00a0%`)
  if (r.vitesse !== undefined) p.push(`vitesse ${Math.round(r.vitesse)}\u00a0%`)
  if (r.position !== undefined) p.push(`position ${Math.round(r.position)}\u00a0%`)
  if (r.source) p.push(r.source)
  return p.length ? ` (${p.join(', ')})` : ''
}

function outilCamera(m: Maison): Tool {
  return {
    name: 'maison_camera',
    description: `[${m.libelle}, lecture] Prend l'image actuelle d'une caméra de la maison et l'affiche à l'écran ; tu la vois aussi, pour répondre à « il y a quelqu'un devant la porte ? », « le colis est arrivé ? ». Ne reconnais ni ne nomme jamais une personne d'après son visage : décris seulement ce qui se voit.`,
    risk: 'lecture',
    ui: { kind: 'camera', title: () => 'Caméra' },
    input_schema: { type: 'object', properties: { camera: { type: 'string', description: 'La caméra (« entrée », « jardin ») ou son identifiant ; vide s’il n’y en a qu’une.' } } },
    validate: (input) => (input.camera !== undefined && typeof input.camera !== 'string' ? '« camera » : un nom.' : null),
    run: async (input) => {
      const { etats, pieces } = await m.appareils()
      const cameras = etats.filter((e) => domaine(e.entity_id) === 'camera')
      if (!cameras.length) return { content: `Aucune caméra dans ${m.libelle}.`, isError: true, summary: `${m.libelle} : aucune caméra` }
      const demande = typeof input.camera === 'string' ? input.camera.trim() : ''
      const trouvees = demande ? trouver(cameras, pieces, demande) : cameras.length === 1 ? cameras : []
      if (trouvees.length !== 1) {
        const liste = cameras.map((e) => `${nomDe(e)}${pieces.get(e.entity_id) ? ` (${pieces.get(e.entity_id)})` : ''}`).join(', ')
        return { content: `${trouvees.length ? 'Plusieurs caméras correspondent' : demande ? `Aucune caméra « ${demande} »` : 'Plusieurs caméras'} : ${liste}. Demande laquelle.`, isError: true, summary: `${m.libelle} : caméra à préciser` }
      }
      const vue = await m.camera(trouvees[0]!.entity_id)
      if (!vue.image) return { content: `${vue.nom} : ${vue.erreur ?? 'pas d’image'}.`, isError: true, summary: `${m.libelle} : ${vue.nom} (pas d’image)`, view: vue }
      const [, media, data] = vue.image.match(/^data:([^;]+);base64,(.*)$/) ?? []
      return {
        content: [
          { type: 'image', source: { type: 'base64', media_type: media as 'image/jpeg', data: data ?? '' } },
          { type: 'text', text: `Image de la caméra « ${vue.nom} »${vue.piece ? ` (${vue.piece})` : ''} à ${vue.heure}, affichée à l'écran. Réponds à la question d'après l'image, en une ou deux phrases ; sans question précise, dis ce qui se passe. Ne reconnais personne d'après son visage.` }
        ],
        summary: `${m.libelle} : caméra ${vue.nom}`,
        view: vue
      }
    }
  }
}
