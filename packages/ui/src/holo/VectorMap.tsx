import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ExpressionSpecification, Map as MaplibreMap } from 'maplibre-gl'
import { Panel } from './api.ts'
import { mapTrace } from './map-trace.ts'

/**
 * Le fond de carte vectoriel de CODE (MapLibre + OpenFreeMap, recoloré) et une carte de points
 * réutilisable : molette, pincement et glisser, + / −, recentrer, plein écran. Les étiquettes
 * s'écartent d'elles-mêmes quand les points se serrent.
 */

/** Fond de carte vectoriel OpenFreeMap (gratuit, sans clé, usage commercial permis), recoloré pour CODE. */
export const STYLE = 'https://tiles.openfreemap.org/styles/dark'

/** Couleurs du fond : forêts et parcs en vert, eau en bleu, routes hiérarchisées, noms lisibles. */
const PAINT: Record<string, Record<string, unknown>> = {
  background: { 'background-color': '#061118' },
  water: { 'fill-color': '#0b3a5a' },
  waterway: { 'line-color': '#11507a' },
  landcover_wood: { 'fill-color': '#14472b' },
  landuse_park: { 'fill-color': '#18522f', 'fill-opacity': 0.9 },
  landuse_residential: { 'fill-color': '#0c1a22', 'fill-opacity': 0.8 },
  building: { 'fill-color': '#15262f' },
  'aeroway-area': { 'fill-color': '#132a35' },
  'aeroway-runway': { 'line-color': '#2b4b58' },
  highway_path: { 'line-color': '#1d3540' },
  highway_minor: { 'line-color': '#26434f' },
  highway_major_casing: { 'line-color': '#0a1820' },
  highway_major_inner: { 'line-color': '#37606f' },
  highway_major_subtle: { 'line-color': '#2d5060' },
  highway_motorway_casing: { 'line-color': '#0a1820' },
  highway_motorway_inner: { 'line-color': '#4b8193' },
  highway_motorway_subtle: { 'line-color': '#3c6a7a' }
}

/** Les noms en français quand OpenStreetMap les a, sinon le nom local. */
const FRENCH: ExpressionSpecification = ['coalesce', ['get', 'name:fr'], ['get', 'name:latin'], ['get', 'name']]

export function restyle(map: MaplibreMap): void {
  // Les forêts : le style les couvre d'une texture sombre qui masque toute couleur ; on la retire.
  if (map.getLayer('landcover_wood')) {
    map.setPaintProperty('landcover_wood', 'fill-pattern', undefined)
    map.setPaintProperty('landcover_wood', 'fill-opacity', 0.9)
  }
  // Parcs nationaux et réserves : absents du style, ajoutés en vert, sous les routes.
  if (!map.getLayer('code-parcs'))
    map.addLayer(
      { id: 'code-parcs', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', paint: { 'fill-color': '#164a2c', 'fill-opacity': 0.85, 'fill-outline-color': '#2a7a4a' } },
      map.getLayer('waterway') ? 'waterway' : undefined
    )
  for (const layer of map.getStyle().layers ?? []) {
    for (const [prop, value] of Object.entries(PAINT[layer.id] ?? {})) map.setPaintProperty(layer.id, prop as never, value as never)
    if (layer.type === 'symbol') {
      map.setPaintProperty(layer.id, 'text-color', layer.id.startsWith('water') ? '#7fc4e8' : layer.id.startsWith('highway') ? '#8fb3c2' : '#d6e7ee')
      map.setPaintProperty(layer.id, 'text-halo-color', '#061118')
      if (layer.id.startsWith('place') || layer.id === 'water_name') map.setLayoutProperty(layer.id, 'text-field', FRENCH)
    }
  }
}

/** MapLibre, chargé à la demande ; son worker est un fichier à part dont Vite donne l'adresse. */
export async function loadMaplibre() {
  const t0 = performance.now()
  const slow = setTimeout(() => mapTrace('moteur toujours en chargement après 15 s'), 15_000)
  try {
    const [maplibregl, worker] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl-worker.mjs?url')])
    maplibregl.setWorkerUrl(worker.default)
    mapTrace(`moteur chargé en ${Math.round(performance.now() - t0)} ms`)
    return maplibregl
  } catch (err) {
    mapTrace(`moteur introuvable : ${(err as Error).message}`)
    throw err
  } finally {
    clearTimeout(slow)
  }
}

/**
 * Suit une carte au journal : fond reçu (et en combien de temps), première erreur, contexte WebGL
 * perdu. Si rien n'est arrivé après 20 s, `onStuck` le signale à l'écran.
 */
export function watchMap(map: MaplibreMap, name: string, onStuck: () => void): () => void {
  const t0 = performance.now()
  let loaded = false
  let errored = false
  const stuck = setTimeout(() => {
    if (loaded) return
    mapTrace(`${name} : fond toujours absent après 20 s (WebGL ${map.painter?.context ? 'actif' : 'absent'})`)
    onStuck()
  }, 20_000)
  map.once('load', () => {
    loaded = true
    mapTrace(`${name} : fond affiché en ${Math.round(performance.now() - t0)} ms`)
  })
  map.on('error', (e) => {
    if (errored) return
    errored = true
    mapTrace(`${name} : erreur ${String(e.error?.message ?? e.error ?? 'inconnue').slice(0, 160)}`)
  })
  map.on('webglcontextlost', () => mapTrace(`${name} : contexte WebGL perdu`))
  return () => clearTimeout(stuck)
}


/** Un point de la carte : un lieu, une étape. `halo` le fait battre. */
export type MapPoint = { id: string; lat: number; lng: number; label: string; color: string; halo?: boolean; small?: boolean }

/** Le point suivi : étiquette au-dessus de tout, un point lumineux et la flèche du cap. */
export type MapFocus = { lat: number; lng: number; label: string; color: string; cap: number | null; live: boolean }

type MapProps = {
  points?: MapPoint[]
  trace?: { lat: number; lng: number }[]
  traceColor?: string
  focus?: MapFocus | null
  onPoint?: (id: string) => void
  /** Le point mis en avant (cerclé, la carte vole jusqu'à lui). */
  selected?: string | null
}

function focusElement(f: MapFocus): HTMLElement {
  const el = document.createElement('div')
  el.className = `vmap-focus${f.live ? ' is-live' : ''}`
  el.style.setProperty('--c', f.color)
  el.innerHTML = `${f.live ? '<span class="vmap-focus__ping"></span>' : ''}${f.cap !== null ? `<span class="vmap-focus__cap" style="transform: rotate(${f.cap}deg)"></span>` : ''}<span class="vmap-focus__dot"></span><span class="vmap-focus__tag"></span>`
  el.querySelector('.vmap-focus__tag')!.textContent = f.label
  return el
}

function Canvas({ points = [], trace = [], traceColor = '#46d7ff', focus = null, onPoint, selected = null, full, onFull, label }: MapProps & { full: boolean; onFull: () => void; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MaplibreMap | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [moved, setMoved] = useState(false)
  const pick = useRef(onPoint)
  pick.current = onPoint
  const chosen = useRef(selected)
  chosen.current = selected
  const [ready, setReady] = useState(false)

  const coords = useMemo(() => [...points, ...trace, ...(focus ? [focus] : [])].map((p) => [p.lng, p.lat] as [number, number]), [points, trace, focus])
  const bounds = useMemo(() => {
    if (!coords.length) return null
    const lngs = coords.map((p) => p[0])
    const lats = coords.map((p) => p[1])
    return [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)]
    ] as [[number, number], [number, number]]
  }, [coords])

  const recenter = (animate = true) => {
    const map = mapRef.current
    if (!map || !bounds) return
    const single = bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]
    if (single) map.easeTo({ center: bounds[0], zoom: 15, duration: animate ? 600 : 0 })
    else map.fitBounds(bounds, { padding: 70, duration: animate ? 700 : 0, maxZoom: 16 })
    setMoved(false)
  }

  const signature = JSON.stringify([points, trace, focus])
  useEffect(() => {
    let cancelled = false
    let map: MaplibreMap | null = null
    let raf = 0
    let unwatch = () => {}
    setLoading(true)
    void (async () => {
      try {
        const maplibregl = await loadMaplibre()
        if (cancelled || !box.current) return
        const single = bounds && bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]
        const m = new maplibregl.Map({
          container: box.current,
          style: STYLE,
          ...(bounds && !single ? { bounds, fitBoundsOptions: { padding: 70, maxZoom: 16 } } : { center: bounds ? bounds[0] : [0, 20], zoom: bounds ? 15 : 1.5 }),
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false
        })
        map = m
        mapRef.current = m
        unwatch = watchMap(m, label, () => !cancelled && setFailed(true))
        m.touchZoomRotate.disableRotation()
        m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
        m.on('dragstart', () => setMoved(true))
        m.on('zoomstart', (e) => e.originalEvent && setMoved(true))
        m.on('error', (e) => {
          if (!m.isStyleLoaded() && String(e.error?.message ?? '').match(/style|fetch|Failed/i)) setFailed(true)
        })
        m.on('load', () => {
          setLoading(false)
          setFailed(false)
          restyle(m)
          // La police des étiquettes : celle que le style sert déjà (ses glyphes existent).
          const sym = (m.getStyle().layers ?? []).find((l) => l.type === 'symbol' && (l.layout as Record<string, unknown> | undefined)?.['text-font'])
          const font = ((sym?.layout as Record<string, unknown> | undefined)?.['text-font'] as string[] | undefined) ?? ['Noto Sans Regular']
          if (trace.length > 1) {
            m.addSource('code-trace', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trace.map((t) => [t.lng, t.lat]) } } })
            m.addLayer({ id: 'code-trace-halo', type: 'line', source: 'code-trace', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': traceColor, 'line-width': 12, 'line-opacity': 0.22, 'line-blur': 5 } })
            m.addLayer({ id: 'code-trace-edge', type: 'line', source: 'code-trace', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#04121a', 'line-width': 6 } })
            m.addLayer({ id: 'code-trace', type: 'line', source: 'code-trace', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': traceColor, 'line-width': 3.5 } })
            const start = trace[0]!
            m.addSource('code-trace-start', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [start.lng, start.lat] } } })
            m.addLayer({ id: 'code-trace-start', type: 'circle', source: 'code-trace-start', paint: { 'circle-radius': 4, 'circle-color': '#04121a', 'circle-stroke-color': traceColor, 'circle-stroke-width': 2 } })
          }
          if (points.length) {
            m.addSource('code-points', {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: points.map((p) => ({ type: 'Feature', properties: { id: p.id, label: p.label, color: p.color, halo: !!p.halo, small: !!p.small }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) }
            })
            m.addLayer({ id: 'code-halo', type: 'circle', source: 'code-points', filter: ['==', ['get', 'halo'], true], paint: { 'circle-radius': 10, 'circle-color': ['get', 'color'], 'circle-opacity': 0.35, 'circle-blur': 0.4 } })
            m.addLayer({
              id: 'code-points',
              type: 'circle',
              source: 'code-points',
              paint: {
                'circle-radius': ['case', ['get', 'small'], 5, 7],
                'circle-color': ['get', 'color'],
                'circle-opacity': ['case', ['get', 'small'], 0.45, 0.9],
                'circle-stroke-color': ['case', ['get', 'small'], ['get', 'color'], '#04121a'],
                'circle-stroke-width': 2
              }
            })
            m.addLayer({ id: 'code-selected', type: 'circle', source: 'code-points', filter: ['==', ['get', 'id'], chosen.current ?? ''], paint: { 'circle-radius': 13, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } })
            m.addLayer({
              id: 'code-labels',
              type: 'symbol',
              source: 'code-points',
              layout: { 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 12, 'text-offset': ['case', ['get', 'v'], ['literal', [0, 1.9]], ['literal', [0, 1.25]]], 'text-anchor': 'top', 'text-optional': true, 'text-padding': 4 },
              paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#03090d', 'text-halo-width': 1.6 }
            })
            m.on('click', 'code-points', (e) => {
              const id = e.features?.[0]?.properties?.id
              if (typeof id === 'string') pick.current?.(id)
            })
            m.on('mouseenter', 'code-points', () => (m.getCanvas().style.cursor = pick.current ? 'pointer' : ''))
            m.on('mouseleave', 'code-points', () => (m.getCanvas().style.cursor = ''))
            // Les véhicules qui roulent battent doucement.
            if (points.some((p) => p.halo) && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
              const beat = (t: number) => {
                const k = (t % 1600) / 1600
                if (m.getLayer('code-halo')) {
                  m.setPaintProperty('code-halo', 'circle-radius', 9 + k * 16)
                  m.setPaintProperty('code-halo', 'circle-opacity', 0.45 * (1 - k))
                }
                raf = requestAnimationFrame(beat)
              }
              raf = requestAnimationFrame(beat)
            }
          }
          if (focus) new maplibregl.Marker({ element: focusElement(focus), anchor: 'center' }).setLngLat([focus.lng, focus.lat]).addTo(m)
          setReady(true)
        })
      } catch (err) {
        mapTrace(`${label} : création impossible — ${(err as Error).message}`)
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      unwatch()
      setReady(false)
      cancelAnimationFrame(raf)
      map?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // Le point choisi (dans la liste ou sur la carte) : cerclé, et la carte vole jusqu'à lui.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !map.getLayer('code-selected')) return
    map.setFilter('code-selected', ['==', ['get', 'id'], selected ?? ''])
    const p = selected ? points.find((x) => x.id === selected) : null
    if (p) {
      map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 14.5), duration: 800 })
      setMoved(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, ready])

  return (
    <div className={`route-map vmap${full ? ' route-map--full' : ''}`}>
      <div ref={box} className="route-map__canvas" aria-label={label} />
      {failed ? <p className="route-map__off">Fond de carte indisponible (connexion ?).</p> : loading && <p className="route-map__off route-map__off--wait">Chargement de la carte…</p>}
      <div className="route-map__tools">
        {moved && (
          <button type="button" onClick={() => recenter()} aria-label="Recentrer" title="Recentrer">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="7" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
          </button>
        )}
        <button type="button" onClick={onFull} aria-label={full ? 'Réduire la carte' : 'Carte en plein écran'} title={full ? 'Réduire' : 'Plein écran'}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={full ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
          </svg>
        </button>
      </div>
    </div>
  )
}

/**
 * La carte dans un panneau : vivante seulement au premier plan (chaque carte est un contexte WebGL,
 * plusieurs font planter un téléphone), un simple cadre derrière ; plein écran hors du panneau
 * incliné, Échap le referme. `legend` s'affiche sous la carte et dans la barre du plein écran.
 */
export function VectorMap({ title, idle, legend, ...props }: MapProps & { title: ReactNode; idle: string; legend?: ReactNode }) {
  const { front } = useContext(Panel)
  const [full, setFull] = useState(false)
  useEffect(() => {
    if (!full) return
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false)
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [full])
  const label = typeof title === 'string' ? title : idle
  return (
    <>
      {front ? (
        <Canvas {...props} full={false} onFull={() => setFull(true)} label={label} />
      ) : (
        <div className="route-map route-map--idle vmap" aria-hidden="true">
          <span>{idle}</span>
        </div>
      )}
      {legend && <div className="vmap-legend">{legend}</div>}
      {full &&
        front &&
        createPortal(
          <div className="route-full" role="dialog" aria-modal="true" aria-label={label}>
            <div className="route-full__bar">
              <span className="route-full__title">{title}</span>
              {legend && <div className="vmap-legend vmap-legend--bar">{legend}</div>}
            </div>
            <Canvas {...props} full onFull={() => setFull(false)} label={label} />
          </div>,
          document.body
        )}
    </>
  )
}
