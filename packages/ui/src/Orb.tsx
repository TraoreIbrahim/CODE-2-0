import { useEffect, useRef } from 'react'
import type { OrbeId, ThemeId } from '@code/protocol'
import { FORMES, type Memo } from './orbes.ts'
import { activeOrbe, activePalette, paletteOf } from './palette.ts'

export type OrbMode = 'repos' | 'ecoute' | 'reflexion' | 'parole' | 'validation' | 'alerte' | 'injoignable'

type Props = {
  mode: OrbMode
  size: number
  /** Volume réel (0..1), ou -1 pour laisser l'orbe s'animer seule. */
  level?: () => number
  label?: string
  /** Une autre couleur que celle de l'écran (aperçu d'un thème) ; absent : le thème appliqué. */
  theme?: ThemeId
  /** Le regard de Nébule (deux yeux de lumière) ; `false` : l'orbe seule. */
  face?: boolean
  /** Une autre forme que celle choisie dans les réglages (aperçus) ; absent : la forme appliquée. */
  forme?: OrbeId
}

/**
 * Un nuage de grains indépendants. Chacun suit son propre chemin dans un courant
 * fluide (écoulement ABC, sans source ni puits) :
 * - les grains de surface glissent sur la sphère et dessinent des courants mouvants ;
 * - les grains du cœur jaillissent du centre vers l'extérieur puis renaissent.
 */
type Swarm = {
  /** Positions x, y, z (rayon de la sphère = 1). */
  pos: Float32Array
  /** Phase de scintillement et taille propre de chaque grain. */
  phase: Float32Array
  grain: Float32Array
  /** Âge des grains du cœur (0 → 1, puis renaissance au centre). */
  age: Float32Array
  /** Vitesse locale du courant (0..1) : les grains rapides brillent davantage. */
  speed: Float32Array
  surface: number
  total: number
}

function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function createSwarm(small: boolean): Swarm {
  const rnd = seeded(2024)
  const surface = small ? 320 : 1300
  const core = small ? 60 : 320
  const total = surface + core
  const pos = new Float32Array(total * 3)
  const phase = new Float32Array(total)
  const grain = new Float32Array(total)
  const age = new Float32Array(total)
  const speed = new Float32Array(total)
  for (let i = 0; i < total; i++) {
    const y = 2 * rnd() - 1
    const r = Math.sqrt(1 - y * y)
    const th = rnd() * Math.PI * 2
    const radius = i < surface ? 0.94 + rnd() * 0.06 : rnd()
    pos[i * 3] = r * Math.cos(th) * radius
    pos[i * 3 + 1] = y * radius
    pos[i * 3 + 2] = r * Math.sin(th) * radius
    phase[i] = rnd() * Math.PI * 2
    grain[i] = 0.7 + rnd() * 0.6
    age[i] = rnd()
  }
  return { pos, phase, grain, age, speed, surface, total }
}

const FLOW = new Float32Array(3)

/** Fonction de courant sur la sphère : ses lignes de niveau sont les courants que suivent les grains. */
function streamFn(x: number, y: number, z: number, t: number): number {
  return (
    Math.sin(2.1 * x + t * 0.13) * Math.cos(1.7 * y - t * 0.09) +
    0.8 * Math.sin(2.6 * z - t * 0.11 + 1.3 * x) +
    0.6 * Math.cos(3.1 * y + t * 0.07 - 1.1 * z)
  )
}

/**
 * Courant tangent à la sphère et sans divergence (v = r × ∇ψ) : les grains tourbillonnent
 * sans jamais s'agglutiner, et les tourbillons dérivent lentement.
 */
function flow(x: number, y: number, z: number, t: number): void {
  const h = 0.01
  const f = streamFn(x, y, z, t)
  const gx = (streamFn(x + h, y, z, t) - f) / h
  const gy = (streamFn(x, y + h, z, t) - f) / h
  const gz = (streamFn(x, y, z + h, t) - f) / h
  FLOW[0] = y * gz - z * gy
  FLOW[1] = z * gx - x * gz
  FLOW[2] = x * gy - y * gx
}

function step(s: Swarm, t: number, dt: number, e: number): void {
  const speed = (0.05 + 0.22 * e) * dt
  const { pos, age } = s
  for (let i = 0; i < s.total; i++) {
    const j = i * 3
    let x = pos[j]!
    let y = pos[j + 1]!
    let z = pos[j + 2]!
    if (i < s.surface) {
      // Glisse sur la sphère en suivant le courant, puis on recolle à la surface.
      flow(x, y, z, t)
      s.speed[i] = Math.min(1, Math.hypot(FLOW[0]!, FLOW[1]!, FLOW[2]!) / 3)
      x += FLOW[0]! * speed
      y += FLOW[1]! * speed
      z += FLOW[2]! * speed
      const len = Math.hypot(x, y, z) || 1
      const target = 0.95 + 0.05 * Math.sin(i * 12.9898)
      x = (x / len) * target
      y = (y / len) * target
      z = (z / len) * target
    } else {
      // Jaillit du cœur vers l'extérieur en légère spirale, puis renaît au centre.
      const len = Math.hypot(x, y, z) || 1e-3
      const push = (0.14 + 0.35 * e) * dt
      flow(x / len, y / len, z / len, t)
      x += (x / len) * push + FLOW[0]! * speed * 0.5
      y += (y / len) * push + FLOW[1]! * speed * 0.5
      z += (z / len) * push + FLOW[2]! * speed * 0.5
      age[i] = age[i]! + dt * (0.16 + 0.25 * e)
      if (Math.hypot(x, y, z) > 0.95 || age[i]! >= 1) {
        const a = s.phase[i]! * 7 + t * 2.3 + i
        const u = Math.sin(a * 0.37) * 0.999
        const r = Math.sqrt(1 - u * u)
        x = r * Math.cos(a) * 0.03
        y = u * 0.03
        z = r * Math.sin(a) * 0.03
        age[i] = 0
      }
    }
    pos[j] = x
    pos[j + 1] = y
    pos[j + 2] = z
  }
}

/** L'orbe de CODE : par défaut un nuage de grains porté par un courant fluide, ou l'une des formes au choix (orbes.ts). */
export function Orb({ mode, size, level, label, theme, face = true, forme }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const props = useRef({ mode, size, level, theme, face, forme })
  props.current = { mode, size, level, theme, face, forme }

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const swarm = createSwarm(props.current.size < 120)
    const t0 = performance.now()
    let last = t0
    let raf = 0
    let visible = true
    let lastStill = ''
    let energy = 0
    // Début de l'état en cours : le compte à rebours de la validation part de là.
    let shown: OrbMode | null = null
    let since = 0
    // Horloge propre aux formes : elle accélère avec la voix et quand CODE réfléchit.
    let h = 0
    let memo: Memo = {}
    let formeVue = ''
    // Quelques secondes d'avance : l'orbe démarre déjà « vivante ».
    for (let i = 0; i < 120; i++) step(swarm, i / 30, 1 / 30, 0)
    const io = new IntersectionObserver((entries) => (visible = entries[0]?.isIntersecting ?? true))
    io.observe(cv)

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!visible || document.hidden) return
      const { mode, size } = props.current
      const forme = props.current.forme ?? activeOrbe()
      if (forme !== formeVue) {
        formeVue = forme
        memo = {}
      }
      const still = reduced || mode === 'injoignable'
      const key = `${mode}:${size}:${props.current.theme ?? activePalette().id}:${props.current.face}:${forme}`
      if (still && lastStill === key) return
      lastStill = still ? key : ''
      const t = (now - t0) / 1000 + 4
      if (mode !== shown) {
        shown = mode
        since = t
      }
      const target = targetEnergy(mode, t, props.current.level?.() ?? -1)
      energy += (target - energy) * (target > energy ? 0.35 : 0.08)
      if (forme !== 'nebule') {
        if (!still) h += dt * (0.5 + 1.5 * energy) * (mode === 'reflexion' ? 1.8 : 1)
        drawForme(cv, forme, t, energy, t - since, { h, dt: still ? 0 : dt, memo }, props.current)
        return
      }
      if (!still) step(swarm, t, dt * (mode === 'reflexion' ? 1.6 : 1), energy)
      draw(cv, swarm, t, energy, t - since, props.current)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
    }
  }, [])

  return (
    <div className="code-orb" role="img" aria-label={label ?? 'Assistant'} style={{ width: size, height: size }}>
      <canvas ref={canvas} style={{ width: size, height: size, display: 'block' }} />
    </div>
  )
}

/** Énergie visée (0..1) selon l'état et le volume réel ; partagée avec le halo des bords (EdgeSwarm). */
export function targetEnergy(mode: OrbMode, t: number, level: number): number {
  const live = level >= 0
  switch (mode) {
    case 'ecoute':
      return live ? 0.15 + 0.85 * level : 0.25 + 0.2 * Math.abs(Math.sin(t * 2.3))
    case 'parole':
      return live ? 0.1 + 0.9 * level : 0.2 + 0.6 * Math.abs(Math.sin(t * 5.1) * Math.sin(t * 1.7 + 1))
    case 'reflexion':
      return 0.3
    case 'validation':
      return 0.08 + 0.05 * Math.sin(t * 1.6)
    case 'alerte':
      return 0.3 + 0.25 * Math.abs(Math.sin(t * 6))
    case 'injoignable':
      return 0
    default:
      return 0.05
  }
}

const GRIS = { dot: '110,126,138', bright: '150,164,174', core: '170,182,190' }
/** Alerte : le même rouge quel que soit le thème, pour qu'on ne la confonde jamais avec un autre état. */
const ROUGE = { dot: '255,107,94', bright: '255,196,186', core: '255,214,206' }

/** Couleurs des grains selon l'état : celles du thème (au repos, à l'écoute, en parlant), son contrepoint quand CODE réfléchit. */
export function orbColors(mode: OrbMode, theme?: ThemeId): { dot: string; bright: string; core: string } {
  const p = theme ? paletteOf(theme) : activePalette()
  if (mode === 'injoignable') return GRIS
  if (mode === 'alerte') return ROUGE
  return mode === 'reflexion' || mode === 'validation' ? p.pensee : p.orb
}

type Dessin = { mode: OrbMode; size: number; theme?: ThemeId; face: boolean }

function canvas2d(cv: HTMLCanvasElement, size: number): { ctx: CanvasRenderingContext2D; W: number; dpr: number } | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const W = Math.round(size * dpr)
  if (cv.width !== W) {
    cv.width = W
    cv.height = W
  }
  const ctx = cv.getContext('2d')
  return ctx ? { ctx, W, dpr } : null
}

/** Les autres formes : même respiration, mêmes couleurs d'état et même regard que la Nébule. */
function drawForme(cv: HTMLCanvasElement, forme: Exclude<OrbeId, 'nebule'>, t: number, e: number, elapsed: number, horloge: { h: number; dt: number; memo: Memo }, p: Dessin) {
  const surface = canvas2d(cv, p.size)
  if (!surface) return
  const { ctx, W, dpr } = surface
  const { dot, bright } = orbColors(p.mode, p.theme)
  const clair = (p.theme ? paletteOf(p.theme) : activePalette()).clair
  const R = W * 0.43 * (0.97 + 0.03 * Math.sin(t * 0.55)) * (1 + 0.07 * e)
  const c = W / 2
  ctx.clearRect(0, 0, W, W)
  ctx.save()
  // Alerte : l'orbe tremble.
  if (p.mode === 'alerte') ctx.translate(Math.sin(t * 43) * W * 0.006, 0)
  if (p.mode === 'injoignable') ctx.globalAlpha = 0.6
  // Sur un fond clair, la lumière ne s'additionne pas : elle se poserait en blanc sur blanc.
  ctx.globalCompositeOperation = clair ? 'source-over' : 'lighter'
  const regard = FORMES[forme](ctx, { W, c, R, dpr, dot, bright, clair, small: p.size < 120, h: horloge.h, dt: horloge.dt, elapsed }, t, e, p.mode, horloge.memo)
  ctx.globalCompositeOperation = 'source-over'
  if (p.face && regard > 0) drawFace(ctx, { c, R: regard, W, dpr }, p.mode, t, e, elapsed, bright, dot)
  ctx.restore()
}

function draw(cv: HTMLCanvasElement, s: Swarm, t: number, e: number, elapsed: number, p: Dessin) {
  const surface = canvas2d(cv, p.size)
  if (!surface) return
  const { ctx, W, dpr } = surface
  const { dot, bright, core } = orbColors(p.mode, p.theme)
  const small = p.size < 120
  const dim = p.mode === 'injoignable' ? 0.5 : 1
  const spin = p.mode === 'reflexion' ? 0.2 : p.mode === 'validation' ? 0.015 : p.mode === 'alerte' ? 0.08 : 0.03
  // Respiration lente + gonflement avec la voix.
  const R = W * 0.43 * (0.97 + 0.03 * Math.sin(t * 0.55)) * (1 + 0.07 * e)
  // Alerte : l'orbe tremble.
  const c = W / 2 + (p.mode === 'alerte' ? Math.sin(t * 43) * W * 0.006 : 0)
  const ry = t * spin
  const rx = 0.32 + 0.1 * Math.sin(t * 0.17)
  const sy = Math.sin(ry)
  const cy = Math.cos(ry)
  const sx = Math.sin(rx)
  const cx = Math.cos(rx)
  const base = dpr * (small ? 1.2 : 1.8)

  ctx.clearRect(0, 0, W, W)
  ctx.globalCompositeOperation = (p.theme ? paletteOf(p.theme) : activePalette()).clair ? 'source-over' : 'lighter'
  for (let i = 0; i < s.total; i++) {
    const x = s.pos[i * 3]!
    const y = s.pos[i * 3 + 1]!
    const z = s.pos[i * 3 + 2]!
    const x1 = x * cy - z * sy
    const z1 = x * sy + z * cy
    const y2 = y * cx - z1 * sx
    const z2 = y * sx + z1 * cx
    const k = 1 / (1 - z2 * 0.28)
    const depth = (z2 + 1) / 2
    // Scintillement propre à chaque grain, plus vif quand CODE parle.
    const twinkle = 0.75 + 0.25 * Math.sin(t * (1.2 + 1.8 * e) + s.phase[i]!)
    const isCore = i >= s.surface
    const fade = isCore ? Math.min(1, s.age[i]! * 6) * (1 - s.age[i]! * 0.5) : 1
    const flowGlow = isCore ? 1 : 0.45 + 0.85 * s.speed[i]!
    const alpha = (0.3 + 0.6 * depth) * twinkle * fade * flowGlow * dim
    const hot = twinkle > 0.96 && depth > 0.5
    ctx.fillStyle = `rgba(${hot ? bright : dot},${Math.min(1, alpha + (hot ? 0.25 : 0)).toFixed(3)})`
    const d = base * s.grain[i]! * (0.7 + 0.6 * depth) * (hot ? 1.3 : 1)
    ctx.fillRect(c + x1 * R * k - d / 2, c + y2 * R * k - d / 2, d, d)
  }

  if (p.face) {
    ctx.globalCompositeOperation = 'source-over'
    drawFace(ctx, { c, R, W, dpr }, p.mode, t, e, elapsed, bright, dot)
    return
  }

  // Cœur : un point blanc net, un halo discret.
  const cr = R * (0.055 + 0.015 * e)
  const g = ctx.createRadialGradient(c, c, 0, c, c, cr)
  g.addColorStop(0, `rgba(255,255,255,${(0.95 * dim).toFixed(2)})`)
  g.addColorStop(0.3, `rgba(${core},${(0.55 * dim).toFixed(2)})`)
  g.addColorStop(1, `rgba(${core},0)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(c, c, cr, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
}

/** Validation : CODE attend votre « oui » au plus 30 s (au-delà, l'action est annulée). */
const VALIDATION_S = 30

/** Clignement : ouverture de l'œil (1 ouvert, presque 0 fermé), un battement par période. */
function blink(t: number, period: number, offset = 0): number {
  const p = (t + offset) % period
  return p < 0.16 ? Math.max(0.06, Math.abs(Math.cos((p / 0.16) * Math.PI))) : 1
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath()
  ctx.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) / 2)
  ctx.fill()
}

/**
 * Le regard de Nébule, posé sur l'orbe : deux yeux de lumière qui disent l'état.
 * Veille : mi-clos. Écoute : ouverts, ils suivent la voix et clignent. Réflexion : levés, ils cherchent.
 * Parole : yeux rieurs et bouche au rythme de la voix. Validation : un sourcil levé, et le temps qui reste
 * en anneau. Alerte (rouge) : grands ronds, et des ondes qui partent de l'orbe. Injoignable : fermés.
 */
function drawFace(
  ctx: CanvasRenderingContext2D,
  g: { c: number; R: number; W: number; dpr: number },
  mode: OrbMode,
  t: number,
  e: number,
  elapsed: number,
  bright: string,
  glow: string
): void {
  const { c, R, W, dpr } = g
  const ex = R * 0.3
  const ey = c - R * 0.04
  const w = R * 0.15
  const H = R * 0.34
  const thin = Math.max(1.2 * dpr, R * 0.035)
  ctx.save()
  ctx.shadowColor = `rgba(${glow},0.95)`
  ctx.shadowBlur = Math.max(2 * dpr, R * 0.2)
  ctx.fillStyle = `rgba(${bright},${mode === 'injoignable' ? 0.55 : 1})`
  ctx.strokeStyle = ctx.fillStyle
  switch (mode) {
    case 'ecoute': {
      const open = blink(t, 3.6)
      const look = R * 0.07 * Math.sin(t * 0.55)
      const grow = 1 + 0.18 * e
      for (const side of [-1, 1]) pill(ctx, c + side * ex + look, ey, w * grow, Math.max(thin, H * open * grow))
      break
    }
    case 'reflexion': {
      const lx = R * 0.08 * Math.cos(t * 1.6)
      const ly = -R * 0.1 + R * 0.035 * Math.sin(t * 1.6)
      pill(ctx, c - ex + lx, ey + ly, w, H * 0.55)
      pill(ctx, c + ex + lx, ey + ly, w, H * 0.8)
      break
    }
    case 'parole': {
      const lift = -e * R * 0.05
      const aw = w * 1.6
      ctx.lineWidth = Math.max(thin, aw * 0.3)
      ctx.lineCap = 'round'
      for (const side of [-1, 1]) {
        const x = c + side * ex
        const y = ey + lift
        ctx.beginPath()
        ctx.moveTo(x - aw / 2, y + aw * 0.2)
        ctx.quadraticCurveTo(x, y - aw * 0.5, x + aw / 2, y + aw * 0.2)
        ctx.stroke()
      }
      pill(ctx, c, c + R * 0.3 + lift * 0.5, R * (0.1 + 0.18 * e), Math.max(thin, R * (0.03 + 0.13 * e)))
      break
    }
    case 'validation': {
      const open = blink(t, 4.4, 1)
      pill(ctx, c - ex, ey, w, Math.max(thin, H * 0.9 * open))
      ctx.save()
      ctx.translate(c + ex, ey - R * 0.06)
      ctx.rotate(-0.32)
      pill(ctx, 0, 0, w, Math.max(thin, H * 0.55 * open))
      ctx.restore()
      break
    }
    case 'alerte': {
      const r = w * 0.85 * (1 + 0.12 * Math.sin(t * 12))
      for (const side of [-1, 1]) {
        ctx.beginPath()
        ctx.arc(c + side * ex, ey, r, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    case 'injoignable':
      for (const side of [-1, 1]) pill(ctx, c + side * ex, ey + R * 0.07, w * 1.2, thin)
      break
    default: {
      // Veille : mi-clos, la paupière respire.
      const open = 0.12 + 0.05 * Math.sin(t * 0.9)
      for (const side of [-1, 1]) pill(ctx, c + side * ex, ey + R * 0.07, w * 1.2, Math.max(thin, H * open))
    }
  }
  ctx.restore()

  // Alerte : deux ondes qui partent du bord de l'orbe, jusqu'au bord du dessin.
  if (mode === 'alerte' && W >= 40 * dpr) {
    ctx.lineWidth = Math.max(dpr, W * 0.01)
    for (const k of [0, 0.5]) {
      const f = (t * 0.8 + k) % 1
      ctx.strokeStyle = `rgba(${glow},${(0.7 * (1 - f)).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(c, c, R + (W * 0.49 - R) * f, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  // Le temps qui reste pour valider, en anneau autour de l'orbe (trop fin sous 40 px).
  if (mode === 'validation' && W >= 40 * dpr) {
    const left = Math.max(0, 1 - elapsed / VALIDATION_S)
    const r = W * 0.475
    ctx.lineWidth = Math.max(dpr, W * 0.012)
    ctx.lineCap = 'round'
    ctx.strokeStyle = `rgba(${glow},0.18)`
    ctx.beginPath()
    ctx.arc(c, c, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = `rgba(${bright},0.9)`
    ctx.beginPath()
    ctx.arc(c, c, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left)
    ctx.stroke()
  }
}
