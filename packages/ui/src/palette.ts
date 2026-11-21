import { ORBES, THEMES, type OrbeId, type ThemeId } from '@code/protocol'

/**
 * Thèmes de CODE : une couleur principale par thème, et tout le reste en est dérivé — variables CSS
 * (`--code-cyan` et ses variantes), grains de l'orbe, contrepoint du logo. Le cyan d'origine garde
 * exactement ses valeurs des maquettes.
 */

export type Rgb = [number, number, number]

/** Couleurs des grains de l'orbe (« r,g,b ») : grain, grain qui scintille, halo du cœur. */
export type OrbPalette = { dot: string; bright: string; core: string }

type ThemeDef = {
  nom: string
  /** Couleur principale. */
  accent: string
  /** Contrepoint : le dernier grain du logo, l'orbe qui réfléchit ou attend un accord. */
  contre: string
  /** Valeurs exactes de l'orbe (thème d'origine, thème clair), sinon dérivées. */
  orb?: OrbPalette
  pensee?: OrbPalette
  /** Thème clair : son fond, ses textes et ses panneaux remplacent ceux de la nuit. */
  clair?: Surfaces
}

/** Fond, panneaux et textes de l'interface. */
type Surfaces = { bg: string; panel: string; text: string; text2: string; muted: string; faint: string }

/** Ceux de la nuit, communs à tous les thèmes sombres (les valeurs de theme.css). */
const NUIT: Surfaces = { bg: '#04070b', panel: 'rgba(8, 18, 25, 0.85)', text: '#e6f4fa', text2: '#c9dce5', muted: '#8fa3b3', faint: '#6f8796' }

export const THEME_DEFS: Record<ThemeId, ThemeDef> = {
  cyan: {
    nom: 'Cyan',
    accent: '#46d7ff',
    contre: '#ffb547',
    orb: { dot: '84,196,238', bright: '200,244,255', core: '205,246,255' },
    pensee: { dot: '236,176,92', bright: '255,230,180', core: '255,236,200' }
  },
  ambre: { nom: 'Ambre', accent: '#ffb547', contre: '#46d7ff' },
  vert: { nom: 'Émeraude', accent: '#2ef2a0', contre: '#ffb547' },
  violet: { nom: 'Améthyste', accent: '#a98bff', contre: '#ffb547' },
  rouge: { nom: 'Carmin', accent: '#ff6a7c', contre: '#46d7ff' },
  glacier: { nom: 'Glacier', accent: '#cfe3f0', contre: '#ffb547' },
  aurore: { nom: 'Aurore', accent: '#ff5ad9', contre: '#3fe0c5' },
  aube: {
    nom: 'Aube',
    accent: '#006c9a',
    contre: '#b8620a',
    orb: { dot: '0,118,168', bright: '0,78,118', core: '0,150,210' },
    pensee: { dot: '184,98,10', bright: '128,64,0', core: '214,128,30' },
    clair: { bg: '#eef2f6', panel: 'rgba(255, 255, 255, 0.86)', text: '#0c1a24', text2: '#22394a', muted: '#4a5d6c', faint: '#5d7181' }
  }
}

/** Fond de l'interface (`--code-bg`). */
export const BG = '#04070b'
const DIM: Rgb = [122, 138, 150]
const WHITE: Rgb = [255, 255, 255]

export function hexToRgb(hex: string): Rgb {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) throw new Error(`Couleur illisible : ${hex}`)
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const rgbToHex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** Mélange : `t` = 0 donne `a`, 1 donne `b`. */
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => a.map((v, i) => Math.round(v + (b[i]! - v) * t)) as Rgb

const triplet = (c: Rgb) => c.join(',')

/** Luminance relative (WCAG), pour vérifier la lisibilité sur le fond. */
export function luminance([r, g, b]: Rgb): number {
  const ch = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

export const contrast = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

/** Grains d'une orbe à cette couleur : un peu éteints au repos, presque blancs quand ils scintillent. */
export function orbFrom(color: Rgb): OrbPalette {
  return { dot: triplet(mix(color, DIM, 0.18)), bright: triplet(mix(color, WHITE, 0.7)), core: triplet(mix(color, WHITE, 0.78)) }
}

export type Palette = {
  id: ThemeId
  nom: string
  accent: string
  /** Variables CSS posées sur la racine du document. */
  vars: Record<string, string>
  /** Grains de l'orbe au repos, à l'écoute et quand CODE parle. */
  orb: OrbPalette
  /** Grains de l'orbe qui réfléchit ou attend une validation. */
  pensee: OrbPalette
  /** Thème clair : l'orbe se dessine en couleurs sombres, sans s'additionner à la lumière du fond. */
  clair: boolean
}

export const isTheme = (v: unknown): v is ThemeId => THEMES.includes(v as ThemeId)

/** La palette complète d'un thème (inconnu : le cyan d'origine). */
export function paletteOf(theme: string | null | undefined): Palette {
  const id = isTheme(theme) ? theme : 'cyan'
  const def = THEME_DEFS[id]
  const accent = hexToRgb(def.accent)
  const contre = hexToRgb(def.contre)
  const surf = def.clair ?? NUIT
  const bg = hexToRgb(surf.bg)
  return {
    id,
    nom: def.nom,
    accent: def.accent,
    clair: !!def.clair,
    vars: {
      '--code-bg': surf.bg,
      '--code-bg-rgb': bg.join(', '),
      '--code-panel': surf.panel,
      '--code-text': surf.text,
      '--code-text-2': surf.text2,
      '--code-muted': surf.muted,
      '--code-faint': surf.faint,
      '--code-cyan': def.accent,
      '--code-cyan-rgb': accent.join(', '),
      '--code-cyan-soft': `rgba(${accent.join(', ')}, 0.08)`,
      // Filets et bordures : la couleur principale fondue dans le fond.
      '--code-line': id === 'cyan' ? '#14303c' : rgbToHex(mix(bg, accent, def.clair ? 0.28 : 0.2)),
      '--code-line-soft': id === 'cyan' ? '#0f2733' : rgbToHex(mix(bg, accent, def.clair ? 0.16 : 0.16)),
      '--code-contre': def.contre,
      '--code-contre-rgb': contre.join(', ')
    },
    orb: def.orb ?? orbFrom(accent),
    pensee: def.pensee ?? orbFrom(contre)
  }
}

// ── Thème appliqué à l'écran ─────────────────────────────────────────────

const STORAGE_KEY = 'code.theme'
let active: Palette = paletteOf(readStored())

function readStored(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** La palette en cours (l'orbe la lit à chaque image : un changement de thème se voit aussitôt). */
export const activePalette = (): Palette => active

/**
 * Applique un thème à tout l'écran : variables CSS, orbe, logo. Gardé sur l'appareil pour que
 * l'écran de connexion et le démarrage aient déjà la bonne couleur.
 */
export function applyTheme(theme: string | null | undefined): Palette {
  active = paletteOf(theme)
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    for (const [k, v] of Object.entries(active.vars)) root.style.setProperty(k, v)
    root.style.colorScheme = active.clair ? 'light' : 'dark'
    root.dataset.theme = active.id
    if (active.clair) root.dataset.clair = ''
    else delete root.dataset.clair
  }
  try {
    localStorage.setItem(STORAGE_KEY, active.id)
  } catch {}
  return active
}

// Au chargement : la dernière couleur connue de cet appareil, avant même la connexion.
if (typeof document !== 'undefined') applyTheme(active.id)

// ── Forme de l'orbe ──────────────────────────────────────────────────────

const ORBE_KEY = 'code.orbe'
let orbe: OrbeId = (() => {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(ORBE_KEY)
    return ORBES.includes(v as OrbeId) ? (v as OrbeId) : 'nebule'
  } catch {
    return 'nebule'
  }
})()

/** La forme choisie (l'orbe la lit à chaque image, comme le thème). */
export const activeOrbe = (): OrbeId => orbe

/** Change la forme de toutes les orbes de l'écran ; gardée sur l'appareil pour le démarrage. */
export function applyOrbe(v: string | null | undefined): OrbeId {
  orbe = ORBES.includes(v as OrbeId) ? (v as OrbeId) : 'nebule'
  try {
    localStorage.setItem(ORBE_KEY, orbe)
  } catch {}
  return orbe
}
