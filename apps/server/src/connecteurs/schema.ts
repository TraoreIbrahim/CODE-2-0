/**
 * Les schémas Excalidraw. Le serveur MCP d'Excalidraw dessine dans une application web (MCP App) que CODE
 * n'affiche pas : CODE garde donc les éléments envoyés et les dessine lui-même. Ce module résout la reprise
 * d'un schéma (`restoreCheckpoint`), les suppressions (`delete`) et le cadre (`cameraUpdate`).
 */

type El = Record<string, unknown>
export type Camera = { x: number; y: number; width: number; height: number }

const DESSINABLES = new Set(['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line', 'freedraw'])
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** Les éléments à dessiner et le cadre final, à partir de ce que Claude a envoyé et des schémas précédents. */
export function resoudre(brut: unknown[], precedents: (id: string) => El[] | undefined): { elements: El[]; camera?: Camera } {
  let elements: El[] = []
  let camera: Camera | undefined
  for (const e of brut) {
    if (!e || typeof e !== 'object') continue
    const el = e as El
    if (el.type === 'restoreCheckpoint') {
      elements = [...(precedents(String(el.id)) ?? []), ...elements]
    } else if (el.type === 'delete') {
      const ids = new Set(String(el.ids ?? '').split(',').map((s) => s.trim()))
      elements = elements.filter((x) => !ids.has(String(x.id)) && !ids.has(String(x.containerId)))
    } else if (el.type === 'cameraUpdate') {
      camera = { x: num(el.x), y: num(el.y), width: num(el.width, 800), height: num(el.height, 600) }
    } else if (DESSINABLES.has(String(el.type))) {
      elements.push(el)
    }
  }
  return { elements, ...(camera ? { camera } : {}) }
}
