import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { EcheanceCategorie, UiEcheance, UiEcheancier } from '@code/protocol'
import { echeanceCourt } from '../echeances.ts'
import { Api } from './api.ts'
import { Stat, Tag } from './PersoViews.tsx'

/**
 * Échéancier : une frise des soixante prochains jours (ce qui est en retard dans la baie de gauche),
 * puis les échéances par urgence, avec leur montant ; « Réglée » les coche.
 */

const CATEGORIE: Record<EcheanceCategorie, { code: string; nom: string }> = {
  facture: { code: 'FAC', nom: 'Facture' },
  loyer: { code: 'LOY', nom: 'Loyer' },
  impot: { code: 'IMP', nom: 'Impôt' },
  assurance: { code: 'ASS', nom: 'Assurance' },
  abonnement: { code: 'ABO', nom: 'Abonnement' },
  document: { code: 'DOC', nom: 'Papier à renouveler' },
  autre: { code: '···', nom: 'Échéance' }
}

const MOIS = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.']
/** Part de la frise réservée aux retards. */
const BAIE = 13

const stagger = (i: number) => ({ '--i': Math.min(i, 30) }) as CSSProperties
const jourDe = (iso: string) => new Date(`${iso}T00:00:00Z`)

/** Position horizontale (en %) d'un écart en jours ; au-delà de l'horizon, collé au bord droit. */
const x = (jours: number, horizon: number) => (jours < 0 ? BAIE / 2 : BAIE + (Math.min(jours, horizon) / horizon) * (100 - BAIE - 2))

/** Niveaux des épingles : deux échéances proches ne se recouvrent pas. */
function niveaux(items: UiEcheance[], horizon: number): Map<number, number> {
  const out = new Map<number, number>()
  const derniers: number[] = []
  let retard = 0
  for (const e of [...items].sort((a, b) => a.jours - b.jours)) {
    if (e.jours < 0) {
      out.set(e.id, Math.min(retard++, 3))
      continue
    }
    const pos = x(e.jours, horizon)
    let n = derniers.findIndex((p) => pos - p > 6)
    if (n === -1) n = derniers.length
    derniers[n] = pos
    out.set(e.id, Math.min(n, 3))
  }
  return out
}

function Frise({ data, items, choisie, choisir }: { data: UiEcheancier; items: UiEcheance[]; choisie: number | null; choisir: (id: number) => void }) {
  const { horizon } = data
  const reperes = useMemo(() => {
    const debut = jourDe(data.aujourdhui).getTime()
    const out: { j: number; mois?: string }[] = []
    for (let j = 1; j <= horizon; j++) {
      const d = new Date(debut + j * 86_400_000)
      // Un mois trop près du bord droit n'aurait pas la place d'écrire son nom.
      if (d.getUTCDate() === 1) out.push({ j, ...(j < horizon - 6 ? { mois: MOIS[d.getUTCMonth()]! } : {}) })
      else if (j % 7 === 0) out.push({ j })
    }
    return out
  }, [data.aujourdhui, horizon])
  const niv = useMemo(() => niveaux(items, horizon), [items, horizon])
  const retards = items.filter((e) => e.jours < 0).length
  const auDela = items.filter((e) => e.jours > horizon).length
  return (
    <div className="ech-frise" role="img" aria-label={`Frise des ${horizon} prochains jours`}>
      <div className={`ech-frise__baie${retards ? ' is-active' : ''}`} style={{ width: `${BAIE}%` }}>
        <span>{retards ? `${retards} EN RETARD` : 'À JOUR'}</span>
      </div>
      <div className="ech-frise__axe" />
      {reperes.map((r) => (
        <span key={r.j} className={`ech-frise__tick${r.mois ? ' is-mois' : ''}`} style={{ left: `${x(r.j, horizon)}%` }}>
          {r.mois && <small>{r.mois}</small>}
        </span>
      ))}
      <span className="ech-frise__auj" style={{ left: `${x(0, horizon)}%` }}>
        <small>AUJ.</small>
      </span>
      {items.map((e, i) => (
        <button
          key={e.id}
          type="button"
          className={`ech-pin ech-cat--${e.categorie}${e.jours < 0 ? ' is-retard' : ''}${choisie === e.id || data.focus === e.id ? ' is-focus' : ''}`}
          style={{ left: `${x(e.jours, horizon)}%`, '--niv': niv.get(e.id) ?? 0, ...stagger(i) } as CSSProperties}
          title={`${e.titre} · ${e.quand}${e.montant ? ` · ${e.montant}` : ''}`}
          aria-label={`${e.titre}, ${e.quand}, ${e.dans}`}
          onClick={() => choisir(e.id)}
        >
          <span className="ech-pin__tete" />
        </button>
      ))}
      {auDela > 0 && <span className="ech-frise__plus">+{auDela} →</span>}
    </div>
  )
}

function Ligne({ e, i, choisie, defiler }: { e: UiEcheance; i: number; choisie: boolean; defiler: boolean }) {
  const { ask } = useContext(Api)
  const ref = useRef<HTMLLIElement>(null)
  // Seulement quand on la choisit sur la frise : à l'ouverture, la vue reste en haut.
  useEffect(() => {
    if (choisie && defiler) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [choisie, defiler])
  const d = jourDe(e.date)
  const cat = CATEGORIE[e.categorie]
  const tone = e.jours < 0 ? 'alerte' : e.jours <= 3 ? 'attention' : 'neutre'
  return (
    <li ref={ref} className={`ech-ligne ech-cat--${e.categorie}${choisie ? ' is-focus' : ''}`} style={stagger(i)}>
      <span className="ech-ligne__date" aria-hidden="true">
        <strong>{d.getUTCDate()}</strong>
        <small>{MOIS[d.getUTCMonth()]}</small>
      </span>
      <span className="ech-ligne__cat" title={cat.nom}>
        {cat.code}
      </span>
      <span className="ech-ligne__texte">
        <strong>{e.titre}</strong>
        <small>{[e.quand, e.recurrence, e.note].filter(Boolean).join(' · ')}</small>
      </span>
      <span className="ech-ligne__montant">{e.montant}</span>
      <span className="ech-ligne__tag" title={e.dans}>
        <Tag b={{ label: echeanceCourt(e.jours), tone }} />
      </span>
      <button type="button" className="holo-action ech-ligne__regler" onClick={() => ask(`L’échéance « ${e.titre} » (échéance ${e.id}) est réglée.`)}>
        Réglée
      </button>
    </li>
  )
}

export function EcheancierView({ data }: { data: UiEcheancier }) {
  const [choisie, setChoisie] = useState<number | null>(data.focus ?? null)
  const [defiler, setDefiler] = useState(false)
  const choisir = (id: number) => {
    setChoisie(id)
    setDefiler(true)
  }
  const items = data.groupes.flatMap((g) => g.echeances)
  let rang = 0
  return (
    <div className="perso ech">
      <header className="ech__tete">
        <span className="agenda-next__kicker">{data.sousTitre}</span>
        <h3 className="perso-fil__subject">{data.titre}</h3>
      </header>
      <div className="perso-stats">
        {data.kpis.map((k, i) => (
          <Stat key={k.label} k={k} i={i} />
        ))}
      </div>
      {items.length > 0 ? (
        <>
          <Frise data={data} items={items} choisie={choisie} choisir={choisir} />
          {data.groupes.map((g) => (
            <section key={g.label} className={`ech-groupe ech-groupe--${g.tone ?? 'neutre'}`}>
              <h4 className="code-mono">
                {g.label.toUpperCase()} <span>{g.echeances.length}</span>
              </h4>
              <ul>
                {g.echeances.map((e) => (
                  <Ligne key={e.id} e={e} i={rang++} choisie={choisie === e.id} defiler={defiler} />
                ))}
              </ul>
            </section>
          ))}
        </>
      ) : (
        <p className="ech__vide">Rien à régler. Dites par exemple « note la facture d’électricité de 84 euros pour le 14 ».</p>
      )}
      {data.reglees.length > 0 && (
        <details className="ech-reglees">
          <summary className="code-mono">RÉGLÉES CES 30 DERNIERS JOURS · {data.reglees.length}</summary>
          <ul>
            {data.reglees.map((e) => (
              <li key={e.id}>
                <span>{e.titre}</span>
                {e.montant && <s>{e.montant}</s>}
                <small className="code-mono">{e.regleLe}</small>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
