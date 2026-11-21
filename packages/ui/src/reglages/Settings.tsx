import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Appareil, UsageKind, UsageResume, UsageTotals } from '@code/protocol'
import type { Code } from '../hooks.ts'
import { Orb } from '../Orb.tsx'
import { QualiteVoixField, VoixBibliothequeField } from './VoixBibliotheque.tsx'
import { AppellationField, ConnecteursField, DeveloppementField, HabitudesField, PlafondField, LieuField, RegistreField, OrbeField, ThemeField, ThemePreview, VoicePrintField, VoixField, WidgetsField } from './fields.tsx'
import { MoteursField } from './moteurs.tsx'
import { CompetencesField } from './competences.tsx'
import { VoixServicesField } from './voix-services.tsx'
import { ClesField, ComptesField, IdentifiantsField, NomAssistantField, NomPersonneField, ProfilField, nomDe } from './comptes.tsx'

/**
 * Réglages : tout ce que l'assistant de premier lancement a demandé, plus les clés API et les moteurs, les appareils
 * connectés (révocation), le compte, le compteur de tokens et, pour le propriétaire, les comptes de
 * l'installation. Chaque changement s'enregistre aussitôt.
 */

export type SettingsSection =
  | 'assistant'
  | 'identite'
  | 'apparence'
  | 'widgets'
  | 'voix'
  | 'empreinte'
  | 'habitudes'
  | 'competences'
  | 'cles'
  | 'moteurs'
  | 'connecteurs'
  | 'developpement'
  | 'appareils'
  | 'consommation'
  | 'compte'
  | 'comptes'

type SectionId = SettingsSection

/** `comptes` : au propriétaire seulement, en dernier. */
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'assistant', label: 'Assistant' },
  { id: 'identite', label: 'Identité' },
  { id: 'apparence', label: 'Apparence' },
  { id: 'widgets', label: 'Cartes' },
  { id: 'voix', label: 'Sa voix' },
  { id: 'empreinte', label: 'Votre voix' },
  { id: 'habitudes', label: 'Habitudes' },
  { id: 'competences', label: 'Compétences' },
  { id: 'cles', label: 'Clés API' },
  { id: 'moteurs', label: 'Moteurs' },
  { id: 'connecteurs', label: 'Connecteurs' },
  { id: 'developpement', label: 'Développement' },
  { id: 'appareils', label: 'Appareils' },
  { id: 'consommation', label: 'Consommation' },
  { id: 'compte', label: 'Compte' },
  { id: 'comptes', label: 'Comptes' }
]

/** L'icône de chaque section, dans le rail. */
const ICONES: Record<SectionId, ReactNode> = {
  assistant: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </>
  ),
  identite: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  apparence: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </>
  ),
  widgets: (
    <>
      <rect x="3" y="4" width="8" height="7" rx="2" />
      <rect x="13" y="4" width="8" height="7" rx="2" />
      <rect x="3" y="13" width="8" height="7" rx="2" />
      <rect x="13" y="13" width="8" height="7" rx="2" />
    </>
  ),
  voix: <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />,
  empreinte: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  habitudes: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  competences: <path d="M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h5" />,
  cles: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M17 6l3 3" />
    </>
  ),
  moteurs: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
  connecteurs: <path d="M9 7H6a3 3 0 0 0 0 6h3M15 7h3a3 3 0 0 1 0 6h-3M8 10h8" />,
  developpement: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
  appareils: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  consommation: <path d="M12 3v18M16 7h-5.5a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5H8" />,
  compte: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  comptes: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20c.8-3.5 3-5 6-5s5.2 1.5 6 5M15 15c3 0 5 1.5 6 4" />
    </>
  )
}

type Props = {
  code: Code
  device: 'mac' | 'mobile'
  /** Notifications et association du téléphone, propres à l'appareil. */
  phone?: ReactNode
  onClose: () => void
  /** Section à montrer à l'ouverture (« widgets » depuis le lien sous les cartes du cockpit). */
  section?: SettingsSection
}

export function Settings({ code, device, phone, onClose, section }: Props) {
  const { state, client } = code
  const u = state.utilisateur
  const [active, setActive] = useState<SectionId>(section ?? 'assistant')
  const scroller = useRef<HTMLDivElement>(null)
  const index = useRef<HTMLElement>(null)
  const connected = state.connection === 'connecte'

  // À l'ouverture : voix proposées, appareils et compteur (tenus à jour ensuite par le serveur).
  useEffect(() => {
    if (!connected) return
    client.requestReglages()
    client.requestDevices()
    client.requestUsage()
  }, [connected, client])

  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  // La section lue suit le défilement (index à gauche sur le Mac, onglets en haut sur le téléphone).
  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const io = new IntersectionObserver(
      () => {
        // La section lue : la dernière dont le haut a atteint celui de la zone de lecture. On regarde toutes les
        // sections, pas seulement celles qui viennent de bouger : la dernière à bouger est souvent celle qui sort.
        const limit = root.getBoundingClientRect().top + 24
        const all = [...root.querySelectorAll<HTMLElement>('.st-section')]
        const top = all.filter((el) => el.getBoundingClientRect().top <= limit).pop() ?? all[0]
        if (top) setActive(top.id.replace('rg-', '') as SectionId)
      },
      { root, rootMargin: '0px 0px -65% 0px' }
    )
    root.querySelectorAll('.st-section').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  // Sur le téléphone, la rangée d'onglets glisse pour garder la section lue en vue.
  useEffect(() => {
    const nav = index.current
    const on = nav?.querySelector<HTMLElement>('.is-on')
    if (!nav || !on || nav.scrollWidth <= nav.clientWidth) return
    nav.scrollTo({ left: on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' })
  }, [active])

  const jump = (id: SectionId) => {
    setActive(id)
    scroller.current?.querySelector(`#rg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // Ouvert sur une section : on y descend aussitôt, d'un saut (le défilement doux du conteneur
  // serait interrompu par l'ouverture du panneau).
  useLayoutEffect(() => {
    const root = scroller.current
    const el = section ? root?.querySelector<HTMLElement>(`#rg-${section}`) : null
    if (root && el) root.scrollTo({ top: root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top, behavior: 'instant' })
  }, [section])

  if (!u) return null
  const nom = nomDe(code)
  const sections = SECTIONS.filter((s) => s.id !== 'comptes' || u.proprietaire)
  return (
    <div className={`st st--${device}`} role="dialog" aria-modal="true" aria-label={`Réglages de ${nom}`}>
      <div className="st__veil" onClick={onClose} aria-hidden="true" />
      <div className="st__sheet">
        <div className="st__sol" aria-hidden="true" />
        <header className="st__head">
          <span className="st__brand">
            <Orb mode="repos" size={40} label={nom} />
            <span className="st__title">Réglages</span>
          </span>
          <button type="button" className="st__close" onClick={onClose} aria-label="Fermer les réglages">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <nav className="st__index" aria-label="Sections" ref={index}>
          <div className="st__rail">
            {sections.map((s) => (
              <button key={s.id} type="button" className={active === s.id ? 'is-on' : ''} aria-current={active === s.id} onClick={() => jump(s.id)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {ICONES[s.id]}
                </svg>
                {s.label}
              </button>
            ))}
          </div>
        </nav>
        <div className="st__scroll" ref={scroller}>
          {!connected && <p className="rg-note st__offline">Serveur injoignable : les réglages s’enregistreront au retour de la connexion.</p>}
          <Section id="assistant" title="Assistant" hint="Son nom, et ce pour quoi vous l’utilisez surtout.">
            <NomAssistantField code={code} />
            <ProfilField code={code} />
          </Section>
          <Section id="identite" title="Identité" hint={`Comment ${nom} vous appelle, et sur quel ton.`}>
            <NomPersonneField code={code} />
            <AppellationField code={code} />
            <RegistreField code={code} />
            <LieuField code={code} />
          </Section>
          <Section id="apparence" title="Apparence" hint="La couleur et l’orbe valent pour tous vos appareils.">
            <ThemeField code={code} />
            <OrbeField code={code} />
            <ThemePreview theme={u.reglages.theme} nom={nomDe(code)} />
          </Section>
          <Section id="widgets" title="Cartes" hint={device === 'mac' ? 'Les cartes autour de l’orbe : lesquelles, dans quel ordre, de quel côté.' : 'Les cartes de la réglette du bas, et la météo en haut de l’écran.'}>
            <WidgetsField code={code} device={device} />
          </Section>
          <Section id="voix" title={`Voix de ${nom}`}>
            <VoixField code={code} />
            <VoixBibliothequeField code={code} />
            <QualiteVoixField code={code} />
            <VoixServicesField code={code} />
          </Section>
          <Section id="empreinte" title="Votre voix" hint={`L’empreinte vocale : ${nom} n’obéit qu’à vous.`}>
            <VoicePrintField code={code} />
          </Section>
          <Section id="habitudes" title="Habitudes">
            <HabitudesField code={code} phone={phone} />
          </Section>
          <Section id="competences" title="Compétences" hint={`Vos méthodes, en texte simple : ${nom} lit leur nom et quand s’en servir, puis la méthode quand une demande y correspond.`}>
            <CompetencesField code={code} nom={nom} />
          </Section>
          <Section id="cles" title="Clés API" hint="Vos propres clés : vos échanges sont facturés sur vos comptes, jamais sur ceux d’un autre.">
            <ClesField code={code} />
          </Section>
          <Section id="moteurs" title="Moteurs" hint={`Le modèle qui fait penser ${nom}, pour chaque usage. Changeable à tout moment.`}>
            <MoteursField code={code} />
          </Section>
          <Section id="connecteurs" title="Connecteurs">
            <ConnecteursField code={code} device={device} />
          </Section>
          <Section id="developpement" title="Développement" hint="Vos outils de travail : l’assistant les consulte quand vous le lui demandez ; ce qui modifie quelque chose attend votre validation.">
            <DeveloppementField code={code} />
          </Section>
          <Section id="appareils" title="Appareils connectés" hint="Retirer un appareil le déconnecte aussitôt.">
            <Devices code={code} />
          </Section>
          <Section id="consommation" title="Consommation" hint="Ce que coûtent vos échanges avec le modèle.">
            <Usage usage={state.usage} />
            <PlafondField code={code} />
          </Section>
          <Section id="compte" title="Compte">
            <div className="rg-field">
              <p className="st__account">
                <strong>{[u.prenom, u.nom].filter(Boolean).join(' ')}</strong>
                {u.fonction && <span>{u.fonction}</span>}
              </p>
            </div>
            <IdentifiantsField code={code} />
            <div className="rg-field">
              <div className="rg-row">
                <button type="button" className="rg-mini rg-mini--warn" onClick={() => client.logout()}>
                  Se déconnecter de cet appareil
                </button>
              </div>
            </div>
          </Section>
          {u.proprietaire && (
            <Section id="comptes" title="Comptes" hint="Les personnes qui utilisent ce serveur, chacune avec son assistant à elle.">
              <ComptesField code={code} />
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ id, title, hint, children }: { id: SectionId; title: string; hint?: string; children: ReactNode }) {
  return (
    <section id={`rg-${id}`} className={`st-section st-section--${id}`} aria-labelledby={`rg-${id}-t`}>
      <h2 id={`rg-${id}-t`} className="st-section__title">
        {title}
      </h2>
      {hint && <p className="st-section__hint">{hint}</p>}
      {children}
    </section>
  )
}

// ── Appareils ────────────────────────────────────────────────────────────

const ago = (ms: number | null) => {
  if (!ms) return 'jamais vu'
  const min = Math.round((Date.now() - ms) / 60_000)
  if (min < 2) return 'en ligne'
  if (min < 60) return `il y a ${min} min`
  if (min < 48 * 60) return `il y a ${Math.round(min / 60)} h`
  return `le ${new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
}

const DEVICE_ICON: Record<Appareil['type'], ReactNode> = {
  mac: <path d="M3 5h18v11H3zM8 20h8M12 16v4" />,
  mobile: <path d="M8 2.5h8a1 1 0 0 1 1 1v17a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1zM11 18.5h2" />,
  navigateur: <path d="M3 5h18v14H3zM3 9h18" />
}

function Devices({ code }: { code: Code }) {
  const { state, client } = code
  const [confirm, setConfirm] = useState<number | null>(null)
  const list = state.appareils
  if (!list) return <p className="rg-note">Chargement…</p>
  return (
    <ul className="st-devices">
      {list.map((d) => {
        const current = d.id === state.appareilId
        return (
          <li key={d.id} className={current ? 'is-current' : ''}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
              {DEVICE_ICON[d.type]}
            </svg>
            <span className="st-devices__text">
              <strong>{d.nom}</strong>
              <small className="code-mono">{current ? 'CET APPAREIL' : ago(d.vuLe).toUpperCase()}</small>
            </span>
            {current ? null : confirm === d.id ? (
              <span className="rg-row">
                <button type="button" className="rg-mini rg-mini--warn" onClick={() => (client.revokeDevice(d.id), setConfirm(null))}>
                  Confirmer
                </button>
                <button type="button" className="rg-link" onClick={() => setConfirm(null)}>
                  Annuler
                </button>
              </span>
            ) : (
              <button type="button" className="rg-mini" onClick={() => setConfirm(d.id)}>
                Retirer
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ── Compteur de tokens ───────────────────────────────────────────────────

const dollars = (n: number) => `${n < 10 ? n.toFixed(2) : n.toFixed(0)} $`.replace('.', ',')
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n)).replace('.', ',')
const USAGES: Record<UsageKind, string> = { conversation: 'Conversations', tache: 'Tâches planifiées', briefing: 'Briefings', retour: 'Points du retour' }

function Usage({ usage }: { usage: UsageResume | null }) {
  if (!usage) return <p className="rg-note">Calcul…</p>
  const mois = usage.mois
  const parts = (Object.entries(mois.parUsage) as [UsageKind, UsageTotals][]).sort((a, b) => b[1].cout - a[1].cout)
  const max = Math.max(...parts.map(([, v]) => v.cout), 0.0001)
  const tok = (x: UsageTotals) => x.entree + x.sortie + x.cacheLecture + x.cacheEcriture
  return (
    <div className="rg-field st-usage">
      <div className="st-usage__big">
        <span>
          <small className="code-mono">AUJOURD’HUI</small>
          <b>{dollars(usage.jour.total.cout)}</b>
          <em className="code-mono">{usage.jour.total.appels} APPELS · {tokens(tok(usage.jour.total))} TOKENS</em>
        </span>
        <span>
          <small className="code-mono">CE MOIS</small>
          <b>{dollars(mois.total.cout)}</b>
          <em className="code-mono">{mois.total.appels} APPELS · {tokens(tok(mois.total))} TOKENS</em>
        </span>
      </div>
      {parts.length > 0 && (
        <ul className="st-usage__bars">
          {parts.map(([k, v]) => (
            <li key={k}>
              <span>{USAGES[k]}</span>
              <span className="st-usage__bar" aria-hidden="true">
                <i style={{ width: `${Math.max(2, (v.cout / max) * 100)}%` }} />
              </span>
              <b className="code-mono">{dollars(v.cout)}</b>
            </li>
          ))}
        </ul>
      )}
      {usage.parPersonne && usage.parPersonne.length > 1 && (
        <>
          <p className="rg-label">
            <span>Par personne · ce mois</span>
          </p>
          <ul className="st-usage__people">
            {usage.parPersonne.map((p) => (
              <li key={p.utilisateurId}>
                <span>{p.nom}</span>
                <b className="code-mono">{dollars(p.mois)}</b>
                <small className="code-mono">{dollars(p.jour)} AUJ.</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
