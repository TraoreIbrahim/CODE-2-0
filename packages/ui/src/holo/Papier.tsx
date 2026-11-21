import { useContext, useState, type CSSProperties } from 'react'
import { PAPIER_DOSSIERS, type UiPapier, type UiPapiers } from '@code/protocol'
import { Api, Panel } from './api.ts'

/**
 * Un papier envoyé depuis un appareil : la feuille à gauche (balayée tant qu'elle est lue, tamponnée une fois
 * rangée), la fiche à droite (ce qu'en a relevé l'assistant, où il est rangé, son échéance).
 */

const stagger = (i: number) => ({ '--i': Math.min(i, 30) }) as CSSProperties

/** `lecture` : l'assistant est en train de la lire (le faisceau la balaie). */
function Feuille({ p, lecture = false }: { p: Pick<UiPapier, 'media' | 'apercu' | 'nom' | 'categorie' | 'etat'>; lecture?: boolean }) {
  const { url } = useContext(Api)
  const [rate, setRate] = useState(false)
  const src = p.apercu && !rate ? url(p.apercu) : null
  return (
    <figure className={`pap-feuille${lecture ? ' is-lecture' : ''}`}>
      <span className="pap-feuille__coin pap-feuille__coin--hg" aria-hidden="true" />
      <span className="pap-feuille__coin pap-feuille__coin--bd" aria-hidden="true" />
      {p.media === 'image' && src ? (
        <img src={src} alt={`Photo du papier « ${p.nom} »`} onError={() => setRate(true)} />
      ) : (
        <span className="pap-feuille__pdf" aria-hidden="true">
          <strong>{p.media === 'pdf' ? 'PDF' : 'IMG'}</strong>
          <small>{p.nom}</small>
        </span>
      )}
      {lecture && <span className="pap-feuille__faisceau" aria-hidden="true" />}
      {p.etat === 'range' && p.categorie && (
        <span className="pap-tampon" aria-hidden="true">
          <strong>RANGÉ</strong>
          <small>{PAPIER_DOSSIERS[p.categorie].toUpperCase()}</small>
        </span>
      )}
    </figure>
  )
}

export function PapierView({ data }: { data: UiPapier }) {
  const { url, page } = useContext(Api)
  const panel = useContext(Panel)
  const range = data.etat === 'range'
  return (
    <div className={`perso pap pap-cat--${data.categorie ?? 'autre'}`}>
      <Feuille p={data} lecture={!range} />
      <div className="pap-fiche">
        <span className="agenda-next__kicker">
          PAPIER N° {data.id} · REÇU {data.recu.toUpperCase()} · {data.taille}
        </span>
        <h3 className="perso-fil__subject">{data.titre ?? data.nom}</h3>
        {data.emetteur && <p className="pap-fiche__emetteur">{data.emetteur}</p>}
        {range ? (
          <>
            {data.resume && <p className="pap-fiche__resume">{data.resume}</p>}
            {data.champs.length > 0 && (
              <dl className="pap-champs">
                {data.champs.map((c, i) => (
                  <div key={`${c.label}-${i}`} style={stagger(i)}>
                    <dt>{c.label}</dt>
                    <dd>{c.valeur}</dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        ) : (
          <div className="pap-fiche__lecture" role="status">
            <span>Lecture du papier…</span>
            <i />
            <i />
            <i />
          </div>
        )}
        {(data.rangement || data.echeance) && (
          <ul className="pap-suites">
            {data.rangement && (
              <li style={stagger(0)}>
                <span className="pap-suites__quoi">{data.rangement.ou === 'drive' ? 'DRIVE' : 'SERVEUR'}</span>
                <span className="pap-suites__texte">{data.rangement.chemin}</span>
                {data.rangement.lien && (
                  <a className="holo-action" href={data.rangement.lien} target="_blank" rel="noreferrer">
                    Ouvrir dans Drive
                  </a>
                )}
              </li>
            )}
            {data.echeance && (
              <li style={stagger(1)}>
                <span className="pap-suites__quoi">ÉCHÉANCE</span>
                <span className="pap-suites__texte">
                  {data.echeance.titre} · {data.echeance.quand}
                  {data.echeance.montant ? ` · ${data.echeance.montant}` : ''}
                </span>
                <button type="button" className="holo-action" onClick={() => page(panel.id, panel.turnId, 'echeances_lister', {})}>
                  Échéancier
                </button>
              </li>
            )}
          </ul>
        )}
        {data.apercu && (
          <a className="pap-fiche__original" href={url(data.apercu)} target="_blank" rel="noreferrer">
            Voir l’original ›
          </a>
        )}
      </div>
    </div>
  )
}

export function PapiersView({ data }: { data: UiPapiers }) {
  const { page } = useContext(Api)
  const panel = useContext(Panel)
  return (
    <div className="perso paps">
      <header>
        <span className="agenda-next__kicker">{data.sousTitre}</span>
        <h3 className="perso-fil__subject">{data.titre}</h3>
      </header>
      {data.papiers.length === 0 ? (
        <p className="paps__vide">Aucun papier. Photographiez une facture ou un avis depuis le téléphone : il sera lu, rangé, et son échéance notée.</p>
      ) : (
        <ul className="paps__grille">
          {data.papiers.map((p, i) => (
            <li key={p.id} className={`pap-cat--${p.categorie ?? 'autre'}`} style={stagger(i)}>
              <button type="button" className="paps__carte" onClick={() => page(panel.id, panel.turnId, 'document_lire', { id: p.id })}>
                <Feuille p={{ ...p, etat: p.titre ? 'range' : 'recu' }} />
                <span className="paps__texte">
                  <strong>{p.titre ?? p.nom}</strong>
                  <small>{[p.emetteur, `reçu ${p.recu}`].filter(Boolean).join(' · ')}</small>
                  {p.echeance && <em>ÉCHÉANCE · {p.echeance.toUpperCase()}</em>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
