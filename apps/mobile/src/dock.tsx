import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type TouchEvent } from 'react'
import type { UiAgendaEvent } from '@code/protocol'
import { echeanceCourt, echeanceDans, echeancesDuJour, inWords, jourMois, useNow, type Code } from '@code/ui'

/**
 * La réglette du bas : au repos, une ligne discrète (prochain rappel, prochaine échéance, mails
 * importants, prochain rendez-vous, prochaine tâche) ; au toucher, un tiroir qui se déploie par
 * couches, façon Jarvis, avec les listes et leurs actions.
 */

const REFRESH_MS = 5 * 60_000

type Tab = 'rappels' | 'echeances' | 'mails' | 'agenda' | 'taches'
type Show = (tool: string, args: Record<string, unknown>, id: string) => void

/** Garde les rendez-vous du jour et les mails importants à jour tant que Google est connecté. */
function usePersoRefresh(code: Code): void {
  const { client, state } = code
  // Google relié, ou au moins une boîte mail IMAP : le résumé (rendez-vous, mails) se rafraîchit.
  const on = state.connection === 'connecte' && (state.google.etat === 'connecte' || (state.boites?.length ?? 0) > 0)
  useEffect(() => {
    if (!on) return
    client.refreshPerso()
    const t = setInterval(() => client.refreshPerso(), REFRESH_MS)
    return () => clearInterval(t)
  }, [on, client])
}

/** Minutes depuis minuit dans le fuseau de l'utilisateur. */
function minutesNow(tz: string): number {
  const [h, m] = new Date().toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

const upcoming = (events: UiAgendaEvent[] | null | undefined, now: number) => (events ?? []).filter((e) => !e.journee && e.a > now)

// ── Icônes ───────────────────────────────────────────────────────────────

const ICONS: Record<Tab, ReactElement> = {
  rappels: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 9v4l2.5 2M5 4 2.5 6.5M19 4l2.5 2.5" />
    </svg>
  ),
  echeances: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3.5h9l3.5 3.5v13.5H6z" />
      <path d="M15 3.5V7h3.5M9 12h6M9 16h4" />
    </svg>
  ),
  mails: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  ),
  agenda: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  ),
  taches: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </svg>
  )
}

const LABELS: Record<Tab, string> = { rappels: 'RAPPELS', echeances: 'ÉCHÉANCES', mails: 'MAILS', agenda: 'AGENDA', taches: 'TÂCHES' }

// ── Réglette ─────────────────────────────────────────────────────────────

export function Dock({ code, hidden, show, onSettings }: { code: Code; hidden: boolean; show: Show; onSettings?: () => void }) {
  usePersoRefresh(code)
  const { state, client } = code
  const [open, setOpen] = useState<Tab | null>(null)
  const nowMs = useNow(30_000)
  const now = minutesNow(state.utilisateur?.reglages.fuseau ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  // Le tiroir se replie si une conversation commence.
  useEffect(() => {
    if (hidden) setOpen(null)
  }, [hidden])

  const rappels = state.rappels.filter((r) => r.etat === 'a_venir')
  const nextRappel = rappels[0]
  const mails = state.perso?.mails ?? []
  const unread = mails.filter((m) => m.nonLu).length
  const events = upcoming(state.perso?.agenda, now)
  const nextEvent = events[0]
  const taches = state.taches.filter((t) => t.etat !== 'terminee')
  const nextTache = [...taches].filter((t) => t.prochaine).sort((a, b) => (a.prochaine ?? 0) - (b.prochaine ?? 0))[0]
  const running = taches.find((t) => t.enCours)
  const echeances = echeancesDuJour(state.echeances, state.utilisateur?.reglages.fuseau ?? Intl.DateTimeFormat().resolvedOptions().timeZone, nowMs)
  const retards = echeances.filter((e) => e.jours < 0).length
  const nextEcheance = echeances.find((e) => e.jours >= 0)

  const cells: { tab: Tab; main: string; sub?: string; hot?: boolean }[] = [
    { tab: 'rappels', main: nextRappel ? nextRappel.heure : '—', sub: nextRappel?.texte ?? 'Aucun rappel' },
    retards
      ? { tab: 'echeances', main: String(retards), sub: retards > 1 ? 'en retard' : `${echeances[0]!.titre} en retard`, hot: true }
      : { tab: 'echeances', main: nextEcheance ? echeanceCourt(nextEcheance.jours).replace('DANS ', '') : '—', sub: nextEcheance?.titre ?? 'Rien à régler' },
    { tab: 'mails', main: String(unread || mails.length || 0), sub: unread ? 'non lus' : 'importants', hot: unread > 0 },
    { tab: 'agenda', main: nextEvent ? nextEvent.debut : '—', sub: nextEvent?.titre ?? (state.google.agenda ? 'Rien d’autre' : 'Google') },
    { tab: 'taches', main: running ? '…' : nextTache ? (nextTache.prochaineLabel.split(' · ')[1] ?? '—') : '—', sub: running ? `${running.titre} en cours` : (nextTache?.titre ?? 'Aucune tâche'), hot: Boolean(running) }
  ]

  // L'ordre et le choix des cartes : ceux des Réglages (la météo est en haut de l'écran, pas ici).
  const order = (state.utilisateur?.reglages.widgets ?? [])
    .filter((w) => w.visible && w.id !== 'meteo')
    .map((w) => (w.id === 'aujourdhui' ? 'agenda' : w.id) as Tab)
  const shown = order.map((t) => cells.find((c) => c.tab === t)).filter((c): c is (typeof cells)[number] => Boolean(c))

  const go: Show = (tool, args, id) => {
    setOpen(null)
    show(tool, args, id)
  }

  return (
    <>
      {/* Retirée (conversation, panneaux), elle rend aussi sa hauteur : les boutons du dessus descendent tout en bas. */}
      <div className={`dock-place${hidden ? ' is-retiree' : ''}`}>
      <nav className={`dock${hidden || open ? ' dock--away' : ''}`} aria-label="Rappels, échéances, mails, agenda et tâches" inert={hidden || undefined}>
        {shown.map((c, i) => (
          <button key={c.tab} type="button" className={`dock__cell${c.hot ? ' is-hot' : ''}`} style={{ '--i': i } as CSSProperties} onClick={() => setOpen(c.tab)} aria-label={`${LABELS[c.tab]} : ${c.main} ${c.sub ?? ''}`}>
            <span className="dock__icon">{ICONS[c.tab]}</span>
            <span className="dock__text">
              <strong>{c.main}</strong>
              <small>{c.sub}</small>
            </span>
          </button>
        ))}
      </nav>
      </div>
      {open && (
        <Drawer
          tab={open}
          onTab={setOpen}
          onClose={() => setOpen(null)}
          counts={{ rappels: rappels.length, echeances: echeances.length, mails: unread || mails.length, agenda: events.length, taches: taches.length }}
          onSettings={
            onSettings &&
            (() => {
              setOpen(null)
              onSettings()
            })
          }
        >
          {open === 'rappels' && (
            <List empty="Aucun rappel. Dites « rappelle-moi dans deux heures d’appeler le fournisseur ».">
              {state.rappels
                .filter((r) => r.etat !== 'fait')
                .map((r, i) => (
                  <li key={r.id} className={`drawer__row${r.etat === 'sonne' ? ' is-hot' : ''}`} style={{ '--i': i } as CSSProperties}>
                    <span className="drawer__time">{r.heure}</span>
                    <span className="drawer__body">
                      <strong>{r.texte}</strong>
                      <small>{r.etat === 'sonne' ? `SONNE${r.retard ? ' · EN RETARD' : ''}` : (r.recurrence ?? `${r.jour} · ${inWords(r.echeance, nowMs)}`)}</small>
                    </span>
                    <span className="drawer__acts">
                      <button type="button" className="drawer__btn drawer__btn--main" onClick={() => client.reminderAction(r.id, 'fait')}>
                        Fait
                      </button>
                      <button type="button" className="drawer__btn" onClick={() => client.reminderAction(r.id, 'reporter', 10)}>
                        +10
                      </button>
                    </span>
                  </li>
                ))}
            </List>
          )}
          {open === 'echeances' && (
            <List empty="Rien à régler. Dites « note la facture d’électricité de 84 euros pour le 14 »." more={{ label: 'L’ÉCHÉANCIER', onClick: () => go('echeances_lister', {}, 'dock-echeances') }}>
              {echeances.map((e, i) => (
                <li key={e.id} className={`drawer__row${e.jours < 0 ? ' is-hot' : ''}`} style={{ '--i': i } as CSSProperties}>
                  <span className="drawer__time">{`${jourMois(e.date).jour} ${jourMois(e.date).mois}`}</span>
                  <span className="drawer__body">
                    <strong>{e.titre}</strong>
                    <small>{[echeanceDans(e.jours), e.montant, e.recurrence].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="drawer__acts">
                    <button type="button" className="drawer__btn drawer__btn--main" onClick={() => client.echeanceReglee(e.id)}>
                      Réglée
                    </button>
                  </span>
                </li>
              ))}
            </List>
          )}
          {open === 'mails' &&
            (!state.google.gmail && !state.boites?.length ? (
              <p className="drawer__empty">Gmail s’affichera ici une fois Google connecté depuis l’ordinateur.</p>
            ) : (
              <List empty={state.perso?.erreur ?? 'Rien d’important cette semaine.'} more={{ label: 'TOUS LES MAILS IMPORTANTS', onClick: () => go('mails_importants', {}, 'dock-mails') }}>
                {mails.slice(0, 8).map((m, i) => (
                  <li key={m.id} style={{ '--i': i } as CSSProperties}>
                    <button type="button" className={`drawer__row drawer__row--btn${m.nonLu ? ' is-unread' : ''}`} onClick={() => go('mail_lire', { mail: m.id }, `dock-fil-${m.id}`)}>
                      <span className="drawer__dot" aria-label={m.nonLu ? 'Non lu' : undefined} />
                      <span className="drawer__body">
                        <strong>
                          {m.de}
                          {m.boite && <span className={`drawer__box${m.boite === 'Gmail' ? ' is-gmail' : ''}`}>{m.boite}</span>}
                        </strong>
                        <small>{m.objet}</small>
                      </span>
                      <span className="drawer__when">{m.quand}</span>
                    </button>
                  </li>
                ))}
              </List>
            ))}
          {open === 'agenda' &&
            (!state.google.agenda ? (
              <p className="drawer__empty">L’agenda s’affichera ici une fois Google connecté depuis l’ordinateur.</p>
            ) : (
              <List empty="Plus rien aujourd’hui. La journée est à vous." more={{ label: 'LA SEMAINE', onClick: () => go('agenda_evenements', { periode: 'semaine' }, 'dock-semaine') }}>
                {(state.perso?.agenda ?? []).map((e, i) => {
                  const past = !e.journee && e.a <= now
                  const live = e.journee || (e.de <= now && e.a > now)
                  return (
                    <li key={`${e.id}@${e.de}`} style={{ '--i': i } as CSSProperties}>
                      <button type="button" className={`drawer__row drawer__row--btn${past ? ' is-past' : ''}${live ? ' is-live' : ''}`} onClick={() => go('agenda_evenements', { periode: 'aujourdhui' }, 'dock-jour')}>
                        <span className="drawer__time">{e.journee ? 'JOUR' : e.debut}</span>
                        <span className="drawer__body">
                          <strong>{e.titre}</strong>
                          <small>{[e.journee ? 'Toute la journée' : `jusqu’à ${e.fin}`, e.lieu ?? (e.visio ? 'Visio' : '')].filter(Boolean).join(' · ')}</small>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </List>
            ))}
          {open === 'taches' && (
            <List empty="Aucune tâche. Dites « tous les jours à dix-sept heures, propose-moi deux idées de TikTok ».">
              {[...taches]
                .sort((a, b) => Number(b.enCours) - Number(a.enCours) || (a.prochaine ?? Infinity) - (b.prochaine ?? Infinity))
                .map((t, i) => (
                  <li key={t.id} className={`drawer__row${t.enCours ? ' is-hot' : ''}${t.etat === 'pause' ? ' is-past' : ''}`} style={{ '--i': i } as CSSProperties}>
                    <span className="drawer__time">{t.enCours ? '…' : t.prochaine ? (t.prochaineLabel.split(' · ')[1] ?? '—') : '—'}</span>
                    <button type="button" className="drawer__body drawer__body--btn" onClick={() => (t.derniere && !t.enCours ? go('tache_resultat', { execution: t.derniere.id }, `dock-tache-${t.id}`) : go('taches_lister', {}, 'dock-taches'))}>
                      <strong>{t.titre}</strong>
                      <small>{t.enCours ? 'en cours…' : t.etat === 'pause' ? `en pause · ${t.quand}` : t.derniere ? `${t.derniere.statut === 'ok' ? 'dernier résultat' : 'échec'} · ${t.derniere.quand}` : t.quand}</small>
                    </button>
                    <span className="drawer__acts">
                      {!t.enCours && t.etat === 'active' && (
                        <button type="button" className="drawer__btn drawer__btn--main" onClick={() => client.taskAction(t.id, 'executer')}>
                          Lancer
                        </button>
                      )}
                      {t.etat === 'pause' && (
                        <button type="button" className="drawer__btn drawer__btn--main" onClick={() => client.taskAction(t.id, 'reprendre')}>
                          Reprendre
                        </button>
                      )}
                    </span>
                  </li>
                ))}
            </List>
          )}
        </Drawer>
      )}
    </>
  )
}

function List({ children, empty, more }: { children: ReactElement[] | ReactElement; empty: string; more?: { label: string; onClick: () => void } }) {
  const items = Array.isArray(children) ? children : [children]
  return (
    <>
      {items.length === 0 ? <p className="drawer__empty">{empty}</p> : <ol className="drawer__list">{items}</ol>}
      {more && (
        <button type="button" className="drawer__more" onClick={more.onClick}>
          {more.label} ›
        </button>
      )}
    </>
  )
}

// ── Tiroir ───────────────────────────────────────────────────────────────

function Drawer({ tab, onTab, onClose, counts, onSettings, children }: { tab: Tab; onTab: (t: Tab) => void; onClose: () => void; counts: Record<Tab, number>; onSettings?: () => void; children: ReactNode }) {
  const start = useRef<number | null>(null)
  const [drag, setDrag] = useState(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Glisser vers le bas depuis la poignée ou les onglets referme le tiroir.
  const onStart = (e: TouchEvent) => (start.current = e.touches[0]?.clientY ?? null)
  const onMove = (e: TouchEvent) => start.current !== null && setDrag(Math.max(0, (e.touches[0]?.clientY ?? 0) - start.current))
  const onEnd = () => {
    if (drag > 90) onClose()
    start.current = null
    setDrag(0)
  }
  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label={LABELS[tab]}>
      <button type="button" className="drawer__backdrop" aria-label="Fermer" onClick={onClose} />
      <section className="drawer__sheet" style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}>
        <span className="drawer__scan" aria-hidden="true" />
        <span className="drawer__corner drawer__corner--tl" aria-hidden="true" />
        <span className="drawer__corner drawer__corner--tr" aria-hidden="true" />
        <header className="drawer__head" onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}>
          <span className="drawer__grip" aria-hidden="true" />
          <div className="drawer__tabs" role="tablist">
            {(Object.keys(LABELS) as Tab[]).map((t, i) => (
              <button key={t} type="button" role="tab" aria-selected={t === tab} className={`drawer__tab${t === tab ? ' is-current' : ''}`} style={{ '--i': i } as CSSProperties} onClick={() => onTab(t)}>
                <span className="drawer__tab-icon">{ICONS[t]}</span>
                <span>{LABELS[t]}</span>
                {counts[t] > 0 && <em>{counts[t]}</em>}
              </button>
            ))}
          </div>
        </header>
        <div className="drawer__content" key={tab}>
          {children}
        </div>
        {onSettings && (
          <button type="button" className="drawer__settings" onClick={onSettings}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="10" cy="17" r="2" />
            </svg>
            <span>RÉGLAGES</span>
            <small>Thème, voix, habitudes, appareils</small>
          </button>
        )}
      </section>
    </div>
  )
}
