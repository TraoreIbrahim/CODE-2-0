import type { OrbeId } from '@code/protocol'
import type { OrbMode } from './Orb.tsx'

/**
 * Les formes de l'orbe autres que la Nébule (dessinée dans Orb.tsx). Chacune se dessine sur le même
 * canevas, avec les couleurs de l'état, et rend le rayon où poser le regard (0 : elle a son propre visage).
 */

export type Geo = {
  W: number
  c: number
  /** Rayon de l'orbe, qui respire et gonfle avec la voix. */
  R: number
  dpr: number
  dot: string
  bright: string
  /** Thème clair : rien ne s'additionne à la lumière du fond. */
  clair: boolean
  /** Petite orbe (aperçus) : moins de grains. */
  small: boolean
  /** Horloge propre de l'orbe : elle avance plus vite quand la voix monte ou que CODE réfléchit. */
  h: number
  dt: number
  /** Secondes passées dans l'état en cours (compte à rebours de la validation). */
  elapsed: number
}

/** Caches propres à une orbe (grains tirés une fois, phase des ondes). */
export type Memo = Record<string, unknown>

type Dessin = (ctx: CanvasRenderingContext2D, g: Geo, t: number, e: number, mode: OrbMode, memo: Memo) => number

const VALIDATION_S = 30

const rgba = (rgb: string, a: number) => `rgba(${rgb},${Math.max(0, Math.min(1, a)).toFixed(3)})`

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

/** Rotation (autour de y puis de x) et légère perspective : [x, y, profondeur 0..1]. */
function proj(x: number, y: number, z: number, a: number, b: number): [number, number, number] {
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const cb = Math.cos(b)
  const sb = Math.sin(b)
  const x1 = x * ca - z * sa
  const z1 = x * sa + z * ca
  const y2 = y * cb - z1 * sb
  const z2 = y * sb + z1 * cb
  const k = 1 / (1 - z2 * 0.28)
  return [x1 * k, y2 * k, (z2 + 1) / 2]
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, string][]): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  for (const [o, c] of stops) g.addColorStop(o, c)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

const anneaux: Dessin = (ctx, g, t, e, mode) => {
  const { c, R, dpr, dot, bright } = g
  const vite = mode === 'reflexion' ? 2.2 : 1
  const bagues: [number, number, number, number, number][] = [
    [0.58, 1.15, 0.2, 0.9, g.small ? 70 : 150],
    [0.78, -0.75, 1.1, -0.6, g.small ? 90 : 200],
    [0.97, 0.45, -0.85, 0.35, g.small ? 110 : 250]
  ]
  const base = dpr * (g.small ? 1.2 : 1.7)
  bagues.forEach(([r0, tx, ty, sp, n], b) => {
    const ct = Math.cos(tx)
    const st = Math.sin(tx)
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + t * sp * (0.4 + 0.8 * e) * vite
      const r = r0 * (1 + 0.06 * e * Math.sin(a * 6 + t * 4))
      const z0 = Math.sin(a) * r
      const p = proj(Math.cos(a) * r, -z0 * st, z0 * ct, ty + t * 0.08, 0.28)
      const tw = 0.6 + 0.4 * Math.sin(a * 3 + t * 2 + b)
      ctx.fillStyle = rgba(tw > 0.95 ? bright : dot, (0.2 + 0.75 * p[2]) * tw)
      const d = base * (0.6 + 0.7 * p[2])
      ctx.fillRect(c + p[0] * R - d / 2, c + p[1] * R - d / 2, d, d)
    }
  })
  glow(ctx, c, c, R * 0.34 * (1 + 0.18 * e), [
    [0, rgba(bright, 0.95)],
    [0.45, rgba(dot, 0.55)],
    [1, rgba(dot, 0)]
  ])
  return R * 0.62
}

const filaments: Dessin = (ctx, g, t, e, mode) => {
  const { c, R, dpr, dot, bright } = g
  const ry = t * (mode === 'reflexion' ? 0.7 : 0.22)
  const rx = 0.35 + 0.12 * Math.sin(t * 0.2)
  const pt = (phi: number, th: number) => {
    const r = 0.95 * (1 + 0.07 * e * Math.sin(5 * th + 3 * phi + t * 4) + 0.02 * Math.sin(t * 1.3 + phi * 4))
    return proj(Math.cos(phi) * Math.cos(th) * r, Math.sin(phi) * r, Math.cos(phi) * Math.sin(th) * r, ry, rx)
  }
  ctx.lineWidth = dpr * (g.small ? 0.8 : 1.1)
  const trait = (a: [number, number, number], b: [number, number, number]) => {
    const d = (a[2] + b[2]) / 2
    ctx.strokeStyle = rgba(d > 0.8 ? bright : dot, 0.12 + 0.75 * d * d)
    ctx.beginPath()
    ctx.moveTo(c + a[0] * R, c + a[1] * R)
    ctx.lineTo(c + b[0] * R, c + b[1] * R)
    ctx.stroke()
  }
  const pas = g.small ? 32 : 64
  for (let la = -3; la <= 3; la++) {
    const phi = (la * Math.PI) / 8
    let prev = pt(phi, 0)
    for (let s = 1; s <= pas; s++) {
      const p = pt(phi, (s / pas) * Math.PI * 2)
      trait(prev, p)
      prev = p
    }
  }
  for (let m = 0; m < 10; m++) {
    const th = (m / 10) * Math.PI
    let prev = pt(-Math.PI / 2, th)
    for (let s = 1; s <= pas * 0.75; s++) {
      const p = pt(-Math.PI / 2 + (s / (pas * 0.75)) * Math.PI * 2, th)
      trait(prev, p)
      prev = p
    }
  }
  return R
}

const onde: Dessin = (ctx, g, t, e, mode) => {
  const { c, R, dpr, dot, bright } = g
  glow(ctx, c, c, R * 0.8, [
    [0, rgba(dot, 0.16)],
    [1, rgba(dot, 0)]
  ])
  const boucles: [number, number, number, string, number][] = [
    [3, 1.3, 0.07, dot, 2.4],
    [5, -1.7, 0.06, bright, 1.6],
    [7, 2.3, 0.045, dot, 1.2],
    [2, -0.9, 0.08, bright, 1]
  ]
  const vite = mode === 'reflexion' ? 2 : 1
  boucles.forEach(([k, w, amp, rgb, lw], b) => {
    ctx.strokeStyle = rgba(rgb, 0.75 - b * 0.12)
    ctx.lineWidth = dpr * lw
    ctx.beginPath()
    for (let i = 0; i <= 200; i++) {
      const th = (i / 200) * Math.PI * 2
      const r = 0.8 + amp * (0.35 + 1.3 * e) * (Math.sin(k * th + t * w * vite) + 0.4 * Math.sin((k + 2) * th - t * w * 0.7))
      const x = c + Math.cos(th) * r * R
      const y = c + Math.sin(th) * r * R
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
  })
  return R * 0.9
}

/** Les douze sommets et trente arêtes d'un icosaèdre (sommets sur la sphère unité). */
const ICO = (() => {
  const f = (1 + Math.sqrt(5)) / 2
  const v: number[][] = []
  for (const a of [-1, 1]) for (const b of [-1, 1]) v.push([0, a, b * f], [a, b * f, 0], [b * f, 0, a])
  const n = Math.hypot(1, f)
  const sommets = v.map((p) => p.map((q) => q / n) as [number, number, number])
  const aretes: [number, number][] = []
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++) {
      const [a, b] = [sommets[i]!, sommets[j]!]
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1.1) aretes.push([i, j])
    }
  return { sommets, aretes }
})()

const cristal: Dessin = (ctx, g, t, e, mode) => {
  const { c, R, dpr, dot, bright } = g
  const vite = mode === 'reflexion' ? 2.5 : 1
  const dessin = (echelle: number, ry: number, rx: number, alpha: number, lw: number) => {
    const P = ICO.sommets.map((p) => proj(p[0] * echelle, p[1] * echelle, p[2] * echelle, ry, rx))
    ctx.lineWidth = dpr * lw
    for (const [i, j] of ICO.aretes) {
      const a = P[i]!
      const b = P[j]!
      const d = (a[2] + b[2]) / 2
      ctx.strokeStyle = rgba(d > 0.75 ? bright : dot, (0.15 + 0.8 * d) * alpha)
      ctx.beginPath()
      ctx.moveTo(c + a[0] * R, c + a[1] * R)
      ctx.lineTo(c + b[0] * R, c + b[1] * R)
      ctx.stroke()
    }
    for (const p of P) {
      const d = dpr * (2 + 2.5 * p[2]) * (lw / 1.5)
      ctx.fillStyle = rgba(bright, (0.3 + 0.7 * p[2]) * alpha)
      ctx.fillRect(c + p[0] * R - d / 2, c + p[1] * R - d / 2, d, d)
    }
  }
  const s = 0.95 * (1 + 0.07 * e)
  dessin(s, t * 0.3 * vite, t * 0.17 * vite, 1, 1.6)
  dessin(s * 0.5, -t * 0.45 * vite, t * 0.3 * vite, 0.55, 1)
  glow(ctx, c, c, R * 0.22 * (1 + 0.3 * e), [
    [0, rgba(bright, 0.8)],
    [1, rgba(dot, 0)]
  ])
  return R * 0.8
}

const pulsar: Dessin = (ctx, g, t, e, mode, memo) => {
  const { c, R, dpr, dot, bright } = g
  const vite = mode === 'reflexion' ? 0.9 : 0.25 + 0.4 * e
  const ph = ((memo.ph as number | undefined) ?? 0) + g.dt * vite
  memo.ph = ph
  for (let i = 0; i < 5; i++) {
    const p = (ph + i / 5) % 1
    ctx.strokeStyle = rgba(i % 2 ? bright : dot, (1 - p) * 0.8)
    ctx.lineWidth = dpr * (2.4 - p * 1.8)
    ctx.beginPath()
    ctx.arc(c, c, R * (0.42 + 0.58 * p), 0, Math.PI * 2)
    ctx.stroke()
  }
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2 + t * 0.1
    const d = dpr * 1.6
    ctx.fillStyle = rgba(dot, 0.25 + 0.25 * Math.sin(a * 4 + t * 2))
    ctx.fillRect(c + Math.cos(a) * R - d / 2, c + Math.sin(a) * R - d / 2, d, d)
  }
  const cr = R * 0.4 * (1 + 0.12 * e)
  const grad = ctx.createRadialGradient(c - cr * 0.25, c - cr * 0.3, 0, c, c, cr)
  grad.addColorStop(0, rgba(bright, 1))
  grad.addColorStop(0.35, rgba(bright, 0.75))
  grad.addColorStop(0.75, rgba(dot, 0.45))
  grad.addColorStop(1, rgba(dot, 0))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(c, c, cr, 0, Math.PI * 2)
  ctx.fill()
  return R * 0.62
}

/** Contour d'une goutte qui ondule : trois ondes superposées, plus amples avec la voix. */
function goutte(ctx: CanvasRenderingContext2D, c: number, base: number, t: number, e: number, vite: number, ph: number): void {
  ctx.beginPath()
  for (let i = 0; i <= 120; i++) {
    const th = (i / 120) * Math.PI * 2
    const r =
      base *
      (1 +
        (0.025 + 0.09 * e) * Math.sin(3 * th + t * 1.3 * vite + ph) +
        (0.02 + 0.05 * e) * Math.sin(5 * th - t * 1.9 * vite + ph * 2) +
        0.015 * Math.sin(7 * th + t * 2.6 + ph))
    const x = c + Math.cos(th) * r
    const y = c + Math.sin(th) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

const liquide: Dessin = (ctx, g, t, e, mode) => {
  const { c, R, dpr, dot, bright, clair } = g
  const vite = mode === 'reflexion' ? 1.8 : 1
  const base = R * 0.84
  const halo = ctx.createRadialGradient(c, c, base * 0.6, c, c, base * 1.18)
  halo.addColorStop(0, rgba(dot, 0.22))
  halo.addColorStop(1, rgba(dot, 0))
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(c, c, base * 1.18, 0, Math.PI * 2)
  ctx.fill()
  const corps = ctx.createRadialGradient(c - base * 0.3, c - base * 0.35, base * 0.05, c, c, base * 1.05)
  corps.addColorStop(0, rgba(bright, 0.95))
  corps.addColorStop(0.35, rgba(dot, 0.75))
  corps.addColorStop(0.8, rgba(dot, 0.35))
  corps.addColorStop(1, rgba(dot, 0.15))
  ctx.fillStyle = corps
  goutte(ctx, c, base, t, e, vite, 0)
  ctx.fill()
  ctx.strokeStyle = rgba(bright, 0.55)
  ctx.lineWidth = dpr * 1.5
  ctx.stroke()
  for (let k = 1; k <= 2; k++) {
    ctx.strokeStyle = rgba(bright, 0.2)
    ctx.lineWidth = dpr
    goutte(ctx, c, base * (1 - k * 0.2), t * 1.2, e, vite, k * 2.1)
    ctx.stroke()
  }
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = `rgba(255,255,255,${clair ? 0.6 : 0.35})`
  ctx.beginPath()
  ctx.ellipse(c - base * 0.36, c - base * 0.46, base * 0.22, base * 0.09, -0.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  return base
}

const mercure: Dessin = (ctx, g, t, e, mode) => {
  const { c, R, dpr, dot, bright, clair } = g
  const vite = mode === 'reflexion' ? 1.8 : 1
  const base = R * 0.8
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  const lin = ctx.createLinearGradient(0, c - base, 0, c + base)
  lin.addColorStop(0, `rgb(${bright})`)
  lin.addColorStop(0.4, rgba(dot, 1))
  lin.addColorStop(0.52, clair ? '#33404c' : '#0a1016')
  lin.addColorStop(0.64, rgba(dot, 0.9))
  lin.addColorStop(1, `rgb(${bright})`)
  ctx.fillStyle = lin
  goutte(ctx, c, base, t, e, vite, 1)
  ctx.fill()
  const sh = ctx.createRadialGradient(c - base * 0.25, c - base * 0.3, base * 0.1, c, c, base * 1.05)
  sh.addColorStop(0, 'rgba(255,255,255,0.4)')
  sh.addColorStop(0.55, 'rgba(255,255,255,0)')
  sh.addColorStop(1, 'rgba(0,0,0,0.5)')
  ctx.fillStyle = sh
  ctx.fill()
  ctx.strokeStyle = rgba(bright, 0.75)
  ctx.lineWidth = dpr * 1.2
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.beginPath()
  ctx.ellipse(c - base * 0.32, c - base * 0.5, base * 0.26, base * 0.06, -0.35, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  return base
}

type Comete = { r: number; inc: number; noeud: number; v: number; a0: number; ph: number }

const particules: Dessin = (ctx, g, t, e, _mode, memo) => {
  const { c, R, dpr, dot, bright } = g
  if (!memo.comete) {
    const rnd = seeded(77)
    memo.comete = Array.from({ length: g.small ? 140 : 420 }, () => ({
      r: 0.22 + 0.85 * Math.pow(rnd(), 0.7),
      inc: (rnd() - 0.5) * 2.4,
      noeud: rnd() * Math.PI * 2,
      v: (0.3 + 0.7 * rnd()) * (rnd() < 0.5 ? -1 : 1),
      a0: rnd() * Math.PI * 2,
      ph: rnd() * Math.PI * 2
    }))
  }
  const pos = (q: Comete, a: number, rr: number) => {
    const x = Math.cos(a) * rr
    const z = Math.sin(a) * rr
    const y1 = -z * Math.sin(q.inc)
    const z1 = z * Math.cos(q.inc)
    const cn = Math.cos(q.noeud)
    const sn = Math.sin(q.noeud)
    return proj(x * cn - z1 * sn, y1, x * sn + z1 * cn, t * 0.05, 0.25)
  }
  ctx.lineCap = 'round'
  for (const q of memo.comete as Comete[]) {
    const rr = q.r * (1 + 0.25 * e * Math.sin(q.ph + t * 3))
    const a = q.a0 + g.h * q.v
    const p1 = pos(q, a, rr)
    const p0 = pos(q, a - Math.sign(q.v) * (0.08 + 0.14 * e), rr)
    ctx.strokeStyle = rgba(p1[2] > 0.8 ? bright : dot, 0.15 + 0.8 * p1[2])
    ctx.lineWidth = dpr * (0.8 + 1.4 * p1[2])
    ctx.beginPath()
    ctx.moveTo(c + p0[0] * R, c + p0[1] * R)
    ctx.lineTo(c + p1[0] * R, c + p1[1] * R)
    ctx.stroke()
  }
  glow(ctx, c, c, R * 0.2 * (1 + 0.3 * e), [
    [0, rgba(bright, 0.9)],
    [1, rgba(dot, 0)]
  ])
  return R * 0.75
}

type Etoile = { d: number; a0: number; y: number; s: number; ph: number }

const galaxie: Dessin = (ctx, g, t, e, _mode, memo) => {
  const { c, R, dpr, dot, bright } = g
  if (!memo.etoiles) {
    const rnd = seeded(311)
    memo.etoiles = Array.from({ length: g.small ? 450 : 1500 }, (_, i) => {
      const d = Math.pow(rnd(), 1.4)
      return { d, a0: ((i % 3) * Math.PI * 2) / 3 + d * 4.2 + (rnd() - 0.5) * 0.7 * (1 - d * 0.4), y: (rnd() - 0.5) * 0.1 * (1 - d), s: 0.6 + rnd() * 0.8, ph: rnd() * Math.PI * 2 }
    })
  }
  const base = dpr * (g.small ? 1.1 : 1.5)
  for (const q of memo.etoiles as Etoile[]) {
    const a = q.a0 + (g.h * 0.35) / (q.d + 0.25)
    const r = q.d * 0.98 * (1 + 0.06 * e)
    const p = proj(Math.cos(a) * r, q.y, Math.sin(a) * r, 0, 1.05)
    const tw = 0.7 + 0.3 * Math.sin(t * 2 + q.ph)
    ctx.fillStyle = rgba(q.d < 0.22 ? bright : dot, (0.25 + 0.6 * (1 - q.d)) * tw * (0.6 + 0.4 * p[2]))
    const d = base * q.s * (0.7 + 0.5 * p[2])
    ctx.fillRect(c + p[0] * R - d / 2, c + p[1] * R - d / 2, d, d)
  }
  glow(ctx, c, c, R * 0.2 * (1 + 0.3 * e), [
    [0, rgba(bright, 1)],
    [0.4, rgba(bright, 0.5)],
    [1, rgba(dot, 0)]
  ])
  return R * 0.55
}

/** Filaments souples : chacun ondule et sa pointe glisse lentement sur la paroi, sans saut d'une image à l'autre. */
const plasma: Dessin = (ctx, g, t, e) => {
  const { c, R, dpr, dot, bright } = g
  const verre = ctx.createRadialGradient(c, c, R * 0.5, c, c, R * 0.96)
  verre.addColorStop(0, rgba(dot, 0))
  verre.addColorStop(1, rgba(dot, 0.12))
  ctx.fillStyle = verre
  ctx.beginPath()
  ctx.arc(c, c, R * 0.96, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = rgba(dot, 0.3)
  ctx.lineWidth = dpr
  ctx.stroke()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  glow(ctx, c, c, R * 0.42, [
    [0, rgba(dot, 0.28 + 0.2 * e)],
    [1, rgba(dot, 0)]
  ])
  const n = 7
  for (let k = 0; k < n; k++) {
    const s = k * 1.7 + 0.3
    const th = (k / n) * Math.PI * 2 + 0.55 * Math.sin(g.h * 0.32 + s) + 0.22 * Math.sin(g.h * 0.85 + s * 2)
    const tx = Math.cos(th)
    const ty = Math.sin(th)
    const vie = (0.55 + 0.45 * Math.sin(t * (0.7 + 0.25 * (k % 3)) + s)) * (0.75 + 0.25 * e)
    const pts: [number, number][] = []
    for (let i = 0; i <= 28; i++) {
      const f = i / 28
      const env = Math.sin(Math.PI * Math.min(1, f * 1.08)) * (1 - 0.35 * f)
      const ond = (0.06 + 0.07 * e) * env * (0.6 * Math.sin(f * 6.5 + g.h * 1.6 + s) + 0.3 * Math.sin(f * 12 - g.h * 2.3 + s * 3) + 0.12 * Math.sin(f * 21 + g.h * 3.4 + s))
      pts.push([c + (tx * f * 0.93 - ty * ond) * R, c + (ty * f * 0.93 + tx * ond) * R])
    }
    const trace = () => {
      ctx.beginPath()
      ctx.moveTo(pts[0]![0], pts[0]![1])
      for (let i = 1; i < pts.length - 1; i++) ctx.quadraticCurveTo(pts[i]![0], pts[i]![1], (pts[i]![0] + pts[i + 1]![0]) / 2, (pts[i]![1] + pts[i + 1]![1]) / 2)
      ctx.lineTo(pts[pts.length - 1]![0], pts[pts.length - 1]![1])
    }
    for (const [lw, al, rgb] of [
      [7, 0.07, dot],
      [3.2, 0.16, dot],
      [1.3, 0.85, bright]
    ] as const) {
      ctx.strokeStyle = rgba(rgb, al * vie)
      ctx.lineWidth = dpr * lw
      trace()
      ctx.stroke()
    }
    const fin = pts[pts.length - 1]!
    glow(ctx, fin[0], fin[1], R * 0.11, [
      [0, rgba(bright, 0.65 * vie)],
      [1, rgba(dot, 0)]
    ])
  }
  glow(ctx, c, c, R * 0.16 * (1 + 0.2 * e), [
    [0, 'rgba(255,255,255,0.95)'],
    [0.45, rgba(bright, 0.75)],
    [1, rgba(dot, 0)]
  ])
  return R * 0.6
}

type Astre = { x: number; y: number; z: number; ph: number }

const constellation: Dessin = (ctx, g, t, e, _mode, memo) => {
  const { c, R, dpr, dot, bright } = g
  if (!memo.astres) {
    const rnd = seeded(907)
    memo.astres = Array.from({ length: g.small ? 40 : 80 }, () => {
      const y = 2 * rnd() - 1
      const r = Math.sqrt(1 - y * y)
      const th = rnd() * Math.PI * 2
      return { x: r * Math.cos(th), y, z: r * Math.sin(th), ph: rnd() * Math.PI * 2 }
    })
  }
  const P = (memo.astres as Astre[]).map((q) => {
    const k = 0.92 * (1 + 0.08 * e * Math.sin(q.ph + t * 2.5))
    return proj(q.x * k, q.y * k, q.z * k, g.h * 0.4, 0.3)
  })
  const seuil = (g.small ? 0.55 : 0.42) + 0.25 * e
  ctx.lineWidth = dpr
  for (let i = 0; i < P.length; i++)
    for (let j = i + 1; j < P.length; j++) {
      const a = P[i]!
      const b = P[j]!
      const d = Math.hypot(a[0] - b[0], a[1] - b[1])
      if (d >= seuil) continue
      ctx.strokeStyle = rgba(dot, (1 - d / seuil) * 0.7 * ((a[2] + b[2]) / 2))
      ctx.beginPath()
      ctx.moveTo(c + a[0] * R, c + a[1] * R)
      ctx.lineTo(c + b[0] * R, c + b[1] * R)
      ctx.stroke()
    }
  for (const p of P) {
    ctx.fillStyle = rgba(p[2] > 0.7 ? bright : dot, 0.3 + 0.7 * p[2])
    ctx.beginPath()
    ctx.arc(c + p[0] * R, c + p[1] * R, (dpr * (1.5 + 2.8 * p[2])) / 2, 0, Math.PI * 2)
    ctx.fill()
  }
  return R
}

/** Clignement : 1 ouvert, presque 0 fermé, un battement par période. */
function cligne(t: number, periode: number): number {
  const p = t % periode
  return p < 0.16 ? Math.max(0.06, Math.abs(Math.cos((p / 0.16) * Math.PI))) : 1
}

/**
 * Le robot : une petite tête à écran de pixels. Ses yeux, son antenne et sa couleur disent l'état ;
 * il a son propre visage (le regard commun ne se pose pas sur lui).
 */
const robot: Dessin = (ctx, g, t, e, mode) => {
  const { W, c, dot, bright, clair } = g
  ctx.globalCompositeOperation = 'source-over'
  const veille = mode === 'repos'
  const eteint = mode === 'injoignable'
  const a = veille ? 0.55 : eteint ? 0.45 : 1
  const tilt = veille || eteint ? -0.09 + 0.01 * Math.sin(t * 0.6) : mode === 'reflexion' ? 0.07 + 0.02 * Math.sin(t * 1.2) : 0.025 * Math.sin(t * 0.8)
  const bob = eteint ? 0 : (veille ? 0.006 : 0.012) * W * Math.sin(t * (veille ? 0.9 : 1.6))

  // Lueur au sol.
  const oy = c + 0.34 * W
  ctx.save()
  ctx.translate(c, oy)
  ctx.scale(1, 0.28)
  glow(ctx, 0, 0, 0.22 * W, [
    [0, rgba(dot, (0.3 + 0.2 * e) * a)],
    [1, rgba(dot, 0)]
  ])
  ctx.restore()

  // Écoute : les ondes de votre voix, de part et d'autre.
  if (mode === 'ecoute') {
    ctx.lineCap = 'round'
    ctx.lineWidth = 0.009 * W
    for (const s of [-1, 1])
      for (let k = 0; k < 2; k++) {
        ctx.strokeStyle = rgba(dot, (0.25 + 0.6 * e) * (1 - k * 0.45))
        const r = 0.37 * W + k * 0.04 * W + e * 0.012 * W
        const m = s > 0 ? 0 : Math.PI
        ctx.beginPath()
        ctx.arc(c, c + bob, r, m - 0.33, m + 0.33)
        ctx.stroke()
      }
  }

  ctx.save()
  ctx.translate(c, c + bob)
  ctx.rotate(tilt)
  const coque = clair ? '#e3ebf1' : '#081318'

  for (const s of [-1, 1]) {
    ctx.fillStyle = coque
    ctx.strokeStyle = rgba(dot, 0.75 * a)
    ctx.lineWidth = 0.012 * W
    ctx.beginPath()
    ctx.arc(s * 0.3 * W, 0.01 * W, 0.06 * W, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = rgba(dot, 0.35 * a)
    ctx.beginPath()
    ctx.arc(s * 0.3 * W, 0.01 * W, 0.022 * W, 0, Math.PI * 2)
    ctx.fill()
  }

  const tip: [number, number] = [0.012 * W, -0.37 * W]
  ctx.strokeStyle = rgba(dot, 0.7 * a)
  ctx.lineWidth = 0.012 * W
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, -0.2 * W)
  ctx.lineTo(tip[0], tip[1])
  ctx.stroke()

  const tete = ctx.createLinearGradient(0, -0.21 * W, 0, 0.21 * W)
  tete.addColorStop(0, clair ? '#ffffff' : '#17323c')
  tete.addColorStop(1, clair ? '#d6e1e9' : '#07131a')
  ctx.fillStyle = tete
  ctx.beginPath()
  ctx.roundRect(-0.28 * W, -0.21 * W, 0.56 * W, 0.42 * W, 0.19 * W)
  ctx.fill()
  ctx.fillStyle = rgba(dot, 0.05)
  ctx.fill()
  ctx.strokeStyle = rgba(dot, 0.9 * a)
  ctx.lineWidth = 0.014 * W
  ctx.stroke()
  ctx.strokeStyle = clair ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 0.012 * W
  ctx.beginPath()
  ctx.moveTo(-0.18 * W, -0.165 * W)
  ctx.quadraticCurveTo(-0.09 * W, -0.195 * W, 0, -0.195 * W)
  ctx.stroke()

  // L'antenne : éteinte en veille, des étincelles quand il cherche, le temps qui reste quand il attend votre oui.
  const pouls = mode === 'alerte' ? 0.75 + 0.25 * Math.sin(t * 12) : 1
  if (!veille && !eteint)
    glow(ctx, tip[0], tip[1], 0.07 * W, [
      [0, rgba(dot, 0.55 * pouls)],
      [1, rgba(dot, 0)]
    ])
  ctx.fillStyle = rgba(veille || eteint ? '110,126,138' : bright, veille || eteint ? 0.7 : pouls)
  ctx.beginPath()
  ctx.arc(tip[0], tip[1], 0.028 * W, 0, Math.PI * 2)
  ctx.fill()
  if (mode === 'reflexion') {
    for (let k = 0; k < 3; k++) {
      const an = t * 3 + k * 2.1
      ctx.fillStyle = rgba(bright, 0.9)
      ctx.beginPath()
      ctx.arc(tip[0] + Math.cos(an) * 0.055 * W, tip[1] + Math.sin(an) * 0.04 * W, 0.009 * W, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (mode === 'validation') {
    const left = Math.max(0, 1 - g.elapsed / VALIDATION_S)
    ctx.lineWidth = 0.008 * W
    ctx.strokeStyle = rgba(dot, 0.2)
    ctx.beginPath()
    ctx.arc(tip[0], tip[1], 0.052 * W, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = rgba(bright, 0.95)
    ctx.beginPath()
    ctx.arc(tip[0], tip[1], 0.052 * W, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2)
    ctx.stroke()
  }

  // L'écran et sa grille de pixels.
  ctx.fillStyle = '#02070a'
  ctx.strokeStyle = rgba(dot, 0.25)
  ctx.lineWidth = 0.006 * W
  ctx.beginPath()
  ctx.roundRect(-0.2 * W, -0.1 * W, 0.4 * W, 0.2 * W, 0.07 * W)
  ctx.fill()
  ctx.stroke()
  const COLS = 30
  const ROWS = 14
  const cell = (0.34 * W) / COLS
  const x0 = -0.17 * W
  const y0 = (-ROWS * cell) / 2
  if (W >= 80) {
    const d = cell * 0.5
    ctx.fillStyle = rgba(dot, 0.07 * a)
    for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) ctx.fillRect(x0 + (i + 0.5) * cell - d / 2, y0 + (j + 0.5) * cell - d / 2, d, d)
  }
  const lit: [number, number][] = []
  const bloc = (c0: number, c1: number, r0: number, r1: number) => {
    for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) lit.push([i, j])
  }
  if (veille) {
    bloc(7, 11, 8, 8)
    bloc(18, 22, 8, 8)
  } else if (eteint) {
    bloc(8, 11, 9, 9)
    bloc(18, 21, 9, 9)
  } else if (mode === 'ecoute') {
    const look = Math.round(Math.sin(t * 0.55) * 1.4)
    const haut = e > 0.55 ? 3 : 4
    if (cligne(t, 3.6) > 0.35) {
      bloc(9 + look, 10 + look, haut, 10)
      bloc(19 + look, 21 + look, haut, 10)
    } else {
      bloc(8 + look, 11 + look, 8, 8)
      bloc(18 + look, 22 + look, 8, 8)
    }
  } else if (mode === 'reflexion') {
    const ox = Math.round(Math.cos(t * 1.6) * 1.5)
    const oy2 = Math.round(Math.sin(t * 1.6) * 0.8) - 1
    bloc(9 + ox, 10 + ox, 6 + oy2, 7 + oy2)
    bloc(19 + ox, 21 + ox, 4 + oy2, 7 + oy2)
  } else if (mode === 'parole') {
    for (const cx of [10, 19]) lit.push([cx - 2, 7], [cx - 1, 6], [cx, 5], [cx + 1, 6], [cx + 2, 7])
    const w = 1 + Math.round(e * 4)
    const d0 = 15 - Math.floor(w / 2)
    bloc(d0, d0 + w - 1, 10, e > 0.5 ? 11 : 10)
  } else if (mode === 'validation') {
    if (cligne(t + 1, 4.4) > 0.35) {
      bloc(9, 10, 4, 10)
      bloc(19, 20, 4, 7)
    } else {
      bloc(8, 11, 8, 8)
      bloc(18, 21, 6, 6)
    }
  } else if (mode === 'alerte') {
    bloc(6, 9, 4, 10)
    bloc(20, 23, 4, 10)
    bloc(14, 15, 2, 8)
    bloc(14, 15, 10, 11)
  }
  ctx.save()
  ctx.shadowColor = rgba(dot, 0.9)
  ctx.shadowBlur = cell * 1.4
  ctx.fillStyle = rgba(clair ? '200,236,255' : bright, (veille || eteint ? 0.75 : 1) * pouls)
  const d = cell * 0.78
  for (const [i, j] of lit) ctx.fillRect(x0 + (i + 0.5) * cell - d / 2, y0 + (j + 0.5) * cell - d / 2, d, d)
  ctx.restore()

  ctx.restore()
  return 0
}

export const FORMES: Record<Exclude<OrbeId, 'nebule'>, Dessin> = {
  anneaux,
  filaments,
  onde,
  cristal,
  pulsar,
  liquide,
  mercure,
  particules,
  galaxie,
  plasma,
  constellation,
  robot
}

/** Nom et description de chaque forme, pour les réglages. */
export const ORBE_NOMS: Record<OrbeId, { nom: string; desc: string }> = {
  nebule: { nom: 'Nébule', desc: 'Le nuage de grains d’origine, porté par un courant fluide.' },
  anneaux: { nom: 'Anneaux', desc: 'Trois orbites de grains inclinées autour d’un cœur lumineux.' },
  filaments: { nom: 'Filaments', desc: 'Une sphère en fil de fer qui ondule quand la voix monte.' },
  onde: { nom: 'Onde', desc: 'La voix dessinée en boucles qui se tordent et se croisent.' },
  cristal: { nom: 'Cristal', desc: 'Deux icosaèdres imbriqués qui tournent en sens contraire.' },
  pulsar: { nom: 'Pulsar', desc: 'Un cœur plein qui émet des ondes, plus vite quand il parle.' },
  liquide: { nom: 'Liquide', desc: 'Une goutte translucide dont la surface ondule avec la voix.' },
  mercure: { nom: 'Mercure', desc: 'Une goutte de métal liquide qui reflète l’horizon.' },
  particules: { nom: 'Particules', desc: 'Des centaines de comètes en orbite, qui s’écartent quand il parle.' },
  galaxie: { nom: 'Galaxie', desc: 'Trois bras de grains en spirale autour d’un noyau.' },
  plasma: { nom: 'Plasma', desc: 'Des filaments de lumière qui ondulent jusqu’à la paroi de verre.' },
  constellation: { nom: 'Constellation', desc: 'Des étoiles reliées, plus nombreuses à se toucher quand la voix monte.' },
  robot: { nom: 'Robot', desc: 'Une petite tête à écran de pixels : l’antenne et les yeux disent l’état.' }
}
