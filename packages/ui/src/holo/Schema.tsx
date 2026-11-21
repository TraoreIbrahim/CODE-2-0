import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { UiSchema } from '@code/protocol'
import { cadre, dessiner, fichierExcalidraw } from './excalidraw.ts'

/**
 * Un schéma Excalidraw dessiné par CODE : feuille blanche, trait à main levée qui se trace élément par
 * élément. « Agrandir » l'ouvre en plein écran ; « Télécharger » donne le fichier .excalidraw à glisser
 * dans excalidraw.com pour le retoucher.
 */

const POLICE = "'Excalifont', 'Virgil', 'Chalkboard SE', 'Comic Neue', 'Segoe Print', 'Bradley Hand', cursive"

function Dessin({ data, plein = false }: { data: UiSchema; plein?: boolean }) {
  const { traces, textes } = useMemo(() => dessiner(data.elements), [data.elements])
  const vue = useMemo(() => cadre(data.elements, data.camera), [data.elements, data.camera])
  const n = traces.length
  return (
    <svg
      className={`schema-svg${plein ? ' schema-svg--plein' : ''}`}
      viewBox={`${vue.x} ${vue.y} ${vue.width} ${vue.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={data.titre}
    >
      {traces.map((t, i) => (
        <path
          key={i}
          d={t.d}
          stroke={t.stroke}
          strokeWidth={t.strokeWidth}
          fill={t.fill ?? 'none'}
          strokeDasharray={t.dash}
          opacity={t.opacity}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={t.dash ? undefined : 1}
          className={t.dash ? 'schema-fondu' : t.fill && t.stroke === 'none' ? 'schema-fondu' : 'schema-trait'}
          style={{ '--i': Math.min(i, 120), '--n': n } as CSSProperties}
        />
      ))}
      {textes.map((t, i) => (
        <g key={`t${i}`} className="schema-fondu" style={{ '--i': Math.min(Math.round((i / Math.max(1, textes.length)) * n), 120) } as CSSProperties} opacity={t.opacity}>
          {t.fond && (
            <rect
              x={t.x - (Math.max(...t.lignes.map((l) => l.length)) * t.taille * 0.55) / 2 - 4}
              y={t.y - t.taille * 0.7}
              width={Math.max(...t.lignes.map((l) => l.length)) * t.taille * 0.55 + 8}
              height={t.lignes.length * t.taille * 1.25 + 2}
              fill="#ffffff"
            />
          )}
          <text x={t.x} y={t.y} fontSize={t.taille} fill={t.couleur} textAnchor={t.ancre} dominantBaseline="central" fontFamily={POLICE}>
            {t.lignes.map((l, j) => (
              <tspan key={j} x={t.x} dy={j === 0 ? 0 : t.taille * 1.25}>
                {l}
              </tspan>
            ))}
          </text>
        </g>
      ))}
    </svg>
  )
}

export function SchemaView({ data }: { data: UiSchema }) {
  const [plein, setPlein] = useState(false)
  useEffect(() => {
    if (!plein) return
    const fermer = (e: KeyboardEvent) => e.key === 'Escape' && setPlein(false)
    window.addEventListener('keydown', fermer)
    return () => window.removeEventListener('keydown', fermer)
  }, [plein])
  const telecharger = () => {
    const url = URL.createObjectURL(new Blob([fichierExcalidraw(data.elements)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${data.titre.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'schema'}.excalidraw`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5_000)
  }
  return (
    <div className="schema">
      <header className="schema-tete">
        <span className="schema-marque" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20c3-1 4-3 6-6l7-7a2.1 2.1 0 0 0-3-3l-7 7c-3 2-5 3-6 6z" />
            <path d="M13 6l5 5" />
          </svg>
        </span>
        <h3 className="schema-titre">{data.titre}</h3>
        <span className="schema-actions">
          <button type="button" className="holo-action" onClick={() => setPlein(true)}>
            Agrandir
          </button>
          <button type="button" className="holo-action holo-action--main" onClick={telecharger} title="Fichier à ouvrir dans excalidraw.com (glisser-déposer)">
            Télécharger .excalidraw
          </button>
        </span>
      </header>
      <button type="button" className="schema-feuille" onClick={() => setPlein(true)} aria-label="Agrandir le schéma">
        <Dessin data={data} />
      </button>
      {plein &&
        createPortal(
        <div className="schema-plein" role="dialog" aria-label={data.titre} onClick={() => setPlein(false)}>
          <div className="schema-plein__feuille" onClick={(e) => e.stopPropagation()}>
            <Dessin data={data} plein />
          </div>
          <button type="button" className="holo-action schema-plein__fermer" onClick={() => setPlein(false)}>
            Fermer ✕
          </button>
        </div>,
          document.body
        )}
    </div>
  )
}
