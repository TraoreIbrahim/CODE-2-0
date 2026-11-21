import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { UiAgendaEvent } from '@code/protocol'
import { SkyIcon, echeanceDans, echeancesDuJour, inWords, jourMois, useNow, type Code } from '@code/ui'

/**
 * Panneaux « MÉTÉO », « AUJOURD'HUI », « RAPPELS », « ÉCHÉANCES », « MAILS IMPORTANTS » et « TÂCHES » du cockpit : la météo (toutes les
 * trente minutes), le compte Google personnel (toutes les cinq minutes), les rappels et les échéances (poussés par le serveur).
 * Un clic ouvre la vue détaillée dans l'interface holographique.
 */

const REFRESH_MS = 5 * 60_000

/** Minutes depuis minuit dans le fuseau de l'utilisateur (ses réglages), mises à jour toutes les 30 secondes. */
function useNowMinutes(tz: string): number {
  const read = () => {
    const [h, m] = new Date().toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
  }
  const [now, setNow] = useState(read)
  useEffect(() => {
    setNow(read())
    const t = setInterval(() => setNow(read()), 30_000)
    return () => clearInterval(t)
  }, [tz])
  return now
}

/** Garde le résumé à jour tant que Google est connecté, et juste après une action validée. */
export function usePersoRefresh(code: Code): void {
  const { client, state } = code
  // Google relié ou une boîte mail IMAP : le résumé se rafraîchit.
  const on = state.connection === 'connecte' && (state.google.etat === 'connecte' || (state.boites?.length ?? 0) > 0)
  useEffect(() => {
    if (!on) return
    client.refreshPerso()
    const t = setInterval(() => client.refreshPerso(), REFRESH_MS)
    return () => clearInterval(t)
  }, [on, client])
  const validated = state.lastOutcome?.outcome === 'valide' ? state.lastOutcome.at : 0
  useEffect(() => {
    if (!on || !validated) return
    const t = setTimeout(() => client.refreshPerso(), 2500)
    return () => clearTimeout(t)
  }, [on, validated, client])
}

/** La météo en un coup d'œil : la température, le ciel, la pluie à venir et la tendance ; un clic ouvre la carte complète. */
export function MeteoPanel({ code, show }: { code: Code; show: (tool: string, args: Record<string, unknown>, id: string) => void }) {
  const meteo = code.state.meteo
  const m = meteo?.data
  const open = (
    <button type="button" className="panel__link" onClick={() => show('meteo', {}, 'cockpit-meteo')}>
      Détail ›
    </button>
  )
  if (!m) {
    return (
      <Panel title="Météo">
        <p className="panel__empty">{meteo?.erreur ?? 'Relevé du ciel…'}</p>
      </Panel>
    )
  }
  const n = m.maintenant
  const rain = m.heures.find((h) => h.pluie > 0)
  const day = m.jours[0]
  return (
    <Panel title={`Météo · ${m.lieu}`} aside={open}>
      <button type="button" className="wx" onClick={() => show('meteo', {}, 'cockpit-meteo')} aria-label={`Météo à ${m.lieu} : ${n.temp} degrés, ${n.libelle}. Ouvrir le détail.`}>
        <SkyIcon ciel={n.ciel} nuit={n.nuit} size={58} />
        <span className="wx__now">
          <b className="wx__temp">
            {n.temp}
            <small>°</small>
          </b>
          <span className="wx__sky">{n.libelle}</span>
        </span>
        <span className="wx__side">
          {n.ressenti > n.temp && <span>ressenti {n.ressenti}°</span>}
          {day && (
            <span>
              {day.jour.toLowerCase()} {day.min}° · {day.max}°
            </span>
          )}
        </span>
      </button>
      <p className={`wx__rain${rain ? ' is-on' : ''}`}>{rain ? `Pluie vers ${rain.heure.replace(':00', ' h')} · ${String(rain.pluie).replace('.', ',')} mm` : 'Pas de pluie d’ici 12 h'}</p>
      <ol className="wx__hours" aria-label="Prochaines heures">
        {m.heures.slice(0, 6).map((h) => (
          <li key={h.heure}>
            <span>{h.heure.replace(':00', ' h')}</span>
            <SkyIcon ciel={h.ciel} nuit={h.nuit} size={20} />
            <b>{h.temp}°</b>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

function Panel({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel__bar">
        <h2 className="panel__title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Connexion, reconnexion après expiration, ou étape manquante. */
function GoogleAccess({ code }: { code: Code }) {
  const { google } = code.state
  const ready = code.state.connection === 'connecte'
  if (google.etat === 'non_configure') {
    return <p className="panel__empty">Pour voir vos rendez-vous et vos mails importants, reliez Google dans Réglages › Connecteurs (guide en cinq étapes).</p>
  }
  if (google.etat === 'connexion') {
    return (
      <div className="gaccess gaccess--wait">
        <span className="gaccess__pulse" aria-hidden="true" />
        <p>Validez l’accès dans la page Google ouverte dans votre navigateur.</p>
        <button type="button" className="link-btn" onClick={() => code.client.connectGoogle()}>
          Rouvrir la page Google
        </button>
      </div>
    )
  }
  const expired = google.etat === 'expire'
  return (
    <div className={`gaccess${expired ? ' gaccess--expire' : ''}`}>
      <p>{expired ? 'L’accès Google a expiré : en mode test, Google le coupe au bout de 7 jours.' : google.etat === 'erreur' ? google.message : 'Connectez votre compte Google pour voir vos rendez-vous et vos mails importants.'}</p>
      <button type="button" className={`code-btn ${expired ? 'code-btn--ambre-ghost' : 'code-btn--ghost'} gaccess__btn`} disabled={!ready} onClick={() => code.client.connectGoogle()}>
        <GoogleMark />
        {expired ? 'Reconnecter Google' : google.etat === 'erreur' ? 'Réessayer' : 'Connecter Google'}
      </button>
    </div>
  )
}

const GoogleMark = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M20.5 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.8a4.2 4.2 0 0 1-1.8 2.7" />
    <path d="M15 16.5A6.5 6.5 0 1 1 16.4 7" />
  </svg>
)

function etatAt(e: UiAgendaEvent, now: number): UiAgendaEvent['etat'] {
  if (e.journee) return 'en_cours'
  return e.a <= now ? 'passe' : e.de <= now ? 'en_cours' : 'a_venir'
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export function TodayPanel({ code, show }: { code: Code; show: (tool: string, args: Record<string, unknown>, id: string) => void }) {
  const { google, perso } = code.state
  const now = useNowMinutes(code.state.utilisateur?.reglages.fuseau ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  const week = google.agenda && (
    <button type="button" className="panel__link" onClick={() => show('agenda_evenements', { periode: 'semaine' }, 'cockpit-semaine')}>
      SEMAINE ›
    </button>
  )
  if (!google.agenda) {
    return (
      <Panel title="Aujourd’hui">
        <GoogleAccess code={code} />
      </Panel>
    )
  }
  const events = perso?.agenda ?? null
  const timed = (events ?? []).filter((e) => !e.journee)
  const allDay = (events ?? []).filter((e) => e.journee)
  const nextIndex = timed.findIndex((e) => etatAt(e, now) !== 'passe')
  const expiry = google.expireLe ? google.expireLe - Date.now() : Infinity
  const openDay = () => show('agenda_evenements', { periode: 'aujourdhui' }, 'cockpit-jour')
  return (
    <Panel title="Aujourd’hui" aside={week}>
      {events === null ? (
        <p className="panel__empty">{perso?.erreur ?? 'Lecture de l’agenda…'}</p>
      ) : events.length === 0 ? (
        <p className="panel__empty">Rien de prévu aujourd’hui. La journée est à vous.</p>
      ) : (
        <div className="today">
          {allDay.map((e) => (
            <span key={e.id} className="today__allday">
              {e.titre}
            </span>
          ))}
          <ol className="today__list">
            {timed.map((e, i) => (
              <li key={`${e.id}@${e.de}`} style={{ '--i': i } as CSSProperties}>
                {i === nextIndex && etatAt(e, now) === 'a_venir' && (
                  <span className="today__now" aria-label={`Maintenant, ${hhmm(now)}`}>
                    <span>{hhmm(now)}</span>
                  </span>
                )}
                <button type="button" className={`today__item today__item--${etatAt(e, now)}`} onClick={openDay}>
                  <span className="today__time">{e.debut}</span>
                  <span className="today__dot" aria-hidden="true" />
                  <span className="today__text">
                    <strong>{e.titre}</strong>
                    {(e.lieu || e.visio) && <small>{e.lieu ?? 'Visio'}</small>}
                  </span>
                </button>
              </li>
            ))}
            {nextIndex < 0 && timed.length > 0 && (
              <li>
                <span className="today__item today__item--fin">
                  <span className="today__time">{hhmm(now)}</span>
                  <span className="today__dot" aria-hidden="true" />
                  <span className="today__text">
                    <small>Plus rien aujourd’hui.</small>
                  </span>
                </span>
              </li>
            )}
          </ol>
        </div>
      )}
      <p className={`gstatus${expiry < 24 * 3600_000 || !google.drive ? ' gstatus--soon' : ''}`}>
        <span className="gstatus__dot" aria-hidden="true" />
        <span>{google.drive ? google.message : 'Drive pas encore autorisé : reconnectez Google en cochant Drive.'}</span>
        {(expiry < 24 * 3600_000 || !google.drive) && (
          <button type="button" className="link-btn" onClick={() => code.client.connectGoogle()}>
            {google.drive ? 'Reconnecter' : 'Autoriser Drive'}
          </button>
        )}
      </p>
    </Panel>
  )
}

export function MailsPanel({ code, show }: { code: Code; show: (tool: string, args: Record<string, unknown>, id: string) => void }) {
  const { google, perso, boites } = code.state
  if (!google.gmail && !boites?.length) {
    return (
      <Panel title="Mails importants">
        <p className="panel__empty">{google.etat === 'connecte' ? 'Gmail n’a pas été autorisé : reconnectez Google en cochant Gmail, ou ajoutez une boîte mail dans les Réglages.' : 'Vos mails s’afficheront ici une fois Google connecté ou une boîte mail ajoutée (Réglages, Connecteurs).'}</p>
      </Panel>
    )
  }
  const mails = perso?.mails ?? null
  const all = (
    <button type="button" className="panel__link" onClick={() => show('mails_importants', {}, 'cockpit-mails')}>
      Tout voir ›
    </button>
  )
  return (
    <Panel title="Mails importants" aside={all}>
      {mails === null ? (
        <p className="panel__empty">{perso?.erreur ?? 'Relève de la boîte…'}</p>
      ) : mails.length === 0 ? (
        <p className="panel__empty">Rien d’important cette semaine.</p>
      ) : (
        <ol className="inbox">
          {mails.slice(0, 5).map((m, i) => (
            <li key={m.id} style={{ '--i': i } as CSSProperties}>
              <button type="button" className={`inbox__item${m.nonLu ? ' is-unread' : ''}`} onClick={() => show('mail_lire', { mail: m.id }, `cockpit-fil-${m.id}`)}>
                <span className="inbox__dot" aria-label={m.nonLu ? 'Non lu' : undefined} />
                <span className="inbox__from">
                  {m.de}
                  {m.boite && <span className={`inbox__box${m.boite === 'Gmail' ? ' is-gmail' : ''}`}>{m.boite}</span>}
                </span>
                <span className="inbox__when">{m.quand}</span>
                <span className="inbox__subject">{m.objet}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

/** Rappels : ceux qui sonnent en ambre avec « Fait » et « +10 min », puis les prochains. */
export function RemindersPanel({ code, show }: { code: Code; show: (tool: string, args: Record<string, unknown>, id: string) => void }) {
  const { rappels } = code.state
  const now = useNow(30_000)
  const ringing = rappels.filter((r) => r.etat === 'sonne')
  const upcoming = rappels.filter((r) => r.etat === 'a_venir').slice(0, 4)
  const all = (
    <button type="button" className="panel__link" onClick={() => show('rappels_lister', {}, 'cockpit-rappels')}>
      Tout voir ›
    </button>
  )
  return (
    <Panel title="Rappels" aside={rappels.length > 0 && all}>
      {rappels.length === 0 && <p className="panel__empty">Aucun rappel. Dites « rappelle-moi dans deux heures d’appeler le fournisseur ».</p>}
      {ringing.map((r) => (
        <div key={r.id} className="ring" role="alert">
          <span className="ring__bell" aria-hidden="true" />
          <span className="ring__text">
            <small>{r.retard ? 'EN RETARD · ' : ''}{r.recurrence ?? `${r.heure}`}</small>
            <strong>{r.texte}</strong>
          </span>
          <span className="ring__actions">
            <button type="button" className="ring__btn ring__btn--main" onClick={() => code.client.reminderAction(r.id, 'fait')}>
              Fait
            </button>
            <button type="button" className="ring__btn" onClick={() => code.client.reminderAction(r.id, 'reporter', 10)}>
              +10 min
            </button>
          </span>
        </div>
      ))}
      {upcoming.length > 0 && (
        <ol className="soon">
          {upcoming.map((r, i) => (
            <li key={r.id} style={{ '--i': i } as CSSProperties}>
              <button type="button" className="soon__item" onClick={() => show('rappels_lister', {}, 'cockpit-rappels')}>
                <span className="soon__time">{r.heure}</span>
                <span className="soon__text">
                  <strong>{r.texte}</strong>
                  <small>{r.recurrence ?? `${r.jour} · ${inWords(r.echeance, now)}`}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

/** Échéances : les retards d'abord (en rouge), puis les prochaines (en ambre sous trois jours), avec leur montant. */
export function EcheancesPanel({ code, show }: { code: Code; show: (tool: string, args: Record<string, unknown>, id: string) => void }) {
  const tz = code.state.utilisateur?.reglages.fuseau ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const now = useNow(60_000)
  const liste = echeancesDuJour(code.state.echeances, tz, now)
  const retards = liste.filter((e) => e.jours < 0).length
  const tout = () => show('echeances_lister', {}, 'cockpit-echeances')
  const all = (
    <button type="button" className="panel__link" onClick={tout}>
      Tout voir ›
    </button>
  )
  return (
    <Panel title="Échéances" aside={liste.length > 0 && all}>
      {liste.length === 0 && <p className="panel__empty">Rien à régler. Dites « note la facture d’électricité de 84 euros pour le 14 ».</p>}
      {retards > 0 && (
        <p className="dues__alert" role="status">
          {retards} échéance{retards > 1 ? 's' : ''} en retard
        </p>
      )}
      {liste.length > 0 && (
        <ol className="soon">
          {liste.slice(0, 4).map((e, i) => {
            const d = jourMois(e.date)
            const ton = e.jours < 0 ? 'retard' : e.jours <= 3 ? 'proche' : 'loin'
            return (
              <li key={e.id} style={{ '--i': i } as CSSProperties}>
                <button type="button" className={`soon__item dues__item dues__item--${ton} ech-cat--${e.categorie}`} onClick={tout}>
                  <span className="dues__date" aria-hidden="true">
                    <strong>{d.jour}</strong>
                    <small>{d.mois}</small>
                  </span>
                  <span className="soon__text">
                    <strong>{e.titre}</strong>
                    <small>{[echeanceDans(e.jours), e.montant].filter(Boolean).join(' · ')}</small>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}

/** Tâches planifiées : les prochaines, celle qui tourne, et le dernier résultat à un clic. */
export function TasksPanel({ code, show }: { code: Code; show: (tool: string, args: Record<string, unknown>, id: string) => void }) {
  const taches = code.state.taches.filter((t) => t.etat !== 'terminee')
  const shown = [...taches].sort((a, b) => Number(b.enCours) - Number(a.enCours) || (a.prochaine ?? Infinity) - (b.prochaine ?? Infinity)).slice(0, 4)
  const all = (
    <button type="button" className="panel__link" onClick={() => show('taches_lister', {}, 'cockpit-taches')}>
      Tout voir ›
    </button>
  )
  return (
    <Panel title="Tâches" aside={taches.length > 0 && all}>
      {taches.length === 0 && <p className="panel__empty">Aucune tâche. Dites « tous les jours à dix-sept heures, propose-moi deux idées de TikTok… ».</p>}
      {shown.length > 0 && (
        <ol className="soon">
          {shown.map((t, i) => (
            <li key={t.id} style={{ '--i': i } as CSSProperties}>
              <button
                type="button"
                className={`soon__item${t.enCours ? ' soon__item--running' : ''}`}
                onClick={() => (t.derniere && !t.enCours ? show('tache_resultat', { execution: t.derniere.id }, `cockpit-tache-${t.id}`) : show('taches_lister', {}, 'cockpit-taches'))}
              >
                <span className="soon__time">{t.prochaine ? t.prochaineLabel.split(' · ')[1] : '—'}</span>
                <span className="soon__text">
                  <strong>{t.titre}</strong>
                  <small>{t.enCours ? 'en cours…' : t.derniere ? `${t.derniere.statut === 'ok' ? '' : 'échec · '}${t.derniere.resume}` : t.etat === 'pause' ? 'en pause' : t.quand}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
