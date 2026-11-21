import { useContext, useState, type CSSProperties, type ReactNode } from 'react'
import type { UiAgenda, UiAgendaEvent, UiAgendaJour, UiBadge, UiKpi, UiMailFil, UiMailMessage, UiMails } from '@code/protocol'
import { BrandMark } from '../Logo.tsx'
import { Api, Panel } from './api.ts'
import { Pager } from './Pager.tsx'
import { useCountUp } from './useCountUp.ts'

/**
 * Vie personnelle : boîte Gmail, fil de discussion, Google Agenda.
 * Ouvrir un fil depuis la liste charge un nouveau panneau, sans passer par Claude.
 */

const stagger = (i: number) => ({ '--i': Math.min(i, 30) }) as CSSProperties
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export function Tag({ b }: { b: UiBadge }) {
  return <span className={`perso-tag perso-tag--${b.tone ?? 'neutre'}`}>{b.label}</span>
}

/** Monogramme dans un hexagone : l'expéditeur, sans photo. */
export function Sigil({ text, tone = 'info', size = 40 }: { text: ReactNode; tone?: 'info' | 'moi' | 'brouillon'; size?: number }) {
  return (
    <span className={`perso-sigil perso-sigil--${tone}`} style={{ '--s': `${size}px` } as CSSProperties} aria-hidden="true">
      {text}
    </span>
  )
}

export function Stat({ k, i }: { k: UiKpi; i: number }) {
  const numeric = /^\d+$/.test(k.valeur)
  const n = useCountUp(numeric ? Number(k.valeur) : 0)
  return (
    <div className={`perso-stat perso-stat--${k.tone ?? 'neutre'}`} style={stagger(i)}>
      <span className="perso-stat__label">{k.label}</span>
      <span className="perso-stat__value">
        {numeric ? String(n).padStart(k.valeur.length, '0') : k.valeur}
        {k.unite && <small>{k.unite}</small>}
      </span>
      {k.jauge !== undefined && (
        <span className="perso-stat__gauge">
          <span style={{ width: `${k.jauge}%` }} />
        </span>
      )}
      {k.detail && <span className="perso-stat__detail">{k.detail}</span>}
    </div>
  )
}

const ClipIcon = () => (
  <svg className="perso-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6L15.5 6" />
  </svg>
)
const PinIcon = () => (
  <svg className="perso-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
  </svg>
)
const CamIcon = () => (
  <svg className="perso-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="6.5" width="12.5" height="11" rx="2" />
    <path d="m15.5 10.5 5-3v9l-5-3z" />
  </svg>
)

// ── Boîte de réception ───────────────────────────────────────────────────

export function MailsView({ data }: { data: UiMails }) {
  const { page } = useContext(Api)
  const panel = useContext(Panel)
  const nonLus = useCountUp(data.nonLus)
  const total = useCountUp(data.total)
  // Plusieurs boîtes : un filtre par boîte (Gmail, Pro…), chacune avec ses non lus.
  const [only, setOnly] = useState<string | null>(null)
  const lignes = only ? data.lignes.filter((m) => m.boite === only) : data.lignes
  // Un mail de n'importe quelle boîte (Gmail ou IMAP) : mail_lire reconnaît son identifiant.
  const open = (id: string) => page(`${panel.id}~${id}`, panel.turnId, 'mail_lire', { mail: id })
  return (
    <div className="perso perso-mails">
      <div className="perso-mails__head">
        <div className="perso-big">
          <span className="perso-big__value">{String(nonLus).padStart(2, '0')}</span>
          <span className="perso-big__label">{data.boites ? `NON LUS · ${data.boites.length} BOÎTES` : 'NON LUS · BOÎTE DE RÉCEPTION'}</span>
        </div>
        <div className="perso-big perso-big--small">
          <span className="perso-big__value">{total}</span>
          <span className="perso-big__label">{data.boites ? 'RÉCENTS' : data.total > 1 ? 'FILS' : 'FIL'}</span>
        </div>
        {data.compte && <span className="perso-account">{data.compte}</span>}
      </div>
      {data.boites && (
        <div className="perso-boxes" role="group" aria-label="Filtrer par boîte">
          <button type="button" className="perso-boxes__item" aria-pressed={only === null} onClick={() => setOnly(null)}>
            <span className="perso-boxes__name">Toutes</span>
          </button>
          {data.boites.map((b) => (
            <button key={b.nom} type="button" className={`perso-boxes__item${b.gmail ? ' is-gmail' : ''}`} aria-pressed={only === b.nom} onClick={() => setOnly(only === b.nom ? null : b.nom)}>
              <span className="perso-boxes__dot" aria-hidden="true" />
              <span className="perso-boxes__name">{b.nom}</span>
              <span className="perso-boxes__count" title="Non lus dans la boîte de réception">
                {b.nonLus} non lus
              </span>
            </button>
          ))}
        </div>
      )}
      {data.requete && <span className="holo-query">{data.requete}</span>}
      {lignes.length === 0 ? (
        <p className="perso-empty">{only ? `Rien de récent dans « ${only} ».` : 'Rien à signaler : aucun mail ne correspond.'}</p>
      ) : (
        <ol className="perso-inbox" key={only ?? ''}>
          {lignes.map((m, i) => (
            <li key={m.id} style={stagger(i)} className="perso-inbox__item">
              <button type="button" className={`perso-mail${m.nonLu ? ' is-unread' : ''}${m.important ? ' is-important' : ''}`} onClick={() => open(m.id)} aria-label={`Lire le mail de ${m.de} : ${m.objet}`}>
                <span className="perso-mail__rail" aria-hidden="true" />
                <Sigil text={m.initiales} />
                <span className="perso-mail__text">
                  <span className="perso-mail__from">
                    {m.de}
                    {m.messages > 1 && <span className="perso-mail__count">{m.messages}</span>}
                    {m.important && <span className="perso-mail__flag" title="Important" aria-label="Important" />}
                    {m.boite && <span className={`perso-mail__box${m.boite === 'Gmail' ? ' is-gmail' : ''}`}>{m.boite}</span>}
                  </span>
                  <span className="perso-mail__subject">{m.objet}</span>
                  <span className="perso-mail__snippet">{m.extrait}</span>
                </span>
                <span className="perso-mail__meta">
                  <span className="perso-mail__when">{m.quand}</span>
                  {m.pieces > 0 && (
                    <span className="perso-mail__clip">
                      <ClipIcon />
                      {m.pieces}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {data.pager && <Pager pager={data.pager} />}
    </div>
  )
}

// ── Fil de discussion ────────────────────────────────────────────────────

function Message({ m, i, open, onToggle }: { m: UiMailMessage; i: number; open: boolean; onToggle: () => void }) {
  const { ask } = useContext(Api)
  return (
    <li className={`perso-msg${m.moi ? ' is-me' : ''}${open ? ' is-open' : ''}`} style={stagger(i)}>
      <span className="perso-msg__node" aria-hidden="true" />
      <button type="button" className="perso-msg__head" onClick={onToggle} aria-expanded={open}>
        <Sigil text={m.moi ? 'VOUS' : m.initiales} tone={m.moi ? 'moi' : 'info'} size={34} />
        <span className="perso-msg__who">
          <strong>{m.moi ? 'Vous' : m.de}</strong>
          <small>
            {m.deEmail} → {m.a}
            {m.cc ? ` · cc ${m.cc}` : ''}
          </small>
        </span>
        <span className="perso-msg__when">{m.quand}</span>
      </button>
      <div className="perso-msg__body">
        <p className="perso-msg__text">{m.texte || '(message vide)'}</p>
        {m.tronque && <p className="perso-more">Message long : seul le début est affiché.</p>}
        {m.pieces.length > 0 && (
          <ul className="perso-files">
            {m.pieces.map((p) => (
              <li key={p.nom}>
                <button type="button" className="perso-file" title="Demander à l’assistant de la lire" onClick={() => ask(`Lis la pièce jointe « ${p.nom} » (message ${m.id}).`)}>
                  <ClipIcon />
                  <span>{p.nom}</span>
                  <small>{p.taille}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

export function MailFilView({ data }: { data: UiMailFil }) {
  const { ask, nom } = useContext(Api)
  const last = data.messages.length - 1
  // Les deux derniers messages sont ouverts ; les plus anciens se déplient d'un clic.
  const [opened, setOpened] = useState<Set<number>>(() => new Set([last, last - 1]))
  const toggle = (i: number) => setOpened((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))
  const d = data.brouillon
  const pending = d?.enAttente
  return (
    <div className="perso perso-fil">
      <header className="perso-fil__head">
        <h3 className="perso-fil__subject">{data.objet}</h3>
        <div className="perso-fil__tags">
          {data.badges.map((b) => (
            <Tag key={b.label} b={b} />
          ))}
          {data.compte && <span className="perso-account">{data.compte}</span>}
        </div>
      </header>
      {data.messages.length > 0 && (
        <ol className="perso-thread">
          {data.messages.map((m, i) => (
            <Message key={m.id} m={m} i={i} open={opened.has(i)} onToggle={() => toggle(i)} />
          ))}
        </ol>
      )}
      {d ? (
        <section className={`perso-draft${pending ? ' is-pending' : ''}`} aria-label={`Brouillon de ${nom}`}>
          <div className="perso-draft__head">
            <Sigil text={<BrandMark size={22} />} tone="brouillon" size={34} />
            <span className="perso-msg__who">
              <strong>{d.objet}</strong>
              <small>À {d.a}</small>
            </span>
            <Tag b={d.statut} />
          </div>
          <p className="perso-draft__text">
            {d.texte}
            <span className="perso-caret" aria-hidden="true" />
          </p>
          {d.pieces && d.pieces.length > 0 && (
            <ul className="perso-files">
              {d.pieces.map((p) => (
                <li key={p.nom} className="perso-file">
                  <ClipIcon />
                  <span>{p.nom}</span>
                  <small>{p.taille}</small>
                </li>
              ))}
            </ul>
          )}
          {!pending && (
            <div className="perso-actions">
              <span className="perso-hint">Rien ne part sans votre « oui ».</span>
              <button type="button" className="holo-action holo-action--main" onClick={() => ask(`Envoie le brouillon ${d.id}.`)}>
                Envoyer…
              </button>
            </div>
          )}
        </section>
      ) : (
        data.messages.length > 0 && (
          <div className="perso-actions">
            <button type="button" className="holo-action" onClick={() => ask(`Prépare une réponse au mail « ${data.objet} » (fil ${data.id}).`)}>
              Préparer une réponse
            </button>
          </div>
        )
      )}
    </div>
  )
}

// ── Agenda ───────────────────────────────────────────────────────────────

/** Rangées pour les rendez-vous qui se chevauchent. */
function lanes(events: UiAgendaEvent[]): { lane: Map<string, number>; count: number } {
  const ends: number[] = []
  const lane = new Map<string, number>()
  for (const e of [...events].sort((x, y) => x.de - y.de || y.a - x.a)) {
    let i = ends.findIndex((end) => end <= e.de)
    if (i < 0) i = ends.push(0) - 1
    ends[i] = e.a
    lane.set(`${e.id}@${e.de}`, i)
  }
  return { lane, count: Math.max(1, ends.length) }
}

function hours(plage: UiAgenda['plage']): number[] {
  const out: number[] = []
  for (let h = Math.ceil(plage.de / 60); h <= Math.floor(plage.a / 60); h++) out.push(h)
  return out
}

function EventMeta({ e }: { e: UiAgendaEvent }) {
  return (
    <>
      {e.lieu && (
        <span className="agenda-meta">
          <PinIcon />
          {e.lieu}
        </span>
      )}
      {e.visio && (
        <span className="agenda-meta">
          <CamIcon />
          Visio
        </span>
      )}
      {e.participants > 0 && <span className="agenda-meta">{e.participants} participant{e.participants > 1 ? 's' : ''}</span>}
    </>
  )
}

/** Un jour : frise horizontale, créneaux libres, ligne « maintenant ». */
function Frise({ jour, plage, maintenant, duree }: { jour: UiAgendaJour; plage: UiAgenda['plage']; maintenant?: number; duree?: number }) {
  const { ask } = useContext(Api)
  const span = plage.a - plage.de
  const x = (m: number) => `${((Math.min(Math.max(m, plage.de), plage.a) - plage.de) / span) * 100}%`
  const w = (de: number, a: number) => `${((Math.min(a, plage.a) - Math.max(de, plage.de)) / span) * 100}%`
  const timed = jour.evenements.filter((e) => !e.journee)
  const { lane, count } = lanes(timed)
  const now = jour.aujourdhui && maintenant !== undefined && maintenant >= plage.de && maintenant <= plage.a ? maintenant : null
  return (
    <div className="agenda-frise" style={{ '--lanes': count } as CSSProperties}>
      <div className="agenda-frise__scale" aria-hidden="true">
        {hours(plage).map((h) => (
          <span key={h} style={{ left: x(h * 60) }}>
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>
      <div className="agenda-frise__track">
        {hours(plage).map((h) => (
          <span key={h} className="agenda-frise__tick" style={{ left: x(h * 60) }} aria-hidden="true" />
        ))}
        {now !== null && <span className="agenda-frise__past" style={{ width: x(now) }} aria-hidden="true" />}
        {(jour.libres ?? []).map((s, i) => (
          <button
            key={s.de}
            type="button"
            className="agenda-libre"
            style={{ left: x(s.de), width: w(s.de, s.a), ...stagger(i) }}
            onClick={() => ask(`Réserve le créneau du ${jour.label.toLowerCase()} de ${s.debut} à ${s.fin}.`)}
            title={`Libre de ${s.debut} à ${s.fin}${duree ? ' : cliquer pour le réserver' : ''}`}
          >
            <span>LIBRE</span>
            <small>
              {s.debut} → {s.fin}
            </small>
          </button>
        ))}
        {timed.map((e, i) => (
          <div
            key={`${e.id}@${e.de}`}
            className={`agenda-bloc agenda-bloc--${e.etat}`}
            style={{ left: x(e.de), width: w(e.de, e.a), '--lane': lane.get(`${e.id}@${e.de}`) ?? 0, ...stagger(i) } as CSSProperties}
            title={`${e.debut} → ${e.fin} · ${e.titre}${e.lieu ? ` · ${e.lieu}` : ''}`}
          >
            <span className="agenda-bloc__time">{e.debut}</span>
            <span className="agenda-bloc__title">{e.titre}</span>
          </div>
        ))}
        {now !== null && (
          <span className="agenda-now" style={{ left: x(now) }}>
            <span>{hhmm(now)}</span>
          </span>
        )}
      </div>
    </div>
  )
}

/** Une semaine : une colonne par jour, axe des heures vertical. */
function Semaine({ jours, plage, maintenant }: { jours: UiAgendaJour[]; plage: UiAgenda['plage']; maintenant?: number }) {
  const span = plage.a - plage.de
  const y = (m: number) => `${((Math.min(Math.max(m, plage.de), plage.a) - plage.de) / span) * 100}%`
  const h = (de: number, a: number) => `${((Math.min(a, plage.a) - Math.max(de, plage.de)) / span) * 100}%`
  return (
    <div className="agenda-week" style={{ '--days': jours.length, '--hours': span / 60 } as CSSProperties}>
      <div className="agenda-week__axis" aria-hidden="true">
        {hours(plage).map((hr) => (
          <span key={hr} style={{ top: y(hr * 60) }}>
            {String(hr).padStart(2, '0')}:00
          </span>
        ))}
      </div>
      {jours.map((j, d) => {
        const timed = j.evenements.filter((e) => !e.journee)
        const { lane, count } = lanes(timed)
        return (
          <div key={j.date} className={`agenda-week__day${j.aujourdhui ? ' is-today' : ''}`} style={stagger(d)}>
            <div className="agenda-week__label">
              {j.label}
              {j.evenements.some((e) => e.journee) && <span className="agenda-week__allday" title={j.evenements.filter((e) => e.journee).map((e) => e.titre).join(', ')} />}
            </div>
            <div className="agenda-week__col">
              {hours(plage).map((hr) => (
                <span key={hr} className="agenda-week__line" style={{ top: y(hr * 60) }} aria-hidden="true" />
              ))}
              {(j.libres ?? []).map((s) => (
                <span key={s.de} className="agenda-week__libre" style={{ top: y(s.de), height: h(s.de, s.a) }} title={`Libre ${s.debut} → ${s.fin}`} />
              ))}
              {timed.map((e) => {
                const l = lane.get(`${e.id}@${e.de}`) ?? 0
                return (
                  <div
                    key={`${e.id}@${e.de}`}
                    className={`agenda-wbloc agenda-bloc--${e.etat}`}
                    style={{ top: y(e.de), height: h(e.de, e.a), left: `${(l / count) * 100}%`, width: `${100 / count}%` }}
                    title={`${e.debut} → ${e.fin} · ${e.titre}`}
                  >
                    <span className="agenda-bloc__time">{e.debut}</span>
                    <span className="agenda-bloc__title">{e.titre}</span>
                  </div>
                )
              })}
              {j.aujourdhui && maintenant !== undefined && maintenant >= plage.de && maintenant <= plage.a && <span className="agenda-week__now" style={{ top: y(maintenant) }} aria-hidden="true" />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** La liste lisible des rendez-vous (sous la frise, ou seule sur un écran étroit). */
function Liste({ jours, multi }: { jours: UiAgendaJour[]; multi: boolean }) {
  return (
    <div className={`agenda-list${multi ? ' agenda-list--multi' : ''}`}>
      {jours.map((j) => (
        <section key={j.date} className={`agenda-list__day${j.aujourdhui ? ' is-today' : ''}`}>
          {multi && <h4 className="agenda-list__label">{j.label}{j.aujourdhui ? ' · AUJOURD’HUI' : ''}</h4>}
          {j.evenements.length === 0 && !(j.libres ?? []).length && <p className="perso-empty">Rien de prévu.</p>}
          <ol>
            {[...j.evenements.map((e) => ({ de: e.journee ? -1 : e.de, e })), ...(j.libres ?? []).map((l) => ({ de: l.de, l }))]
              .sort((x, y) => x.de - y.de)
              .map((row, i) =>
                'e' in row ? (
                  <li key={`${row.e.id}@${row.e.de}`} className={`agenda-item agenda-item--${row.e.etat}`} style={stagger(i)}>
                    <span className="agenda-item__time">{row.e.journee ? 'JOURNÉE' : `${row.e.debut} → ${row.e.fin}`}</span>
                    <span className="agenda-item__rail" aria-hidden="true" />
                    <span className="agenda-item__text">
                      <strong>{row.e.titre}</strong>
                      <span className="agenda-item__meta">
                        <EventMeta e={row.e} />
                      </span>
                    </span>
                    {row.e.etat === 'en_cours' ? <Tag b={{ label: 'EN COURS', tone: 'info' }} /> : row.e.reponse ? <Tag b={row.e.reponse} /> : null}
                  </li>
                ) : (
                  <li key={`libre-${row.l.de}`} className="agenda-item agenda-item--libre" style={stagger(i)}>
                    <span className="agenda-item__time">
                      {row.l.debut} → {row.l.fin}
                    </span>
                    <span className="agenda-item__rail" aria-hidden="true" />
                    <span className="agenda-item__text">
                      <strong>Créneau libre</strong>
                    </span>
                  </li>
                )
              )}
          </ol>
        </section>
      ))}
    </div>
  )
}

export function AgendaView({ data }: { data: UiAgenda }) {
  const multi = data.jours.length > 1
  const allDay = data.jours.flatMap((j) => j.evenements.filter((e) => e.journee))
  const p = data.prochain
  return (
    <div className="perso perso-agenda">
      <header className="agenda-head">
        <h3 className="perso-fil__subject">{data.titre}</h3>
        <span className="agenda-head__sub">{data.sousTitre}</span>
      </header>
      <div className="agenda-hero">
        {p ? (
          <div className="agenda-next">
            <span className="agenda-radar" aria-hidden="true">
              <span />
            </span>
            <span className="agenda-next__kicker">PROCHAIN RENDEZ-VOUS</span>
            <strong className="agenda-next__dans">{p.dans}</strong>
            <span className="agenda-next__title">{p.titre}</span>
            <span className="agenda-next__when">
              {p.quand}
              {p.lieu && (
                <span className="agenda-meta">
                  <PinIcon />
                  {p.lieu}
                </span>
              )}
              {p.visio && (
                <span className="agenda-meta">
                  <CamIcon />
                  Visio
                </span>
              )}
            </span>
          </div>
        ) : (
          <div className="agenda-next agenda-next--calm">
            <span className="agenda-next__kicker">PROCHAIN RENDEZ-VOUS</span>
            <strong className="agenda-next__dans">Aucun</strong>
            <span className="agenda-next__title">Rien de prévu sur cette période.</span>
          </div>
        )}
        <div className="perso-stats">
          {data.kpis.map((k, i) => (
            <Stat key={k.label} k={k} i={i} />
          ))}
        </div>
      </div>
      {!multi && allDay.length > 0 && (
        <div className="agenda-allday">
          {allDay.map((e) => (
            <span key={e.id} className="perso-tag perso-tag--info">
              {e.titre}
            </span>
          ))}
        </div>
      )}
      {multi ? (
        <>
          <Semaine jours={data.jours} plage={data.plage} maintenant={data.maintenant} />
          <div className="agenda-narrow-only">
            <Liste jours={data.jours} multi />
          </div>
        </>
      ) : (
        <>
          <Frise jour={data.jours[0]!} plage={data.plage} maintenant={data.maintenant} duree={data.duree} />
          <Liste jours={data.jours} multi={false} />
        </>
      )}
    </div>
  )
}
