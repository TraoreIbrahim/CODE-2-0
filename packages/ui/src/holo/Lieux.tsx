import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { UiLieux } from '@code/protocol'
import type { Map as MaplibreMap, Marker } from 'maplibre-gl'
import { Panel } from './api.ts'
import { mapTrace } from './map-trace.ts'
import { STYLE, loadMaplibre, restyle, watchMap } from './VectorMap.tsx'

/**
 * Lieux trouvés par Google Maps : la carte aux repères numérotés, la liste des lieux avec leurs liens, et
 * le résumé de Google dont chaque renvoi (« [0] ») est une pastille qui allume le lieu sur la carte. Le
 * numéro affiché commence à 1 ; la source est citée en pied, comme Google l'exige.
 */

/** Le repère d'un lieu : une goutte numérotée, qui s'allume quand le lieu est choisi. */
function repere(numero: number, onPick: () => void): HTMLElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'lx-pin'
  el.setAttribute('aria-label', `Lieu ${numero}`)
  el.innerHTML = '<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 39s13-13.4 13-23.5A13 13 0 0 0 2 15.5C2 25.6 15 39 15 39z"/></svg><span></span>'
  el.querySelector('span')!.textContent = String(numero)
  el.style.setProperty('--lx-delay', `${0.3 + numero * 0.08}s`)
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    onPick()
  })
  return el
}

function LieuxMap({ data, actif, onPick }: { data: UiLieux; actif: number | null; onPick: (n: number) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MaplibreMap | null>(null)
  const markers = useRef(new Map<number, Marker>())
  const pick = useRef(onPick)
  pick.current = onPick
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  const bounds = useMemo(() => {
    const lngs = data.lieux.map((l) => l.lng)
    const lats = data.lieux.map((l) => l.lat)
    return [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)]
    ] as [[number, number], [number, number]]
  }, [data])

  useEffect(() => {
    let cancelled = false
    let map: MaplibreMap | null = null
    let unwatch = () => {}
    setLoading(true)
    void (async () => {
      try {
        const maplibregl = await loadMaplibre()
        if (cancelled || !box.current) return
        const single = data.lieux.length === 1
        const m = new maplibregl.Map({
          container: box.current,
          style: STYLE,
          ...(single ? { center: bounds[0], zoom: 15 } : { bounds, fitBoundsOptions: { padding: { top: 70, bottom: 40, left: 50, right: 50 }, maxZoom: 16 } }),
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false
        })
        map = m
        mapRef.current = m
        unwatch = watchMap(m, 'lieux', () => !cancelled && setFailed(true))
        m.touchZoomRotate.disableRotation()
        m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
        m.on('load', () => {
          setLoading(false)
          setFailed(false)
          restyle(m)
          for (const l of data.lieux) {
            const mk = new maplibregl.Marker({ element: repere(l.n + 1, () => pick.current(l.n)), anchor: 'bottom' }).setLngLat([l.lng, l.lat]).addTo(m)
            markers.current.set(l.n, mk)
          }
        })
      } catch (err) {
        mapTrace(`lieux : création impossible — ${(err as Error).message}`)
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      unwatch()
      markers.current.clear()
      map?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Le lieu choisi : son repère s'allume, la carte s'y rend.
  useEffect(() => {
    for (const [n, mk] of markers.current) mk.getElement().classList.toggle('lx-pin--on', n === actif)
    const map = mapRef.current
    if (!map) return
    const l = data.lieux.find((x) => x.n === actif)
    if (l) map.easeTo({ center: [l.lng, l.lat], zoom: Math.max(map.getZoom(), 15), duration: 650 })
    else if (data.lieux.length > 1) map.fitBounds(bounds, { padding: { top: 70, bottom: 40, left: 50, right: 50 }, maxZoom: 16, duration: 650 })
  }, [actif, data, bounds])

  return (
    <div className="lx-map route-map">
      <div ref={box} className="route-map__canvas" aria-label="Carte des lieux" />
      {failed ? (
        <p className="route-map__off">Fond de carte indisponible (connexion ?). Les liens Google Maps fonctionnent.</p>
      ) : (
        loading && <p className="route-map__off route-map__off--wait">Chargement de la carte…</p>
      )}
    </div>
  )
}

/** Une ligne du résumé : le gras de Google et ses renvois « [0, 2] » en pastilles cliquables. */
function ligne(texte: string, actif: number | null, connus: Set<number>, onPick: (n: number) => void): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|\[(\d+(?:\s*,\s*\d+)*)\]/g
  let last = 0
  for (const m of texte.matchAll(re)) {
    if (m.index! > last) out.push(texte.slice(last, m.index))
    if (m[1]) out.push(<strong key={`b${m.index}`}>{m[1]}</strong>)
    else
      for (const n of m[2]!.split(',').map((x) => Number(x.trim()))) {
        out.push(
          connus.has(n) ? (
            <button key={`r${m.index}-${n}`} type="button" className={`lx-ref${n === actif ? ' lx-ref--on' : ''}`} onClick={() => onPick(n)} aria-label={`Voir le lieu ${n + 1}`}>
              {n + 1}
            </button>
          ) : null
        )
      }
    last = m.index! + m[0].length
  }
  if (last < texte.length) out.push(texte.slice(last))
  return out
}

const Lien = ({ href, children }: { href?: string; children: ReactNode }) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ) : null

export function LieuxView({ data }: { data: UiLieux }) {
  // Une seule carte vivante à la fois (contexte WebGL) : celle du panneau de devant.
  const { front } = useContext(Panel)
  const [actif, setActif] = useState<number | null>(null)
  const liste = useRef<HTMLOListElement>(null)
  const connus = useMemo(() => new Set(data.lieux.map((l) => l.n)), [data])
  const choisir = (n: number) => setActif((a) => (a === n ? null : n))

  useEffect(() => {
    if (actif === null) return
    liste.current?.querySelector<HTMLElement>(`[data-n="${actif}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [actif])

  const lignes = data.resume.split('\n').map((l) => l.trim()).filter(Boolean)

  return (
    <div className="lx">
      <header className="lx__head">
        <span className="lx__glyph" aria-hidden="true">
          <svg width="26" height="34" viewBox="0 0 30 40">
            <path d="M15 39s13-13.4 13-23.5A13 13 0 0 0 2 15.5C2 25.6 15 39 15 39z" />
            <circle cx="15" cy="15.5" r="5" />
          </svg>
        </span>
        <div className="lx__titre">
          <p className="lx__eyebrow code-mono">
            {data.lieux.length ? `${data.lieux.length} ${data.lieux.length > 1 ? 'LIEUX TROUVÉS' : 'LIEU TROUVÉ'}` : 'AUCUN LIEU SUR LA CARTE'}
          </p>
          <h3>{data.requete || 'Lieux'}</h3>
        </div>
      </header>

      {data.lieux.length > 0 && (
        <div className="lx__corps">
          {front ? (
            <LieuxMap data={data} actif={actif} onPick={choisir} />
          ) : (
            <div className="route-map route-map--idle lx-map" aria-hidden="true">
              <span>{data.lieux.length} lieux</span>
            </div>
          )}
          <ol className="lx__liste" ref={liste}>
            {data.lieux.map((l) => (
              <li key={l.n} data-n={l.n} className={`lx__lieu${l.n === actif ? ' lx__lieu--on' : ''}`} style={{ ['--lx-i' as string]: l.n }} onClick={(e) => !(e.target as HTMLElement).closest('a, button') && choisir(l.n)}>
                <button type="button" className="lx__num code-mono" onClick={() => choisir(l.n)} aria-label={`Montrer ${l.nom} sur la carte`}>
                  {l.n + 1}
                </button>
                <div className="lx__info">
                  <strong>{l.nom}</strong>
                  <span className="lx__liens">
                    <Lien href={l.lien}>Fiche</Lien>
                    <Lien href={l.trajet}>Y aller</Lien>
                    <Lien href={l.avis}>Avis</Lien>
                    <Lien href={l.photos}>Photos</Lien>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {lignes.length > 0 && (
        <div className="lx__resume">
          {lignes.map((t, i) => {
            const puce = /^([-*•]|\d+[.)])\s+/.exec(t)
            const corps = puce ? t.slice(puce[0].length) : t
            return (
              <p key={i} className={puce ? 'lx__puce' : undefined}>
                {ligne(corps, actif, connus, choisir)}
              </p>
            )
          })}
        </div>
      )}

      <footer className="lx__source code-mono">
        SOURCE ·{' '}
        {data.attribution.lien ? (
          <a href={data.attribution.lien} target="_blank" rel="noreferrer noopener">
            {data.attribution.titre}
          </a>
        ) : (
          data.attribution.titre
        )}
      </footer>
    </div>
  )
}
