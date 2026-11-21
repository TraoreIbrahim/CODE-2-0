import { useContext, type CSSProperties, type ReactNode } from 'react'
import type { UiCompetence, UiCompetences, UiMemoire } from '@code/protocol'
import { Api, Panel } from './api.ts'
import { MarkdownReader } from './Reader.tsx'

/**
 * Ce que l'assistant sait et sait faire, à la vue de la personne : ses notes sur elle (la mémoire) et les
 * méthodes qu'elle lui a données (les compétences). Rien ici ne s'écrit en cachette : chaque note peut être
 * retirée, chaque méthode relue telle qu'elle a été écrite.
 */

const stagger = (i: number) => ({ '--i': Math.min(i, 20) }) as CSSProperties

function Glyphe({ d }: { d: string }): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const RUBRIQUES: Record<string, string> = {
  profil: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  projets: 'M3 7h6l2 2h10v10H3zM3 7V5h6l2 2',
  contacts: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 12a2.5 2.5 0 1 0 0-5M3 20c.8-3.5 3-5 6-5s5.2 1.5 6 5M15 15c3 0 5 1.5 6 4',
  preferences: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 7a2 2 0 1 0 0 .01M10 17a2 2 0 1 0 0 .01',
  notes: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5'
}
const OUBLIER = 'M6 6l12 12M18 6 6 18'
const METHODE = 'M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h5'

export function MemoireView({ data }: { data: UiMemoire }) {
  const { ask } = useContext(Api)
  return (
    <div className="mem">
      <header className="mem-tete">
        <span className="mem-tete__kicker code-mono">MÉMOIRE · {data.sousTitre.toUpperCase()}</span>
        <h2 className="mem-tete__titre">{data.titre}</h2>
      </header>

      {data.rubriques.length === 0 ? (
        <div className="mem-vierge">
          <strong>Rien de retenu pour l’instant</strong>
          <p>Dites « retiens que… » pour ajouter une note. L’assistant retient aussi, après vos conversations, ce que vous dites de durable sur vous : votre rôle, vos habitudes, les personnes qui comptent.</p>
        </div>
      ) : (
        <div className="mem-rubriques">
          {data.rubriques.map((r, k) => (
            <section key={r.id} className="mem-rubrique" style={stagger(k)} aria-label={r.nom}>
              <h3>
                <i aria-hidden="true">
                  <Glyphe d={RUBRIQUES[r.id] ?? RUBRIQUES.notes!} />
                </i>
                <span>{r.nom}</span>
                <small className="code-mono">{r.notes.length}</small>
              </h3>
              <ul>
                {r.notes.map((n, i) => (
                  <li key={i} className={data.focus && n.texte === data.focus ? 'is-focus' : ''}>
                    <span className="mem-note">
                      <span>{n.texte}</span>
                      {n.date && <small className="code-mono">{n.date.toUpperCase()}</small>}
                    </span>
                    <button type="button" className="mem-oublier" title="Oublier cette note" aria-label={`Oublier : ${n.texte}`} onClick={() => ask(`Oublie cette note : « ${n.texte} »`)}>
                      <Glyphe d={OUBLIER} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {data.lexique.length > 0 && (
        <section className="mem-lexique" aria-label="Mots appris">
          <h3 className="code-mono">MOTS APPRIS · {data.lexique.length}</h3>
          <ul>
            {data.lexique.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p>Les mots que la transcription avait mal entendus et que vous avez corrigés : elle les reconnaît mieux depuis.</p>
        </section>
      )}

      <small className="mem-note-bas">Ces notes sont relues à chaque conversation. Elles restent sur votre serveur, en simples fichiers texte. Oublier une note demande votre accord.</small>
    </div>
  )
}

export function CompetenceView({ data }: { data: UiCompetence }) {
  const { ask, page } = useContext(Api)
  const panel = useContext(Panel)
  return (
    <div className="mem comp">
      <header className="mem-tete">
        <span className="mem-tete__kicker code-mono">COMPÉTENCE · {data.modifie.toUpperCase()}</span>
        <h2 className="mem-tete__titre">{data.nom}</h2>
      </header>

      {data.suivie && (
        <p className="comp-suivie" role="status">
          <i aria-hidden="true" />
          Méthode suivie pour cette demande
        </p>
      )}

      <section className="comp-quand" aria-label="Quand s’en servir">
        <h3 className="code-mono">QUAND</h3>
        <p>{data.description}</p>
      </section>

      <section className="comp-methode" aria-label="La méthode">
        <h3 className="code-mono">LA MÉTHODE</h3>
        <MarkdownReader text={data.corps} />
      </section>

      <div className="mem-outils">
        <button type="button" className="holo-action" onClick={() => page(panel.id, panel.turnId, 'competences_lister', {})}>
          Toutes les compétences
        </button>
        <button type="button" className="holo-action" onClick={() => ask(`Oublie la compétence « ${data.nom} ».`)}>
          Oublier
        </button>
      </div>
      <small className="mem-note-bas">Une méthode dit comment faire, pas ce qui est permis : envoyer, supprimer ou modifier attend toujours votre accord. Pour la corriger : Réglages › Compétences.</small>
    </div>
  )
}

export function CompetencesView({ data }: { data: UiCompetences }) {
  const { page } = useContext(Api)
  const panel = useContext(Panel)
  return (
    <div className="mem comp">
      <header className="mem-tete">
        <span className="mem-tete__kicker code-mono">{data.sousTitre.toUpperCase()}</span>
        <h2 className="mem-tete__titre">{data.titre}</h2>
      </header>
      {data.competences.length === 0 ? (
        <div className="mem-vierge">
          <strong>Aucune méthode pour l’instant</strong>
          <p>Une compétence, c’est votre façon de faire, écrite une fois : « quand je demande un compte rendu, fais-le comme ça ». Dites « apprends à… », ou écrivez-la dans Réglages › Compétences.</p>
        </div>
      ) : (
        <ul className="comp-liste">
          {data.competences.map((c, i) => (
            <li key={c.id} style={stagger(i)}>
              <button type="button" className="comp-carte" onClick={() => page(panel.id, panel.turnId, 'competence_lire', { nom: c.nom, consulter: true })}>
                <i aria-hidden="true">
                  <Glyphe d={METHODE} />
                </i>
                <span className="comp-carte__texte">
                  <strong>{c.nom}</strong>
                  <span>{c.description}</span>
                </span>
                {c.etapes > 0 && (
                  <em className="code-mono">
                    {c.etapes} ÉTAPE{c.etapes > 1 ? 'S' : ''}
                  </em>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <small className="mem-note-bas">L’assistant ne lit une méthode que lorsqu’une demande y correspond. Pour en écrire, en modifier ou en importer : Réglages › Compétences.</small>
    </div>
  )
}
