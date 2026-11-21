import rough from 'roughjs'

/**
 * Les schémas Excalidraw dessinés par CODE : les éléments (rectangle, ellipse, losange, texte, flèche) passent
 * par Rough.js, qui donne le même trait « à main levée » qu'Excalidraw, et deviennent des chemins SVG. Le
 * fichier .excalidraw complet est aussi produit ici, pour l'ouvrir dans l'éditeur.
 */

type El = Record<string, unknown>
export type Cadre = { x: number; y: number; width: number; height: number }
export type Trace = { d: string; stroke: string; strokeWidth: number; fill?: string; dash?: string; opacity: number }
export type Texte = { x: number; y: number; lignes: string[]; taille: number; couleur: string; ancre: 'start' | 'middle'; opacity: number; fond?: boolean }
export type Dessin = { traces: Trace[]; textes: Texte[] }

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v : d)
const lignesDe = (t: unknown) => String(t ?? '').split('\n')
/** Largeur estimée d'un texte manuscrit : environ 0,55 × la taille par caractère. */
const largeur = (t: string, taille: number) => Math.max(...lignesDe(t).map((l) => l.length)) * taille * 0.55
const HAUTEUR_LIGNE = 1.25

/** Une graine stable par élément : le trait ne change pas d'un rendu à l'autre. */
function graine(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return (h >>> 0) % 2 ** 31 || 1
}

const generateur = rough.generator()

function tirets(style: unknown, w: number): string | undefined {
  return style === 'dashed' ? `${8 + w} ${6 + w}` : style === 'dotted' ? `${1.5} ${5 + w}` : undefined
}

/** Rectangle aux coins arrondis, comme Excalidraw (`roundness: { type: 3 }`). */
function rectangleArrondi(x: number, y: number, w: number, h: number): string {
  const r = Math.min(w, h) * 0.25 > 32 ? 32 : Math.min(w, h) * 0.25
  return `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y}`
}

/** Pointe de flèche : deux traits (« arrow »), un triangle plein, une barre ou un point. */
function pointe(type: unknown, de: [number, number], vers: [number, number], taille: number): { d: string; plein: boolean } | null {
  if (!type) return null
  const a = Math.atan2(vers[1] - de[1], vers[0] - de[0])
  const [x, y] = vers
  const p = (ang: number, l = taille) => [x - l * Math.cos(a + ang), y - l * Math.sin(a + ang)] as const
  if (type === 'bar') {
    const [x1, y1] = p(Math.PI / 2, taille / 2)
    const [x2, y2] = p(-Math.PI / 2, taille / 2)
    return { d: `M${x1} ${y1} L${x2} ${y2}`, plein: false }
  }
  if (type === 'dot' || type === 'circle') return { d: `M${x - 4} ${y} a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0`, plein: true }
  const [x1, y1] = p(0.45)
  const [x2, y2] = p(-0.45)
  return type === 'triangle' ? { d: `M${x} ${y} L${x1} ${y1} L${x2} ${y2} Z`, plein: true } : { d: `M${x1} ${y1} L${x} ${y} L${x2} ${y2}`, plein: false }
}

/** Les chemins et textes d'un schéma, dans l'ordre (le premier est au fond). */
export function dessiner(elements: El[]): Dessin {
  const traces: Trace[] = []
  const textes: Texte[] = []
  for (const el of elements) {
    const id = str(el.id, `${traces.length}`)
    const x = num(el.x)
    const y = num(el.y)
    const w = num(el.width)
    const h = num(el.height)
    const stroke = str(el.strokeColor, '#1e1e1e')
    const sw = num(el.strokeWidth, 2)
    const fond = str(el.backgroundColor, 'transparent')
    const opacity = num(el.opacity, 100) / 100
    const options = {
      seed: graine(id),
      roughness: num(el.roughness, 1),
      stroke: stroke === 'transparent' ? 'none' : stroke,
      strokeWidth: sw,
      ...(fond !== 'transparent' ? { fill: fond, fillStyle: str(el.fillStyle, 'solid'), fillWeight: sw / 2, hachureGap: 4 * sw } : {}),
      ...(tirets(el.strokeStyle, sw) ? { strokeLineDash: tirets(el.strokeStyle, sw)!.split(' ').map(Number) } : {})
    }
    const pousser = (d: ReturnType<typeof generateur.rectangle>) => {
      for (const p of generateur.toPaths(d)) traces.push({ d: p.d, stroke: p.stroke, strokeWidth: p.strokeWidth, ...(p.fill && p.fill !== 'none' ? { fill: p.fill } : {}), ...(tirets(el.strokeStyle, sw) && p.fill === 'none' ? { dash: tirets(el.strokeStyle, sw) } : {}), opacity })
    }
    const label = el.label as { text?: string; fontSize?: number; strokeColor?: string } | undefined
    const etiquette = (cx: number, cy: number, fondBlanc: boolean) => {
      if (!label?.text) return
      const taille = num(label.fontSize, 20)
      const lignes = lignesDe(label.text)
      textes.push({ x: cx, y: cy - ((lignes.length - 1) * taille * HAUTEUR_LIGNE) / 2, lignes, taille, couleur: str(label.strokeColor, '#1e1e1e'), ancre: 'middle', opacity, ...(fondBlanc ? { fond: true } : {}) })
    }
    switch (el.type) {
      case 'rectangle':
        pousser(el.roundness ? generateur.path(rectangleArrondi(x, y, w, h), options) : generateur.rectangle(x, y, w, h, options))
        etiquette(x + w / 2, y + h / 2, false)
        break
      case 'ellipse':
        pousser(generateur.ellipse(x + w / 2, y + h / 2, w, h, options))
        etiquette(x + w / 2, y + h / 2, false)
        break
      case 'diamond':
        pousser(generateur.polygon([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]], options))
        etiquette(x + w / 2, y + h / 2, false)
        break
      case 'arrow':
      case 'line': {
        const pts = (Array.isArray(el.points) && el.points.length >= 2 ? (el.points as number[][]) : [[0, 0], [w, h]]).map(([px = 0, py = 0]) => [x + px, y + py] as [number, number])
        const { fill: _f, fillStyle: _s, ...trait } = options as Record<string, unknown>
        pousser(pts.length > 2 && el.roundness !== null ? generateur.curve(pts, trait) : generateur.linearPath(pts, trait))
        const taille = Math.max(12, sw * 7)
        const fin = el.type === 'arrow' ? (el.endArrowhead === undefined ? 'arrow' : el.endArrowhead) : el.endArrowhead
        for (const [type, de, vers] of [
          [el.startArrowhead, pts[1]!, pts[0]!],
          [fin, pts[pts.length - 2]!, pts[pts.length - 1]!]
        ] as const) {
          const p = pointe(type, de, vers, taille)
          if (p) traces.push({ d: p.d, stroke, strokeWidth: sw, ...(p.plein ? { fill: stroke } : {}), opacity })
        }
        const milieu = pts.length % 2 ? pts[(pts.length - 1) / 2]! : [(pts[pts.length / 2 - 1]![0] + pts[pts.length / 2]![0]) / 2, (pts[pts.length / 2 - 1]![1] + pts[pts.length / 2]![1]) / 2]
        etiquette(milieu[0]!, milieu[1]!, true)
        break
      }
      case 'text': {
        const taille = num(el.fontSize, 20)
        const ancre = el.textAlign === 'center' ? 'middle' : 'start'
        textes.push({ x: ancre === 'middle' ? x + w / 2 : x, y: y + taille / 2, lignes: lignesDe(el.text), taille, couleur: stroke, ancre, opacity })
        break
      }
    }
  }
  return { traces, textes }
}

/** Le cadre à montrer : le dernier `cameraUpdate` élargi à tout ce qui est dessiné (sans les fonds géants). */
export function cadre(elements: El[], camera?: Cadre): Cadre {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  const ref = camera ? Math.max(camera.width, camera.height) : Infinity
  for (const el of elements) {
    const x = num(el.x)
    const y = num(el.y)
    let w = num(el.width)
    let h = num(el.height)
    if (el.type === 'text') {
      const t = String(el.text ?? '')
      w = Math.max(w, largeur(t, num(el.fontSize, 20)))
      h = Math.max(h, lignesDe(t).length * num(el.fontSize, 20) * HAUTEUR_LIGNE)
    }
    if (Math.max(Math.abs(w), Math.abs(h)) > ref * 3) continue
    x1 = Math.min(x1, x, x + w)
    y1 = Math.min(y1, y, y + h)
    x2 = Math.max(x2, x, x + w)
    y2 = Math.max(y2, y, y + h)
  }
  if (!Number.isFinite(x1)) return camera ?? { x: 0, y: 0, width: 800, height: 600 }
  const marge = 24
  const contenu = { x: x1 - marge, y: y1 - marge, width: x2 - x1 + 2 * marge, height: y2 - y1 + 2 * marge }
  if (!camera) return contenu
  const x = Math.min(camera.x, contenu.x)
  const y = Math.min(camera.y, contenu.y)
  return { x, y, width: Math.max(camera.x + camera.width, contenu.x + contenu.width) - x, height: Math.max(camera.y + camera.height, contenu.y + contenu.height) - y }
}

// ── Fichier .excalidraw ─────────────────────────────────────────────────

const aleatoire = () => Math.floor(Math.random() * 2 ** 31) || 1

function commun(el: El): El {
  return {
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: aleatoire(),
    version: 1,
    versionNonce: aleatoire(),
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    ...el
  }
}

function texte(id: string, t: string, taille: number, x: number, y: number, extra: El = {}): El {
  return commun({
    type: 'text',
    id,
    x,
    y,
    width: largeur(t, taille),
    height: lignesDe(t).length * taille * HAUTEUR_LIGNE,
    text: t,
    originalText: t,
    fontSize: taille,
    fontFamily: 5,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    lineHeight: HAUTEUR_LIGNE,
    autoResize: true,
    ...extra
  })
}

/**
 * Le fichier .excalidraw : chaque élément reçoit les champs que l'éditeur attend, une étiquette (`label`)
 * devient un texte lié à sa forme, une liaison de flèche reçoit son écart.
 */
export function fichierExcalidraw(elements: El[]): string {
  const out: El[] = []
  for (const brut of elements) {
    const { label, ...el } = brut as El & { label?: { text?: string; fontSize?: number; strokeColor?: string } }
    if (el.type === 'text') {
      out.push(texte(String(el.id), String(el.text ?? ''), num(el.fontSize, 20), num(el.x), num(el.y), el))
      continue
    }
    const forme = commun(el)
    if (el.type === 'arrow' || el.type === 'line') {
      forme.points = Array.isArray(el.points) ? el.points : [[0, 0], [num(el.width), num(el.height)]]
      forme.lastCommittedPoint = null
      forme.startArrowhead = el.startArrowhead ?? null
      forme.endArrowhead = el.endArrowhead ?? (el.type === 'arrow' ? 'arrow' : null)
      for (const k of ['startBinding', 'endBinding'] as const) {
        const b = el[k] as El | undefined
        forme[k] = b ? { elementId: b.elementId, focus: 0, gap: 4, ...(b.fixedPoint ? { fixedPoint: b.fixedPoint } : {}) } : null
      }
    }
    out.push(forme)
    if (label?.text) {
      const taille = num(label.fontSize, 20)
      const id = `${String(el.id)}-texte`
      const t = String(label.text)
      const w = largeur(t, taille)
      const h = lignesDe(t).length * taille * HAUTEUR_LIGNE
      const pts = Array.isArray(el.points) ? (el.points as number[][]) : null
      // Au milieu de la forme, ou au milieu de la flèche.
      const cx = pts ? num(el.x) + (num(pts[0]?.[0]) + num(pts[pts.length - 1]?.[0])) / 2 : num(el.x) + num(el.width) / 2
      const cy = pts ? num(el.y) + (num(pts[0]?.[1]) + num(pts[pts.length - 1]?.[1])) / 2 : num(el.y) + num(el.height) / 2
      out.push(texte(id, t, taille, cx - w / 2, cy - h / 2, { containerId: el.id, textAlign: 'center', verticalAlign: 'middle', strokeColor: label.strokeColor ?? '#1e1e1e' }))
      forme.boundElements = [{ type: 'text', id }]
    }
  }
  // Les flèches liées sont déclarées aussi du côté des formes.
  const parId = new Map(out.map((e) => [String(e.id), e]))
  for (const e of out) {
    for (const k of ['startBinding', 'endBinding']) {
      const cible = parId.get(String((e[k] as El | null)?.elementId ?? ''))
      if (cible) cible.boundElements = [...((cible.boundElements as El[]) ?? []), { type: 'arrow', id: e.id }]
    }
  }
  return JSON.stringify({ type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements: out, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {} }, null, 2)
}
