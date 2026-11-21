import { useEffect, useRef } from 'react'
import { orbColors, targetEnergy, type OrbMode } from './Orb.tsx'

type Props = {
  mode: OrbMode
  /** Volume réel (0..1), ou -1 pour laisser le halo s'animer seul. */
  level?: () => number
  /** D'où partent les grains à l'apparition (là où était l'orbe), en fraction de l'écran. */
  origin?: { x: number; y: number }
}

/**
 * L'orbe éparpillée sur les bords de l'écran : quand une interface prend la place,
 * les grains quittent le centre et viennent courir le long du cadre, en halo vivant
 * qui garde les couleurs de l'état de CODE et s'élargit avec la voix.
 */
type Grain = { s: number; d: number; v: number; phase: number; size: number; ox: number; oy: number }

const COUNT = 320
const CORNER = 46 // rayon des coins de l'écran (iPhone)
const INTRO_S = 1.1
const FPS = 30

function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Point du cadre (rectangle aux coins arrondis) à la position s (0..1) et sa normale vers l'intérieur. */
function frame(s: number, w: number, h: number, r: number): { x: number; y: number; nx: number; ny: number } {
  const straightW = w - 2 * r
  const straightH = h - 2 * r
  const arc = (Math.PI * r) / 2
  const total = 2 * straightW + 2 * straightH + 4 * arc
  let p = (((s % 1) + 1) % 1) * total
  const seg = (len: number) => {
    const inside = p <= len
    if (!inside) p -= len
    return inside
  }
  const corner = (cx: number, cy: number, a0: number) => {
    const a = a0 + (p / arc) * (Math.PI / 2)
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, nx: -Math.cos(a), ny: -Math.sin(a) }
  }
  if (seg(straightW)) return { x: r + p, y: 0, nx: 0, ny: 1 }
  if (seg(arc)) return corner(w - r, r, -Math.PI / 2)
  if (seg(straightH)) return { x: w, y: r + p, nx: -1, ny: 0 }
  if (seg(arc)) return corner(w - r, h - r, 0)
  if (seg(straightW)) return { x: w - r - p, y: h, nx: 0, ny: -1 }
  if (seg(arc)) return corner(r, h - r, Math.PI / 2)
  if (seg(straightH)) return { x: 0, y: h - r - p, nx: 1, ny: 0 }
  return corner(r, r, Math.PI)
}

export function EdgeSwarm({ mode, level, origin = { x: 0.5, y: 0.42 } }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const props = useRef({ mode, level })
  props.current = { mode, level }

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const rnd = seeded(7)
    const grains: Grain[] = Array.from({ length: COUNT }, () => {
      // Départ groupé, comme l'orbe qu'ils quittent.
      const a = rnd() * Math.PI * 2
      const r = Math.sqrt(rnd()) * 70
      return { s: rnd(), d: rnd() ** 1.8, v: (rnd() < 0.5 ? -1 : 1) * (0.4 + rnd()), phase: rnd() * Math.PI * 2, size: 0.7 + rnd() * 0.8, ox: Math.cos(a) * r, oy: Math.sin(a) * r }
    })
    const t0 = performance.now()
    let last = t0
    let lastDraw = 0
    let energy = 0
    let raf = 0

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (document.hidden || now - lastDraw < 1000 / FPS) return
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      lastDraw = now
      const t = (now - t0) / 1000
      const { mode: m, level: lv } = props.current
      const target = targetEnergy(m, t, lv?.() ?? -1)
      energy += (target - energy) * (target > energy ? 0.4 : 0.1)

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = window.innerWidth
      const h = window.innerHeight
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr)
        cv.height = Math.round(h * dpr)
      }
      const ctx = cv.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const { dot, bright } = orbColors(m)
      const dim = m === 'injoignable' ? 0.45 : 1
      const intro = reduced ? 1 : 1 - Math.pow(1 - Math.min(1, t / INTRO_S), 3)
      const band = (8 + 16 * energy) * (0.6 + 0.4 * intro)

      // Lueur douce le long du cadre, plus vive quand la voix monte.
      const glow = (0.045 + 0.15 * energy) * intro * dim
      for (const [x, y, gw, gh, x0, y0, x1, y1] of [
        [0, 0, w, band * 2.2, 0, 0, 0, band * 2.2],
        [0, h - band * 2.2, w, band * 2.2, 0, h, 0, h - band * 2.2],
        [0, 0, band * 2.2, h, 0, 0, band * 2.2, 0],
        [w - band * 2.2, 0, band * 2.2, h, w, 0, w - band * 2.2, 0]
      ] as const) {
        const g = ctx.createLinearGradient(x0, y0, x1, y1)
        g.addColorStop(0, `rgba(${dot},${glow.toFixed(3)})`)
        g.addColorStop(1, `rgba(${dot},0)`)
        ctx.fillStyle = g
        ctx.fillRect(x, y, gw, gh)
      }

      ctx.globalCompositeOperation = 'lighter'
      const cx = origin.x * w
      const cy = origin.y * h
      const flow = (m === 'reflexion' ? 0.05 : 0.018) + 0.05 * energy
      for (const g of grains) {
        if (!reduced) g.s += g.v * flow * dt * 0.1
        const p = frame(g.s, w, h, CORNER)
        // Profondeur : collée au bord, avec un frémissement propre à chaque grain.
        const depth = 1.5 + g.d * band + Math.sin(t * (1.3 + 2.2 * energy) + g.phase) * (1 + 2 * energy)
        const ex = p.x + p.nx * depth
        const ey = p.y + p.ny * depth
        const x = cx + g.ox + (ex - cx - g.ox) * intro
        const y = cy + g.oy + (ey - cy - g.oy) * intro
        const twinkle = 0.7 + 0.3 * Math.sin(t * (1.4 + 2 * energy) + g.phase * 3)
        const alpha = (0.25 + 0.45 * (1 - g.d)) * twinkle * (0.5 + 0.4 * energy) * dim
        const hot = twinkle > 0.97
        ctx.fillStyle = `rgba(${hot ? bright : dot},${Math.min(1, alpha).toFixed(3)})`
        const size = g.size * (hot ? 2 : 1.4) * (1 + 0.25 * energy)
        ctx.fillRect(x - size / 2, y - size / 2, size, size)
      }
      ctx.globalCompositeOperation = 'source-over'
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [origin.x, origin.y])

  return <canvas ref={canvas} className="code-edge-swarm" aria-hidden="true" />
}
