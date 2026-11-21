import { FOURNISSEURS, ORBES, QUALITES_VOIX, PROFILS, cartesDuProfil, memesCartes, ROLES_MOTEUR, SYNTHESES, THEMES, TRANSCRIPTIONS, VITESSE_VOIX, WIDGETS, normalizeWidgets, type ChoixSynthese, type ChoixTranscription, type ProfilId, type QualiteVoix, type Reglages, type ReglagesErreurs, type ChoixMoteur, type FournisseurId, type OrbeId, type RoleMoteur, type ThemeId, type WidgetId } from '@code/protocol'
import { codeConfig } from '../../../../config/code.config.ts'
import { inSilence, parseHhmm } from '../scheduler/rules.ts'

/**
 * Validation des réglages envoyés par un écran (`reglages.set`) : chaque champ est vérifié, et la
 * moindre erreur refuse tout le changement (rien n'est enregistré à moitié).
 */

const KEYS = Object.keys(codeConfig.reglages) as (keyof Reglages)[]

/** Les voix proposées (identifiants ElevenLabs de la configuration). */
export const voixIds = (): string[] => codeConfig.voice.tts.choix.map((v) => v.id)

/** Lettres (accents compris), espaces, apostrophes, points et traits d'union : « M. Martin », « Tata Lili ». */
const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const hhmm = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = parseHhmm(v.trim())
  return t === null ? null : `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** Identifiant de modèle : lettres, chiffres et `. : / @ + _ -` (« gpt-5.5 », « openai/gpt-oss-120b », « qwen3:8b »). */
const MODELE = /^[\w.:/@+-]{1,120}$/

/** Les moteurs choisis, fusionnés avec les actuels, ou pourquoi ils sont refusés. */
function moteursValides(v: unknown, current: Record<RoleMoteur, ChoixMoteur>): Record<RoleMoteur, ChoixMoteur> | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Moteurs illisibles.'
  const next = { ...current }
  for (const [role, c] of Object.entries(v as Record<string, unknown>)) {
    if (!ROLES_MOTEUR.includes(role as RoleMoteur)) return `Usage inconnu : ${role}.`
    const { fournisseur, modele } = (c ?? {}) as { fournisseur?: unknown; modele?: unknown }
    if (!FOURNISSEURS.includes(fournisseur as FournisseurId)) return 'Fournisseur inconnu.'
    const m = typeof modele === 'string' ? modele.trim() : ''
    if (!MODELE.test(m)) return 'Nom de modèle invalide.'
    next[role as RoleMoteur] = { fournisseur: fournisseur as FournisseurId, modele: m }
  }
  return next
}

/**
 * Vérifie un changement partiel par rapport aux réglages actuels. Renvoie les valeurs normalisées
 * (espaces retirés, heure sur deux chiffres, vitesse arrondie au pas), ou les erreurs par champ.
 * `voixDuCompte` : les voix du compte ElevenLabs de la personne, permises en plus des voix de base.
 */
export function validateReglages(raw: unknown, current: Reglages, voixDuCompte: readonly string[] = []): { ok: Partial<Reglages> } | { erreurs: ReglagesErreurs } {
  const erreurs: ReglagesErreurs = {}
  const ok: Partial<Reglages> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { erreurs: { appellation: 'Réglages illisibles.' } }
  const input = raw as Record<string, unknown>
  const unknown = Object.keys(input).filter((k) => !KEYS.includes(k as keyof Reglages))
  // Un champ inconnu (faute de frappe, écran plus récent) : refusé plutôt qu'ignoré en silence.
  if (unknown.length) return { erreurs: { appellation: `Réglage inconnu : ${unknown.join(', ')}.` } }

  for (const key of Object.keys(input) as (keyof Reglages)[]) {
    const v = input[key]
    switch (key) {
      case 'nomAssistant': {
        // Le nom sert aussi à l'appeler : un ou deux mots, prononçables.
        const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : null
        if (!s) erreurs.nomAssistant = 'Un nom est attendu.'
        else if (s.length > 24) erreurs.nomAssistant = '24 caractères au plus.'
        else if (!NAME.test(s)) erreurs.nomAssistant = 'Des lettres seulement (espaces, points et traits d’union permis).'
        else ok.nomAssistant = s
        break
      }
      case 'profil':
        if (!PROFILS.includes(v as ProfilId)) erreurs.profil = 'Profil inconnu.'
        else ok.profil = v as ProfilId
        break
      case 'appellation': {
        const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : null
        if (s === null) erreurs.appellation = 'Texte attendu.'
        else if (s.length > 40) erreurs.appellation = '40 caractères au plus.'
        else if (s && !NAME.test(s)) erreurs.appellation = 'Des lettres seulement (espaces, points et traits d’union permis).'
        else ok.appellation = s
        break
      }
      case 'tutoiement':
      case 'notifications':
      case 'ecranSimple':
      case 'reunionsAgenda':
        if (typeof v !== 'boolean') erreurs[key] = 'Oui ou non attendu.'
        else ok[key] = v
        break
      case 'theme':
        if (!THEMES.includes(v as ThemeId)) erreurs.theme = 'Couleur inconnue.'
        else ok.theme = v as ThemeId
        break
      case 'orbe':
        if (!ORBES.includes(v as OrbeId)) erreurs.orbe = 'Forme inconnue.'
        else ok.orbe = v as OrbeId
        break
      case 'moteurs': {
        // Un ou plusieurs usages à la fois ; les autres gardent leur moteur.
        const choix = moteursValides(v, current.moteurs)
        if (typeof choix === 'string') erreurs.moteurs = choix
        else ok.moteurs = choix
        break
      }
      case 'voix':
        if (typeof v !== 'string' || !(voixIds().includes(v) || voixDuCompte.includes(v))) erreurs.voix = 'Voix inconnue.'
        else ok.voix = v
        break
      case 'qualiteVoix':
        if (!QUALITES_VOIX.includes(v as QualiteVoix)) erreurs.qualiteVoix = 'Qualité de voix inconnue.'
        else ok.qualiteVoix = v as QualiteVoix
        break
      case 'transcription':
        if (v !== 'auto' && !TRANSCRIPTIONS.includes(v as never)) erreurs.transcription = 'Service de transcription inconnu.'
        else ok.transcription = v as ChoixTranscription
        break
      case 'synthese':
        if (v !== 'auto' && !SYNTHESES.includes(v as never)) erreurs.synthese = 'Service de voix inconnu.'
        else ok.synthese = v as ChoixSynthese
        break
      case 'vitesseVoix': {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < VITESSE_VOIX.min || v > VITESSE_VOIX.max) {
          erreurs.vitesseVoix = `Entre ${VITESSE_VOIX.min} et ${VITESSE_VOIX.max}.`.replace(/\./g, ',')
        } else ok.vitesseVoix = Math.round(v / VITESSE_VOIX.pas) * VITESSE_VOIX.pas
        // Arrondi au pas sans traîne flottante (1.1500000000000001).
        if (ok.vitesseVoix !== undefined) ok.vitesseVoix = Number(ok.vitesseVoix.toFixed(2))
        break
      }
      case 'briefing': {
        const t = hhmm(v)
        if (!t) erreurs.briefing = 'Heure attendue (HH:MM).'
        else ok.briefing = t
        break
      }
      case 'retourApresMinutes':
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 15 || v > 720) erreurs.retourApresMinutes = 'Entre 15 minutes et 12 heures.'
        else ok.retourApresMinutes = v
        break
      case 'silence': {
        if (v === null) {
          ok.silence = null
          break
        }
        const s = v as { de?: unknown; a?: unknown }
        const de = hhmm(s?.de)
        const a = hhmm(s?.a)
        if (!de || !a) erreurs.silence = 'Deux heures attendues (de, à).'
        else if (de === a) erreurs.silence = 'Le début et la fin doivent différer.'
        else ok.silence = { de, a }
        break
      }
      case 'ville': {
        const s = typeof v === 'string' ? v.trim() : null
        if (!s || s.length > 60 || !NAME.test(s)) erreurs.ville = 'Nom de ville attendu.'
        else ok.ville = s
        break
      }
      case 'fuseau':
        if (typeof v !== 'string' || !v.includes('/') || !validTimeZone(v)) erreurs.fuseau = 'Fuseau horaire inconnu.'
        else ok.fuseau = v
        break
      case 'plafondJour':
        if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0.5 || v > 100)) erreurs.plafondJour = 'Entre 0,50 $ et 100 $, ou sans plafond.'
        else ok.plafondJour = v === null ? null : Math.round(v * 100) / 100
        break
      case 'widgets': {
        // Chaque carte connue au plus une fois, une colonne et un oui/non : sinon tout est refusé.
        const list = Array.isArray(v) ? (v as Record<string, unknown>[]) : null
        const ids = list?.map((w) => w?.id)
        if (
          !list ||
          list.some((w) => !w || typeof w !== 'object' || !WIDGETS.includes(w.id as WidgetId) || (w.colonne !== 'gauche' && w.colonne !== 'droite') || typeof w.visible !== 'boolean') ||
          new Set(ids).size !== ids!.length
        ) {
          erreurs.widgets = 'Liste de cartes invalide.'
        } else ok.widgets = normalizeWidgets(list as Reglages['widgets'], codeConfig.reglages.widgets)
        break
      }
    }
  }

  // Changement de profil : ses cartes, sauf si la personne a rangé les siennes (ou les range en même temps).
  if (ok.profil && ok.profil !== current.profil && !ok.widgets && memesCartes(current.widgets, cartesDuProfil(current.profil))) {
    ok.widgets = cartesDuProfil(ok.profil)
  }

  // Ensemble : le briefing ne tombe pas pendant les heures de silence (il ne pourrait pas être dit).
  const next = { ...current, ...ok }
  if (!erreurs.briefing && !erreurs.silence && next.silence && ('briefing' in ok || 'silence' in ok)) {
    const at = parseHhmm(next.briefing)!
    if (inSilence(at, next.silence)) {
      erreurs['briefing' in ok ? 'briefing' : 'silence'] = 'Le briefing tombe pendant les heures de silence.'
    }
  }
  return Object.keys(erreurs).length ? { erreurs } : { ok }
}
