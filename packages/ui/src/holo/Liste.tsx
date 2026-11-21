import { useContext, useEffect, useState, type CSSProperties } from 'react'
import type { UiListe, UiListeElement, UiListes, UiPartage, UiPersonne } from '@code/protocol'
import { Api, Panel } from './api.ts'

/**
 * Une liste à cocher, lisible de loin : un élément par ligne, en grand, et un rond à toucher. Dans une liste
 * partagée, chaque personne a sa teinte : on voit qui a ajouté quoi, et le trait qui barre ce qui est pris
 * prend la couleur de qui l'a pris. En tête, la réglette : une encoche par élément, allumée quand il est pris.
 */

const stagger = (i: number) => ({ '--i': Math.min(i, 30) }) as CSSProperties
const teinte = (p?: UiPersonne) => (p ? ({ '--qui': `hsl(${p.teinte} 85% 66%)` } as CSSProperties) : undefined)

function Pastille({ p, petite = false }: { p: UiPersonne; petite?: boolean }) {
  return (
    <span className={`lst-qui${petite ? ' lst-qui--petite' : ''}`} style={teinte(p)} title={p.prenom} aria-hidden="true">
      {p.prenom.charAt(0).toUpperCase()}
    </span>
  )
}

function Partage({ partage }: { partage: UiPartage }) {
  return (
    <span className={`lst-partage lst-partage--${partage.mode}`}>
      {partage.personnes.length > 0 && (
        <span className="lst-partage__qui">
          {partage.personnes.slice(0, 5).map((p) => (
            <Pastille key={p.prenom + p.teinte} p={p} petite />
          ))}
        </span>
      )}
      {partage.libelle}
    </span>
  )
}

/** La réglette : une encoche par élément, dans l'ordre affiché ; celles des éléments pris sont allumées. */
function Reglette({ elements, partagee }: { elements: UiListeElement[]; partagee: boolean }) {
  if (!elements.length) return null
  return (
    <span className="lst-reglette" aria-hidden="true">
      {elements.map((e, k) => (
        <i key={e.id} className={e.coche ? 'is-pris' : ''} style={{ '--k': k, ...(partagee ? teinte(e.cochePar) : {}) } as CSSProperties} />
      ))}
    </span>
  )
}

const COCHE = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
)

function Ligne({ liste, e, i, focus, partagee }: { liste: number; e: UiListeElement; i: number; focus: boolean; partagee: boolean }) {
  const { liste: cocher } = useContext(Api)
  return (
    <li className={`lst-el${e.coche ? ' is-pris' : ''}${focus ? ' is-focus' : ''}`} style={{ ...stagger(i), ...(partagee ? teinte(e.coche ? e.cochePar : e.par) : {}) }}>
      <button
        type="button"
        className="lst-el__rond"
        role="checkbox"
        aria-checked={e.coche}
        aria-label={`${e.coche ? 'Remettre' : 'Cocher'} « ${e.texte} »`}
        onClick={() => cocher(liste, e.id, !e.coche)}
      >
        {COCHE}
      </button>
      <span className="lst-el__texte">
        <span className="lst-el__mot">{e.texte}</span>
        {e.quantite && <span className="lst-el__qte">{/^\d+$/.test(e.quantite) ? `×${e.quantite}` : e.quantite}</span>}
      </span>
      {partagee && (e.coche ? e.cochePar : e.par) && (
        <span className="lst-el__par">
          {e.coche ? 'pris par ' : ''}
          {(e.coche ? e.cochePar : e.par)!.prenom}
        </span>
      )}
    </li>
  )
}

export function ListeView({ data }: { data: UiListe }) {
  const partagee = data.partage.mode !== 'prive'
  const aPrendre = data.elements.filter((e) => !e.coche)
  const pris = data.elements.filter((e) => e.coche)
  const focus = new Set(data.focus ?? [])
  // Tout est pris : un instant de satisfaction, puis la liste reste telle quelle.
  const [fini, setFini] = useState(false)
  const complet = data.elements.length > 0 && aPrendre.length === 0
  useEffect(() => {
    if (!complet) return setFini(false)
    setFini(true)
    const t = setTimeout(() => setFini(false), 2400)
    return () => clearTimeout(t)
  }, [complet])
  return (
    <div className={`perso lst${partagee ? ' lst--partagee' : ''}${fini ? ' is-fini' : ''}`}>
      <header className="lst-tete">
        <span className="agenda-next__kicker">
          LISTE{data.auteur ? ` DE ${data.auteur.prenom.toUpperCase()}` : ''} · {aPrendre.length === 0 && data.elements.length ? 'TOUT EST PRIS' : `${aPrendre.length} À PRENDRE`}
        </span>
        <div className="lst-tete__ligne">
          <h3 className="lst-nom">{data.nom}</h3>
          <Partage partage={data.partage} />
        </div>
        <Reglette elements={[...aPrendre, ...pris]} partagee={partagee} />
      </header>
      {data.elements.length === 0 ? (
        <p className="lst-vide">Liste vide. Dites « ajoute du lait à la liste », ou tapez-le.</p>
      ) : (
        <>
          {aPrendre.length > 0 && (
            <ul className="lst-els">
              {aPrendre.map((e, i) => (
                <Ligne key={e.id} liste={data.id} e={e} i={i} focus={focus.has(e.id)} partagee={partagee} />
              ))}
            </ul>
          )}
          {pris.length > 0 && (
            <section className="lst-pris">
              <h4 className="agenda-list__label">PRIS · {pris.length}</h4>
              <ul className="lst-els lst-els--pris">
                {pris.map((e, i) => (
                  <Ligne key={e.id} liste={data.id} e={e} i={i} focus={focus.has(e.id)} partagee={partagee} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

export function ListesView({ data }: { data: UiListes }) {
  const { page } = useContext(Api)
  const panel = useContext(Panel)
  return (
    <div className="perso lsts">
      <header>
        <span className="agenda-next__kicker">{data.sousTitre}</span>
        <h3 className="perso-fil__subject">{data.titre}</h3>
      </header>
      {data.listes.length === 0 ? (
        <p className="lst-vide">Aucune liste. Dites « ajoute du pain à la liste de courses » : elle se crée toute seule.</p>
      ) : (
        <ul className="lsts__grille">
          {data.listes.map((l, i) => (
            <li key={l.id} style={stagger(i)}>
              <button type="button" className={`lsts__carte lsts__carte--${l.partage.mode}`} onClick={() => page(panel.id, panel.turnId, 'listes_voir', { liste: l.id })}>
                <span className="lsts__haut">
                  <strong className="lsts__nom">{l.nom}</strong>
                  <span className="lsts__compte">
                    {l.restants}
                    <small>/{l.total}</small>
                  </span>
                </span>
                <span className="lst-reglette lst-reglette--fine" aria-hidden="true">
                  {Array.from({ length: Math.min(l.total, 24) }, (_, k) => (
                    <i key={k} className={k >= l.restants ? 'is-pris' : ''} />
                  ))}
                </span>
                {l.apercu.length > 0 ? (
                  <span className="lsts__apercu">{l.apercu.join(' · ')}</span>
                ) : (
                  <span className="lsts__apercu lsts__apercu--vide">{l.total ? 'Tout est pris' : 'Vide'}</span>
                )}
                <span className="lsts__bas">
                  <Partage partage={l.partage} />
                  <small>{l.modifie}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
