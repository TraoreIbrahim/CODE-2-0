import { Fragment, useContext, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import type { EtatReunion, UiReunion, UiReunionLigne, UiReunions } from '@code/protocol'
import { Api, Panel } from './api.ts'

/**
 * Une réunion : son rapport (l'essentiel, les décisions, qui fait quoi, ce qui reste ouvert) et sa
 * transcription, passage par passage. Le rapport se lit d'abord ; le texte sert à vérifier et à chercher.
 * La frise situe les passages dans la durée de la réunion ; quand on cherche un sujet, elle montre d'un coup
 * d'œil à quels moments il a été abordé.
 */

const stagger = (i: number) => ({ '--i': Math.min(i, 20) }) as CSSProperties

const ETATS: Record<EtatReunion, string> = { enregistrement: 'Enregistrement en cours', transcription: 'Transcription en cours', prete: 'Transcrite', erreur: 'Échec' }

const sansAccent = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const nombre = (n: number) => n.toLocaleString('fr-FR')
const pluriel = (n: number, mot: string) => `${nombre(n)} ${mot}${n > 1 ? 's' : ''}`

/** Le texte, les mots cherchés surlignés (comparés sans accents, affichés tels quels). */
function Surligne({ texte, recherche }: { texte: string; recherche?: string }): ReactNode {
  const mots = recherche ? [...new Set(sansAccent(recherche).split(/[^a-z0-9]+/).filter((m) => m.length >= 3))] : []
  if (!mots.length) return texte
  // La version sans accents garde la longueur du texte : les positions se correspondent.
  const plat = sansAccent(texte)
  if (plat.length !== texte.length) return texte
  const bornes: [number, number][] = []
  for (const m of mots) for (let i = plat.indexOf(m); i >= 0; i = plat.indexOf(m, i + m.length)) bornes.push([i, i + m.length])
  bornes.sort((a, b) => a[0] - b[0])
  const out: ReactNode[] = []
  let pos = 0
  for (const [a, b] of bornes) {
    if (a < pos) continue
    out.push(<Fragment key={`t${a}`}>{texte.slice(pos, a)}</Fragment>, <mark key={`m${a}`}>{texte.slice(a, b)}</mark>)
    pos = b
  }
  out.push(<Fragment key="fin">{texte.slice(pos)}</Fragment>)
  return out
}

/** Un long passage en paragraphes d'environ trois phrases : deux minutes de parole d'un bloc ne se lisent pas. */
export function paragraphes(texte: string, cible = 320): string[] {
  const phrases = texte.match(/[^.!?…]+[.!?…]+["»”]?\s*|[^.!?…]+$/g) ?? [texte]
  const out: string[] = []
  let courant = ''
  for (const p of phrases) {
    if (courant && courant.length + p.length > cible) {
      out.push(courant.trim())
      courant = ''
    }
    courant += p
  }
  if (courant.trim()) out.push(courant.trim())
  return out
}

/** Les actions regroupées par personne, dans l'ordre où elles apparaissent ; sans nom en dernier. */
export function parPersonne<T extends { qui?: string }>(actions: T[]): { qui: string; actions: T[] }[] {
  const groupes = new Map<string, T[]>()
  for (const a of actions) {
    const qui = a.qui?.trim() ?? ''
    groupes.set(qui, [...(groupes.get(qui) ?? []), a])
  }
  return [...groupes].sort(([a], [b]) => Number(!a) - Number(!b)).map(([qui, actions]) => ({ qui, actions }))
}

const initiales = (nom: string) =>
  nom
    .split(/[\s-]+/)
    .map((m) => m[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

function Icone({ d, taille = 16 }: { d: string; taille?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const I = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  question: 'M9.2 9a3 3 0 1 1 4.6 2.5c-1 .7-1.8 1.3-1.8 2.7M12 17.6v.4',
  loupe: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.6-3.6',
  doc: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5',
  mail: 'M3 6h18v12H3zM3 7l9 7 9-7',
  refaire: 'M4 12a8 8 0 0 1 13.7-5.7L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.7L4 16M4 20v-4h4',
  cloche: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  micro: 'M9 4h6v9a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0M12 18v3',
  importer: 'M12 15V4M8 8l4-4 4 4M5 14v5h14v-5'
}

function Avancement({ r }: { r: Pick<UiReunionLigne, 'etat' | 'progression' | 'erreur' | 'enPause'> }) {
  if (r.etat === 'erreur') return <p className="reu-etat reu-etat--erreur">{r.erreur ?? 'La transcription a échoué.'}</p>
  if (r.etat !== 'transcription' && r.etat !== 'enregistrement') return r.erreur ? <p className="reu-etat reu-etat--note">{r.erreur}</p> : null
  const p = r.progression
  const part = p && p.recus ? p.transcrits / p.recus : 0
  return (
    <div className={`reu-etat${r.etat === 'enregistrement' ? ' reu-etat--rec' : ''}`} role="status">
      <span className="code-mono">
        {r.etat === 'enregistrement' && r.enPause ? 'ENREGISTREMENT EN PAUSE' : ETATS[r.etat].toUpperCase()}
        {p && p.recus > 0 && ` · ${p.transcrits} / ${p.recus} TRANSCRITS`}
      </span>
      {r.etat === 'transcription' && (
        <span className="reu-jauge" aria-hidden="true">
          <i style={{ width: `${Math.max(4, part * 100)}%` }} />
        </span>
      )}
    </div>
  )
}

type Onglet = 'rapport' | 'texte'

export function ReunionView({ data }: { data: UiReunion }) {
  const { ask, page } = useContext(Api)
  const panel = useContext(Panel)
  const lire = (args: Record<string, unknown>) => page(panel.id, panel.turnId, 'reunion_lire', { reunion: data.id, ...args })
  const prete = data.etat === 'prete'
  const rangee = !!data.resume
  const [onglet, setOnglet] = useState<Onglet>(data.recherche || !prete ? 'texte' : 'rapport')
  // Une recherche montre ses passages ; un rapport qui vient d'arriver se montre.
  useEffect(() => setOnglet(data.recherche || !prete ? 'texte' : 'rapport'), [data.id, data.recherche, prete, rangee])
  const [cherche, setCherche] = useState(data.recherche ?? '')
  useEffect(() => setCherche(data.recherche ?? ''), [data.recherche])
  const chercher = (e: FormEvent) => {
    e.preventDefault()
    lire(cherche.trim() ? { chercher: cherche.trim() } : {})
  }
  const groupes = parPersonne(data.actions)
  const rien = rangee && !data.decisions.length && !data.actions.length && !data.points.length

  return (
    <div className="reu">
      <header className="reu-tete">
        <span className="reu-tete__kicker code-mono">
          RÉUNION · {data.quand.toUpperCase()} · {data.source === 'fichier' ? 'IMPORTÉE' : 'ENREGISTRÉE'}
        </span>
        <h2 className="reu-tete__titre">{data.titre}</h2>
        {data.participants.length > 0 && (
          <ul className="reu-presents" aria-label="Participants">
            {data.participants.map((p) => (
              <li key={p}>
                <i aria-hidden="true">{initiales(p)}</i>
                {p}
              </li>
            ))}
          </ul>
        )}
      </header>

      {/* Les chiffres de la réunion : ce qu'elle a duré, ce qu'elle a produit. */}
      <dl className="reu-chiffres">
        <div>
          <dt>Durée</dt>
          <dd>{data.duree}</dd>
        </div>
        <div>
          <dt>Mots</dt>
          <dd>{nombre(data.mots)}</dd>
        </div>
        <div className={data.decisions.length ? 'is-plein' : ''}>
          <dt>Décisions</dt>
          <dd>{rangee ? data.decisions.length : '—'}</dd>
        </div>
        <div className={data.actions.length ? 'is-plein is-ambre' : ''}>
          <dt>À faire</dt>
          <dd>{rangee ? data.actions.length : '—'}</dd>
        </div>
      </dl>

      <Avancement r={data} />

      <div className="reu-barre">
        <div className="reu-onglets" role="tablist" aria-label="Ce qu’on regarde">
          <button type="button" role="tab" aria-selected={onglet === 'rapport'} className={onglet === 'rapport' ? 'is-on' : ''} onClick={() => setOnglet('rapport')}>
            Rapport
          </button>
          <button type="button" role="tab" aria-selected={onglet === 'texte'} className={onglet === 'texte' ? 'is-on' : ''} onClick={() => setOnglet('texte')}>
            Transcription
          </button>
        </div>
        {prete && data.mots > 0 && (
          <form className="reu-recherche" role="search" onSubmit={chercher}>
            <Icone d={I.loupe} />
            <input type="search" value={cherche} onChange={(e) => setCherche(e.target.value)} placeholder="Chercher un sujet…" aria-label="Chercher dans ce qui s’est dit" enterKeyHint="search" />
          </form>
        )}
      </div>

      {onglet === 'rapport' ? (
        <div className="reu-rapport" role="tabpanel">
          {!rangee ? (
            <div className="reu-vierge">
              <strong>{prete ? 'Pas encore de rapport' : 'Le rapport viendra après la transcription'}</strong>
              <p>{prete ? 'Le rapport dégage l’essentiel de la réunion : ce qui a été décidé, qui fait quoi et pour quand, ce qui reste à trancher.' : 'Dès que le texte est prêt, demandez le rapport : il dégagera les décisions, les actions et les points ouverts.'}</p>
              {prete && (
                <div className="reu-outils">
                  <button type="button" className="holo-action holo-action--main" onClick={() => ask(`Fais le rapport de la réunion « ${data.titre} ».`)}>
                    Faire le rapport
                  </button>
                  <button type="button" className="holo-action" onClick={() => ask(`Quelles sont les actions à mener après la réunion « ${data.titre} » ?`)}>
                    Lister ce qu’il y a à faire
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <section className="reu-essentiel" aria-label="L’essentiel">
                <h3 className="code-mono">L’ESSENTIEL</h3>
                <p>{data.resume}</p>
              </section>

              {rien && <p className="reu-vide">Ni décision, ni action, ni point ouvert relevés dans cette réunion.</p>}

              {(data.decisions.length > 0 || data.points.length > 0) && (
                <div className="reu-deux">
                  {data.decisions.length > 0 && (
                    <section className="reu-bloc reu-bloc--decisions" aria-label="Décisions">
                      <h3 className="code-mono">DÉCISIONS · {data.decisions.length}</h3>
                      <ul>
                        {data.decisions.map((d, i) => (
                          <li key={i} style={stagger(i)}>
                            <i aria-hidden="true">
                              <Icone d={I.check} taille={14} />
                            </i>
                            <span>{d}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {data.points.length > 0 && (
                    <section className="reu-bloc reu-bloc--points" aria-label="Points ouverts">
                      <h3 className="code-mono">POINTS OUVERTS · {data.points.length}</h3>
                      <ul>
                        {data.points.map((d, i) => (
                          <li key={i} style={stagger(i)}>
                            <i aria-hidden="true">
                              <Icone d={I.question} taille={14} />
                            </i>
                            <span>{d}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </div>
              )}

              {groupes.length > 0 && (
                <section className="reu-faire" aria-label="À faire">
                  <h3 className="code-mono">À FAIRE · {data.actions.length}</h3>
                  {groupes.map((g, k) => (
                    <div key={g.qui || 'sans'} className="reu-personne" style={stagger(k)}>
                      <span className={`reu-personne__qui${g.qui ? '' : ' is-vide'}`}>
                        <i aria-hidden="true">{g.qui ? initiales(g.qui) : '·'}</i>
                        <b>{g.qui || 'À attribuer'}</b>
                        <small className="code-mono">{pluriel(g.actions.length, 'action')}</small>
                      </span>
                      <ul>
                        {g.actions.map((a, i) => (
                          <li key={i}>
                            <span className="reu-action__texte">
                              <strong>{a.quoi}</strong>
                              {a.quand && <small className="code-mono">{a.quand.toUpperCase()}</small>}
                            </span>
                            <button
                              type="button"
                              className="reu-rappel"
                              title="Créer un rappel pour cette action"
                              aria-label={`Créer un rappel : ${a.quoi}`}
                              onClick={() => ask(`Crée un rappel pour cette action de la réunion « ${data.titre} » : ${a.quoi}${a.qui ? ` (${a.qui})` : ''}${a.quand ? `, ${a.quand}` : ''}.`)}
                            >
                              <Icone d={I.cloche} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              )}

              <div className="reu-outils" aria-label="Outils du rapport">
                <button type="button" className="holo-action" onClick={() => ask(`Crée sur mon Drive le document du compte rendu de la réunion « ${data.titre} ».`)}>
                  <Icone d={I.doc} /> En faire un document
                </button>
                <button type="button" className="holo-action" onClick={() => ask(`Prépare un mail avec le compte rendu de la réunion « ${data.titre} » pour les participants.`)}>
                  <Icone d={I.mail} /> L’envoyer par mail
                </button>
                {data.actions.length > 1 && (
                  <button type="button" className="holo-action" onClick={() => ask(`Crée un rappel pour chacune de mes actions de la réunion « ${data.titre} ».`)}>
                    <Icone d={I.cloche} /> Mes rappels
                  </button>
                )}
                <button type="button" className="holo-action" onClick={() => ask(`Refais le rapport de la réunion « ${data.titre} » en relisant toute la transcription.`)}>
                  <Icone d={I.refaire} /> Refaire
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <section className="reu-texte" role="tabpanel" aria-label="Ce qui s’est dit">
          {data.recherche && (
            <div className="reu-texte__tete">
              <h3 className="code-mono">
                « {data.recherche.toUpperCase()} » · {data.passages.length} PASSAGE{data.passages.length > 1 ? 'S' : ''}
              </h3>
              <button type="button" className="holo-action" onClick={() => lire({})}>
                Tout le texte
              </button>
            </div>
          )}
          {data.passages.length > 0 && data.dureeS > 0 && (
            <div className="reu-frise" aria-hidden="true">
              <span className="code-mono">0:00</span>
              <span className="reu-frise__ligne">
                {data.passages.map((p) => (
                  <i key={p.s} className={p.trouve ? 'is-trouve' : ''} style={{ left: `${Math.min(100, (p.s / data.dureeS) * 100)}%` }} />
                ))}
              </span>
              <span className="code-mono">{data.duree.toUpperCase()}</span>
            </div>
          )}
          {data.passages.length > 0 ? (
            <ol className="reu-passages">
              {data.passages.map((p, i) => (
                <li key={p.s} className={p.trouve ? 'is-trouve' : ''} style={stagger(i)}>
                  <time className="code-mono">{p.a}</time>
                  <div>
                    {paragraphes(p.texte).map((t, k) => (
                      <p key={k}>
                        <Surligne texte={t} recherche={data.recherche} />
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="reu-vide">
              {data.recherche ? `Aucun passage ne contient « ${data.recherche} ».` : prete ? 'Rien d’audible n’a été transcrit.' : data.etat === 'enregistrement' ? 'Le texte arrive par morceaux, toutes les deux minutes environ.' : 'Le texte arrive.'}
            </p>
          )}
          {data.partie && (
            <div className="reu-outils">
              <span className="code-mono">
                PARTIE {data.partie.n} / {data.partie.sur}
              </span>
              {data.partie.n > 1 && (
                <button type="button" className="holo-action" onClick={() => lire({ partie: data.partie!.n - 1 })}>
                  ‹ Précédente
                </button>
              )}
              {data.partie.n < data.partie.sur && (
                <button type="button" className="holo-action" onClick={() => lire({ partie: data.partie!.n + 1 })}>
                  Suivante ›
                </button>
              )}
            </div>
          )}
        </section>
      )}

      <small className="reu-note">
        {data.transcritPar ? `Transcrite par ${data.transcritPar}. ` : ''}
        Transcription automatique : un nom peut être déformé, et elle ne dit pas qui parle. L’audio est effacé une fois transcrit.
      </small>
    </div>
  )
}

/** Le temps écoulé depuis `debut`, pour un enregistrement en cours. */
function Chrono({ debut }: { debut: number }) {
  const [, tic] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tic((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((Date.now() - debut) / 1000))
  return (
    <time>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </time>
  )
}

export function ReunionsView({ data }: { data: UiReunions }) {
  const { page, reunion } = useContext(Api)
  const panel = useContext(Panel)
  const fichier = useRef<HTMLInputElement>(null)
  const enCours = data.reunions.some((r) => r.etat === 'enregistrement')
  return (
    <div className="reu reus">
      <header className="reu-tete reus-tete">
        <div>
          <span className="reu-tete__kicker code-mono">{data.sousTitre.toUpperCase()}</span>
          <h2 className="reu-tete__titre">{data.titre}</h2>
        </div>
        <div className="reu-outils">
          <button type="button" className="holo-action holo-action--main" disabled={enCours} onClick={() => reunion.enregistrer()}>
            <Icone d={I.micro} /> Enregistrer
          </button>
          <button type="button" className="holo-action" onClick={() => fichier.current?.click()}>
            <Icone d={I.importer} /> Importer un audio
          </button>
          <input
            ref={fichier}
            type="file"
            accept="audio/*,.m4a,.mp3,.wav,.ogg,.flac,.aac"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) reunion.importer(f)
            }}
          />
        </div>
      </header>
      {data.reunions.length === 0 ? (
        <div className="reu-vierge">
          <strong>Aucune réunion pour l’instant</strong>
          <p>Enregistrez une réunion avec cet appareil, ou importez un fichier audio : elle sera transcrite, puis résumée à la demande en décisions, actions et points ouverts.</p>
        </div>
      ) : (
        <ul className="reus-liste">
          {data.reunions.map((r, i) => (
            <li key={r.id} style={stagger(i)}>
              <button type="button" className={`reus-carte reus-carte--${r.etat}${r.rangee ? ' is-rangee' : ''}`} onClick={() => page(panel.id, panel.turnId, 'reunion_lire', { reunion: r.id })}>
                <span className="reus-carte__marque" aria-hidden="true" />
                <span className="reus-carte__corps">
                  <span className="reus-carte__tete">
                    <strong>{r.titre}</strong>
                    <em className="code-mono">
                      {r.etat === 'enregistrement' ? (
                        <>
                          {r.enPause ? 'EN PAUSE' : 'REC'} {r.debut && <Chrono debut={r.debut} />}
                        </>
                      ) : r.etat === 'transcription' && r.progression ? (
                        `TRANSCRIPTION ${r.progression.transcrits} / ${r.progression.recus}`
                      ) : r.etat === 'prete' ? (
                        r.rangee ? 'RAPPORT PRÊT' : 'À RÉSUMER'
                      ) : (
                        ETATS[r.etat].toUpperCase()
                      )}
                    </em>
                  </span>
                  <small className="code-mono">
                    {r.quand.toUpperCase()} · {r.duree.toUpperCase()} · {r.source === 'fichier' ? 'IMPORTÉE' : 'ENREGISTRÉE'}
                  </small>
                  {r.resume && <span className="reus-carte__resume">{r.resume}</span>}
                  {r.etat === 'erreur' && r.erreur && <span className="reus-carte__resume reus-carte__resume--erreur">{r.erreur}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
