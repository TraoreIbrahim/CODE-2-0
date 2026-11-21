import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { UiItineraire } from '@code/protocol'
import { Panel } from './api.ts'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { createPortal } from 'react-dom'
import { mapTrace } from './map-trace.ts'
import { STYLE, loadMaplibre, restyle, watchMap } from './VectorMap.tsx'

/**
 * Itinéraire : une mini-carte (le trajet qui s'allume du départ à l'arrivée), la durée en grand, la
 * distance, et le bouton qui ouvre la navigation dans Google Maps — CODE ne guide pas pas à pas.
 */

/** « donnée par le Mac, à 30 m près » : une position fausse se remarque tout de suite. */
function positionDe(d: { appareil?: string; precision?: number }): string {
  const qui = d.appareil === 'mac' || d.appareil === 'mini' ? 'donnée par le Mac' : d.appareil === 'mobile' ? 'donnée par le téléphone' : 'donnée par l’appareil'
  if (d.precision === undefined) return qui
  return `${qui}, à ${d.precision >= 1000 ? `${String(Math.round(d.precision / 100) / 10).replace('.', ',')} km` : `${d.precision} m`} près`
}

const MODE: Record<NonNullable<UiItineraire['trajet']>['mode'], string> = { voiture: 'EN VOITURE', pied: 'À PIED', velo: 'À VÉLO', transports: 'EN TRANSPORTS' }

function duree(min: number): string {
  if (min < 60) return `${min}`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

/** Un repère HTML sur la carte : « VOUS » (point qui pulse) ou l'épingle du site. */
function markerElement(kind: 'me' | 'dest', label: string): HTMLElement {
  const el = document.createElement('div')
  el.className = kind === 'me' ? 'route-map__from' : 'route-map__to'
  el.innerHTML =
    kind === 'me'
      ? '<span class="map-ping"></span><span class="route-map__me"></span><span class="route-map__tag route-map__tag--me"></span>'
      : '<svg class="route-map__pin" width="30" height="40" viewBox="0 0 30 40"><path d="M15 39s13-13.4 13-23.5A13 13 0 0 0 2 15.5C2 25.6 15 39 15 39z"/><circle cx="15" cy="15.5" r="5"/></svg><span class="route-map__tag"></span>'
  el.querySelector('.route-map__tag')!.textContent = label
  return el
}

/**
 * La carte : MapLibre (chargée à la demande), le trajet en lumière, « VOUS » et l'épingle du site.
 * Molette, pincement et glisser natifs ; + / − ; recentrer ; plein écran.
 */
function RouteMap({ data, full, onFull }: { data: UiItineraire; full: boolean; onFull: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MaplibreMap | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [moved, setMoved] = useState(false)
  const dest = data.destination
  const from = data.depart
  const trace = data.trajet?.trace ?? []

  const bounds = useMemo(() => {
    const pts: [number, number][] = [...trace.map(([lat, lng]) => [lng, lat] as [number, number]), [dest.lng, dest.lat], ...(from ? [[from.lng, from.lat] as [number, number]] : [])]
    const lngs = pts.map((p) => p[0])
    const lats = pts.map((p) => p[1])
    return [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)]
    ] as [[number, number], [number, number]]
  }, [data])

  const recenter = useCallback(
    (animate = true) => {
      const map = mapRef.current
      if (!map) return
      const single = bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]
      if (single) map.easeTo({ center: bounds[0], zoom: 15, duration: animate ? 600 : 0 })
      else map.fitBounds(bounds, { padding: { top: 60, bottom: 50, left: 60, right: 60 }, duration: animate ? 700 : 0, maxZoom: 16 })
      setMoved(false)
    },
    [bounds]
  )

  useEffect(() => {
    let cancelled = false
    let map: MaplibreMap | null = null
    let unwatch = () => {}
    setLoading(true)
    void (async () => {
      try {
        const maplibregl = await loadMaplibre()
        if (cancelled || !box.current) return
        const m = new maplibregl.Map({ container: box.current, style: STYLE, bounds, fitBoundsOptions: { padding: 60, maxZoom: 16 }, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false })
        map = m
        mapRef.current = m
        unwatch = watchMap(m, 'itinéraire', () => !cancelled && setFailed(true))
        m.touchZoomRotate.disableRotation()
        m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
        m.on('dragstart', () => setMoved(true))
        m.on('zoomstart', (e) => e.originalEvent && setMoved(true))
        m.on('error', (e) => {
          // Fond de carte injoignable (hors ligne) : on le dit, sans casser le reste de la vue.
          if (!m.isStyleLoaded() && String(e.error?.message ?? '').match(/style|fetch|Failed/i)) setFailed(true)
        })
        m.on('load', () => {
          const map = m
          setLoading(false)
          setFailed(false)
          restyle(map)
          const accent = getComputedStyle(box.current ?? document.body).getPropertyValue('--code-cyan').trim() || '#5ad1ff'
          if (trace.length > 1) {
            map.addSource('trajet', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trace.map(([lat, lng]) => [lng, lat]) } } })
            map.addLayer({ id: 'trajet-halo', type: 'line', source: 'trajet', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': 14, 'line-opacity': 0.25, 'line-blur': 6 } })
            map.addLayer({ id: 'trajet-bord', type: 'line', source: 'trajet', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#04121a', 'line-width': 7 } })
            map.addLayer({ id: 'trajet', type: 'line', source: 'trajet', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': 4.5 } })
          }
          if (from) new maplibregl.Marker({ element: markerElement('me', from.source === 'appareil' ? 'VOUS' : from.nom.toUpperCase()), anchor: 'center' }).setLngLat([from.lng, from.lat]).addTo(map)
          new maplibregl.Marker({ element: markerElement('dest', dest.code ?? dest.nom), anchor: 'bottom' }).setLngLat([dest.lng, dest.lat]).addTo(map)
        })
      } catch (err) {
        mapTrace(`itinéraire : création impossible — ${(err as Error).message}`)
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      unwatch()
      map?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  return (
    <div className={`route-map${full ? ' route-map--full' : ''}`}>
      <div ref={box} className="route-map__canvas" aria-label={`Carte : ${dest.nom}`} />
      {failed ? (
        <p className="route-map__off">Fond de carte indisponible (connexion ?). Le bouton Google Maps fonctionne.</p>
      ) : (
        loading && <p className="route-map__off route-map__off--wait">Chargement de la carte…</p>
      )}
      <div className="route-map__tools">
        {moved && (
          <button type="button" onClick={() => recenter()} aria-label="Recentrer sur le trajet" title="Recentrer">
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

export function ItineraireView({ data }: { data: UiItineraire }) {
  const t = data.trajet
  const dest = data.destination
  // Une seule carte vivante à la fois : celle du panneau de devant (chaque carte est un contexte WebGL,
  // plusieurs à la fois font planter un téléphone). Derrière, un simple cadre.
  const { front } = useContext(Panel)
  // Plein écran : la carte sort du panneau incliné (porté sur la page entière), Échap la referme.
  const [full, setFull] = useState(false)
  useEffect(() => {
    if (!full) return
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false)
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [full])
  return (
    <div className="route">
      <div className="route__head">
        {t ? (
          <div className="route__time">
            <b>{duree(t.minutes)}</b>
            {t.minutes < 60 && <span>min</span>}
          </div>
        ) : (
          <svg className="route__icon" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M12 21s7-6.7 7-12a7 7 0 0 0-14 0c0 5.3 7 12 7 12z" />
            <circle cx="12" cy="9" r="2.5" />
          </svg>
        )}
        <div className="route__what">
          {t && (
            <p className="route__meta code-mono">
              {String(t.km).replace('.', ',')} KM · {MODE[t.mode]} · <em>{data.fournisseur === 'google' ? 'GOOGLE MAPS' : 'SANS CIRCULATION'}</em>
            </p>
          )}
          <p className="route__dest">
            {dest.code && <span className="route__code code-mono">{dest.code}</span>}
            <strong>{dest.nom}</strong>
          </p>
          {dest.adresse && <p className="route__addr">{dest.adresse}</p>}
          {data.depart?.source === 'lieu' && <p className="route__addr">Départ : {data.depart.nom}</p>}
          {data.depart?.source === 'appareil' && <p className="route__addr">Départ : votre position, {positionDe(data.depart)}</p>}
        </div>
        <a className="route__go" href={data.google} target="_blank" rel="noreferrer noopener">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 11 21 3l-8 18-2-8-8-2z" />
          </svg>
          {data.google.includes('/dir/') ? 'Naviguer avec Google Maps' : 'Ouvrir dans Google Maps'}
        </a>
      </div>
      {front ? (
        <RouteMap data={data} full={false} onFull={() => setFull(true)} />
      ) : (
        <div className="route-map route-map--idle" aria-hidden="true">
          <span>{dest.code ?? dest.nom}</span>
        </div>
      )}
      {full &&
        front &&
        createPortal(
          <div className="route-full" role="dialog" aria-modal="true" aria-label={`Carte : ${dest.nom}`}>
            <div className="route-full__bar">
              <span className="route-full__title">
                {t && <b>{duree(t.minutes)}{t.minutes < 60 ? ' min' : ''}</b>}
                {dest.code && <span className="route__code code-mono">{dest.code}</span>}
                <strong>{dest.nom}</strong>
              </span>
              <a className="route__go" href={data.google} target="_blank" rel="noreferrer noopener">
                Naviguer avec Google Maps
              </a>
            </div>
            <RouteMap data={data} full onFull={() => setFull(false)} />
          </div>,
          document.body
        )}
      {data.note && <p className="route__note">{data.note}</p>}
      {t && (
        <p className="route__hint">
          {data.fournisseur === 'google' ? 'Durée calculée par Google Maps. Avec le trafic du moment : bouton Naviguer.' : 'Durée estimée sans circulation : Google Maps donne la durée réelle avec le trafic.'}
        </p>
      )}
    </div>
  )
}
