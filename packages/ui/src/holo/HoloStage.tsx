import { Component, useCallback, useContext, useState, type CSSProperties, type ReactNode } from 'react'
import { NOM_ASSISTANT_DEFAUT, type UiData, type UiItem, type UiKind, type UiView } from '@code/protocol'
import { Api, Panel, type HoloAction } from './api.ts'
import { ItineraireView } from './Itineraire.tsx'
import { MeteoView, WebView } from './Meteo.tsx'
import { CodeReader, MarkdownReader, PageReader, SheetReader, TextReader } from './Reader.tsx'
import { DriveFichierView, DriveView } from './Drive.tsx'
import { Pager } from './Pager.tsx'
import { PdfViewer } from './PdfViewer.tsx'
import { AgendaView, MailFilView, MailsView } from './PersoViews.tsx'
import { RappelsView } from './Rappels.tsx'
import { TacheResultView, TachesView } from './Taches.tsx'
import { useCountUp } from './useCountUp.ts'
import { ConnecteurView } from './Connecteur.tsx'
import { SchemaView } from './Schema.tsx'
import { ProjetView } from './Projet.tsx'
import { LieuxView } from './Lieux.tsx'
import { ContactsView } from './Contacts.tsx'
import { EcheancierView } from './Echeancier.tsx'
import { PapierView, PapiersView } from './Papier.tsx'
import { ListeView, ListesView } from './Liste.tsx'
import { CameraView, MaisonView } from './Maison.tsx'
import { ReunionView, ReunionsView } from './Reunion.tsx'
import { CompetenceView, CompetencesView, MemoireView } from './Memoire.tsx'

export type { HoloAction }

/** « ~/Desktop/Projects/Asso » → « ~/Desktop/Projects » ; null à la racine d'un dossier autorisé. */
function parentOf(chemin: string): string | null {
  const parts = chemin.split('/')
  return parts.length > 2 ? parts.slice(0, -1).join('/') : null
}

/**
 * UI adaptative : chaque type de résultat d'outil a son rendu holographique.
 * Pour un nouvel outil, ajouter son `kind` au protocole et un rendu dans RENDERERS.
 */
const RENDERERS: { [K in UiKind]: (data: Extract<UiData, { kind: K }>) => ReactNode } = {
  dossier: (d) => <FolderView data={d} />,
  recherche: (d) => <SearchView data={d} />,
  infos: (d) => <InfoView data={d} />,
  document: (d) => <DocumentView data={d} />,
  meteo: (d) => <MeteoView data={d} />,
  itineraire: (d) => <ItineraireView data={d} />,
  web: (d) => <WebView data={d} />,
  donnees: (d) => <DataView data={d} />,
  connecteur: (d) => <ConnecteurView data={d} />,
  schema: (d) => <SchemaView data={d} />,
  projet: (d) => <ProjetView data={d} />,
  lieux: (d) => <LieuxView data={d} />,
  mails: (d) => <MailsView data={d} />,
  mail: (d) => <MailFilView data={d} />,
  agenda: (d) => <AgendaView data={d} />,
  rappels: (d) => <RappelsView data={d} />,
  taches: (d) => <TachesView data={d} />,
  tache: (d) => <TacheResultView data={d} />,
  drive: (d) => <DriveView data={d} />,
  drive_fichier: (d) => <DriveFichierView data={d} />,
  contacts: (d) => <ContactsView data={d} />,
  echeancier: (d) => <EcheancierView data={d} />,
  papier: (d) => <PapierView data={d} />,
  papiers: (d) => <PapiersView data={d} />,
  liste: (d) => <ListeView data={d} />,
  listes: (d) => <ListesView data={d} />,
  maison: (d) => <MaisonView data={d} />,
  camera: (d) => <CameraView data={d} />,
  reunion: (d) => <ReunionView data={d} />,
  reunions: (d) => <ReunionsView data={d} />,
  memoire: (d) => <MemoireView data={d} />,
  competence: (d) => <CompetenceView data={d} />,
  competences: (d) => <CompetencesView data={d} />
}

const LABELS: Record<UiKind, { loading: string; ready: string }> = {
  dossier: { loading: 'ANALYSE DU DOSSIER', ready: 'DOSSIER' },
  recherche: { loading: 'RECHERCHE EN COURS', ready: 'RÉSULTATS' },
  infos: { loading: 'LECTURE DES MÉTADONNÉES', ready: 'INFORMATIONS' },
  document: { loading: 'LECTURE DU DOCUMENT', ready: 'DOCUMENT' },
  meteo: { loading: 'RELEVÉ MÉTÉO', ready: 'MÉTÉO' },
  itineraire: { loading: 'CALCUL DU TRAJET', ready: 'ITINÉRAIRE' },
  web: { loading: 'RECHERCHE SUR LE WEB', ready: 'WEB · RECHERCHE' },
  donnees: { loading: 'LECTURE DES DONNÉES', ready: 'DONNÉES' },
  connecteur: { loading: 'INTERROGATION DU SERVICE', ready: 'CONNECTEUR' },
  schema: { loading: 'DESSIN DU SCHÉMA', ready: 'SCHÉMA' },
  projet: { loading: 'TOUR DU PROJET', ready: 'PROJET · GITHUB · VERCEL · EXPO' },
  lieux: { loading: 'RECHERCHE SUR GOOGLE MAPS', ready: 'LIEUX · GOOGLE MAPS' },
  mails: { loading: 'RELÈVE DU COURRIER', ready: 'COURRIER' },
  mail: { loading: 'DÉCHIFFRAGE DU FIL', ready: 'GMAIL · FIL' },
  agenda: { loading: 'SYNCHRONISATION DE L’AGENDA', ready: 'GOOGLE AGENDA' },
  rappels: { loading: 'LECTURE DES RAPPELS', ready: 'RAPPELS' },
  taches: { loading: 'LECTURE DES TÂCHES', ready: 'TÂCHES PLANIFIÉES' },
  tache: { loading: 'OUVERTURE DU RÉSULTAT', ready: 'TÂCHE · RÉSULTAT' },
  drive: { loading: 'EXPLORATION DU DRIVE', ready: 'GOOGLE DRIVE' },
  drive_fichier: { loading: 'OUVERTURE DU FICHIER', ready: 'GOOGLE DRIVE · FICHIER' },
  contacts: { loading: 'RECHERCHE DANS LES CONTACTS', ready: 'CONTACTS' },
  echeancier: { loading: 'OUVERTURE DE L’ÉCHÉANCIER', ready: 'ÉCHÉANCIER' },
  papier: { loading: 'LECTURE DU PAPIER', ready: 'PAPIER' },
  papiers: { loading: 'RECHERCHE DES PAPIERS', ready: 'PAPIERS' },
  liste: { loading: 'OUVERTURE DE LA LISTE', ready: 'LISTE' },
  listes: { loading: 'LECTURE DES LISTES', ready: 'LISTES' },
  maison: { loading: 'TOUR DE LA MAISON', ready: 'MAISON' },
  camera: { loading: 'PRISE DE VUE', ready: 'CAMÉRA' },
  reunion: { loading: 'LECTURE DE LA RÉUNION', ready: 'RÉUNION' },
  reunions: { loading: 'RECHERCHE DES RÉUNIONS', ready: 'RÉUNIONS' },
  memoire: { loading: 'LECTURE DES NOTES', ready: 'MÉMOIRE' },
  competence: { loading: 'LECTURE DE LA MÉTHODE', ready: 'COMPÉTENCE' },
  competences: { loading: 'LECTURE DES COMPÉTENCES', ready: 'COMPÉTENCES' }
}

/** Même rendu, autre population : le bandeau dit laquelle. */
function readyLabel(view: UiView): string {
  const d = view.data
  // Le service d'où viennent les données (GitHub, Figma…) : son nom dans le bandeau.
  if (d?.kind === 'donnees') return d.source.toUpperCase()
  if (d?.kind === 'connecteur') return d.source.toUpperCase()
  if (d?.kind === 'schema') return `${d.source.toUpperCase()} · SCHÉMA`
  if (d?.kind === 'drive_fichier' && d.source === 'gmail') return 'GMAIL · PIÈCE JOINTE'
  return LABELS[view.kind].ready
}

/** Rendus qui portent leur propre titre (le bandeau ne le répète pas). */
const OWN_TITLE: ReadonlySet<UiKind> = new Set(['connecteur', 'schema', 'projet', 'lieux', 'meteo', 'itineraire', 'mail', 'agenda', 'rappels', 'taches', 'tache', 'drive', 'drive_fichier', 'contacts', 'echeancier', 'papier', 'papiers', 'liste', 'listes', 'maison', 'camera', 'reunion', 'reunions', 'memoire', 'competence', 'competences'])

/** Les fiches occupent plus de place et portent leur propre titre. */
const WIDE: ReadonlySet<UiKind> = new Set(['connecteur', 'schema', 'projet', 'lieux', 'document', 'meteo', 'web', 'itineraire', 'mails', 'mail', 'agenda', 'rappels', 'taches', 'tache', 'drive', 'drive_fichier', 'contacts', 'echeancier', 'papier', 'papiers', 'liste', 'listes', 'maison', 'camera', 'reunion', 'reunions', 'memoire', 'competence', 'competences'])

type Props = {
  views: UiView[]
  /** Panneaux des tours précédents, rangés en miniature à côté (le plus récent d'abord). */
  pile?: UiView[][]
  /** Ramène un groupe rangé au premier plan. */
  onRestore?: (turnId: string) => void
  onClose: () => void
  onAction: (action: HoloAction, chemin: string) => void
  resolveUrl: (path: string) => string
  /** Une question à l'assistant, comme si elle avait été tapée (clic sur une carte, un lieu…). */
  onAsk?: (text: string) => void
  /** Autre page, onglet ou recherche d'une liste, sans passer par Claude. */
  onPage?: (viewId: string, turnId: string, tool: string, args: Record<string, unknown>) => void
  /** Un rappel : « fait », ou reporté de quelques minutes. */
  onReminder?: (id: number, action: 'fait' | 'reporter', minutes?: number) => void
  onTask?: (id: number, action: 'executer' | 'pause' | 'reprendre') => void
  /** Un élément d'une liste coché ou décoché d'un toucher. */
  onListe?: (liste: number, element: number, coche: boolean) => void
  /** Un appareil de la maison allumé ou éteint d'un toucher. */
  onMaison?: (entite: string) => void
  /** Reprendre l'image d'une caméra. */
  onCamera?: (entite: string) => void
  /** Réunions : enregistrer avec cet appareil, importer un fichier audio. */
  onReunion?: { enregistrer: () => void; importer: (fichier: File) => void }
  /** Le nom de l'assistant (« Nova » par défaut). */
  nomAssistant?: string
}

/** Le titre d'une vue, tel que le panneau l'affiche. */
const titleOf = (v: UiView) => (v.data && 'titre' in v.data && typeof v.data.titre === 'string' ? v.data.titre : v.title)

/**
 * La scène, à la manière de Stage Manager : un seul panneau au centre (le dernier dont CODE parle, ou celui
 * qu'on a choisi), les autres de la même réponse rangés en miniatures à côté, puis les interfaces des
 * réponses précédentes. La croix ferme le panneau du centre ; le suivant prend sa place.
 */
export function HoloStage({ views, pile = [], onRestore, onClose, onAction, resolveUrl, onAsk, onPage, onReminder, onTask, onListe, onMaison, onCamera, onReunion, nomAssistant }: Props) {
  /** Panneau ramené au centre par un clic, et quand : un panneau dont CODE parle ensuite passe devant. */
  const [picked, setPicked] = useState<{ id: string; at: number } | null>(null)
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const rank = (v: UiView) => (picked?.id === v.id ? Math.max(v.at, picked.at) : v.at)
  // Un panneau masqué attend que CODE en parle.
  const ordered = views.filter((v) => !v.masque && !closed.has(v.id)).sort((a, b) => rank(b) - rank(a))
  const front = ordered[0]
  if (!front) return null
  const wings = ordered.slice(1)
  const shelf = onRestore ? pile.filter((g) => g.some((v) => v.data)) : []
  const closeFront = () => {
    if (wings.length) return setClosed((c) => new Set(c).add(front.id))
    // Plus rien de cette réponse : la précédente revient, ou tout se ferme.
    if (shelf[0] && onRestore) return onRestore(shelf[0][0]!.turnId)
    onClose()
  }
  const total = ordered.length + shelf.length
  return (
    <Api.Provider value={{ act: onAction, url: resolveUrl, ask: onAsk ?? (() => {}), page: onPage ?? (() => {}), remind: onReminder ?? (() => {}), task: onTask ?? (() => {}), liste: onListe ?? (() => {}), maison: onMaison ?? (() => {}), camera: onCamera ?? (() => {}), reunion: onReunion ?? { enregistrer: () => {}, importer: () => {} }, nom: nomAssistant ?? NOM_ASSISTANT_DEFAUT }}>
    <section className={`holo-stage${wings.length || shelf.length ? ' holo-stage--pile' : ''}`} aria-label="Interface de l’outil" aria-live="polite">
      <button type="button" className="holo-close" aria-label={total > 1 ? 'Fermer ce panneau' : 'Fermer l’interface'} title={total > 1 ? 'Fermer ce panneau' : 'Fermer'} onClick={closeFront}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
      <HoloPanel key={front.id} view={front} depth={0} />
      {(wings.length > 0 || shelf.length > 0) && (
        <nav className="holo-pile" aria-label="Panneaux rangés">
          <div className="holo-pile__head">
            <span className="code-mono">{total} PANNEAUX</span>
            <button type="button" className="holo-pile__all" onClick={onClose}>
              Tout fermer
            </button>
          </div>
          <div className="holo-pile__list">
            {wings.map((v, i) => (
              <MiniCard key={v.id} view={v} index={i} icon="panneau" onOpen={() => setPicked({ id: v.id, at: Date.now() })} />
            ))}
            {shelf.length > 0 && wings.length > 0 && <span className="holo-pile__sep code-mono">AVANT</span>}
            {shelf.map((g, i) => {
              const v = [...g].filter((x) => x.data).sort((a, b) => b.at - a.at)[0]!
              return <MiniCard key={g[0]!.turnId} view={v} index={wings.length + i} icon="retour" onOpen={() => onRestore!(v.turnId)} />
            })}
          </div>
        </nav>
      )}
    </section>
    </Api.Provider>
  )
}

/**
 * Une vue qui plante n'emporte que son panneau (sans ce garde-fou, tout l'écran se vide). L'erreur part au
 * serveur dans le journal technique de l'appareil, par le gestionnaire global (`useCode`).
 */
class ViewBoundary extends Component<{ kind: UiKind; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    // Relancée hors du rendu : le gestionnaire global d'erreurs la journalise.
    setTimeout(() => {
      throw err instanceof Error ? new Error(`vue ${this.props.kind} : ${err.message}`) : err
    })
  }
  render() {
    return this.state.failed ? <p className="holo-error">Affichage impossible sur cet appareil. La réponse reste valable.</p> : this.props.children
  }
}

/**
 * Un panneau rangé à côté, en miniature : le vrai panneau en réduction, inerte, penché vers la scène. Un clic
 * le ramène au centre (`panneau` : de cette réponse ; `retour` : d'une réponse précédente).
 */
function MiniCard({ view, index, icon, onOpen }: { view: UiView; index: number; icon: 'panneau' | 'retour'; onOpen: () => void }) {
  const label = view.status === 'pret' ? readyLabel(view) : view.status === 'erreur' ? 'ÉCHEC' : LABELS[view.kind].loading
  return (
    // La miniature contient un vrai panneau (et ses boutons, inertes) : le clic passe par un bouton posé dessus,
    // jamais par un bouton qui en contiendrait d'autres.
    <div className={`holo-mini holo-mini--${icon}`} style={{ '--i': index } as CSSProperties}>
      <button type="button" className="holo-mini__hit" onClick={onOpen} aria-label={`${icon === 'retour' ? 'Revenir à' : 'Afficher'} : ${titleOf(view)}`} />
      <span className="holo-mini__screen" aria-hidden="true" inert>
        <span className="holo-mini__scale">
          <HoloPanel view={view} depth={0} mini />
        </span>
      </span>
      <span className="holo-mini__label">
        {icon === 'retour' ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="13" height="14" rx="1.5" />
            <path d="M20 8v10" />
          </svg>
        )}
        <span>{label}</span>
      </span>
    </div>
  )
}

function HoloPanel({ view, depth, mini = false }: { view: UiView; depth: number; mini?: boolean }) {
  const label = LABELS[view.kind]
  // Une autre page se charge : le contenu reste, atténué.
  const refreshing = view.status === 'chargement' && Boolean(view.data)
  const style = { '--depth': depth } as CSSProperties
  return (
    <article
      className={`holo-panel holo-panel--${view.status}${depth ? ' holo-panel--back' : ''}${WIDE.has(view.kind) ? ' holo-panel--wide' : ''}${mini ? ' holo-panel--mini' : ''}`}
      style={style}
      aria-hidden={depth > 0 || mini}
    >
      <span className="holo-corner holo-corner--tl" aria-hidden="true" />
      <span className="holo-corner holo-corner--tr" aria-hidden="true" />
      <span className="holo-corner holo-corner--bl" aria-hidden="true" />
      <span className="holo-corner holo-corner--br" aria-hidden="true" />
      {view.status === 'chargement' && <span className="holo-scan" aria-hidden="true" />}
      <header className="holo-head">
        <span className="holo-kicker">
          <span className="holo-pulse" aria-hidden="true" />
          {view.status === 'chargement'
            ? (view.kind === 'donnees' || view.kind === 'connecteur' || view.kind === 'schema') && view.title.includes(' · ')
              ? `INTERROGATION DE ${view.title.split(' · ')[0]!.toUpperCase()}`
              : label.loading
            : view.status === 'erreur'
              ? 'ÉCHEC'
              : readyLabel(view)}
        </span>
        {!(view.data && OWN_TITLE.has(view.data.kind)) && (
          <h3 className="holo-title">
            {view.data && 'chemin' in view.data ? view.data.chemin : view.data && 'titre' in view.data ? view.data.titre : view.title}
          </h3>
        )}
      </header>
      <div className={`holo-body${refreshing ? ' holo-body--refresh' : ''}`} aria-busy={view.status === 'chargement'}>
        {view.status === 'chargement' && !view.data && <Skeleton kind={view.kind} />}
        {view.status === 'erreur' && <p className="holo-error">{view.message ?? 'Accès impossible.'}</p>}
        {view.status !== 'erreur' && view.data && (
          <Panel.Provider value={{ id: view.id, turnId: view.turnId, loading: refreshing, front: depth === 0 && !mini }}>
            <ViewBoundary kind={view.kind}>{(RENDERERS[view.data.kind] as (d: UiData) => ReactNode)(view.data)}</ViewBoundary>
          </Panel.Provider>
        )}
      </div>
    </article>
  )
}

// ── Petits éléments communs ──────────────────────────────────────────────

function Counter({ value, label }: { value: number; label: string }) {
  const n = useCountUp(value)
  return (
    <div className="holo-counter">
      <span className="holo-counter__value">{n}</span>
      <span className="holo-counter__label">{label}</span>
    </div>
  )
}

const TYPE_TONE: Record<string, string> = {
  pdf: 'rouge',
  doc: 'bleu', docx: 'bleu', pages: 'bleu', rtf: 'bleu', txt: 'bleu', md: 'bleu',
  xls: 'vert', xlsx: 'vert', csv: 'vert', numbers: 'vert',
  ppt: 'ambre', pptx: 'ambre', key: 'ambre',
  jpg: 'violet', jpeg: 'violet', png: 'violet', gif: 'violet', webp: 'violet', heic: 'violet', svg: 'violet',
  mp4: 'violet', mov: 'violet', mp3: 'violet', m4a: 'violet', wav: 'violet',
  zip: 'gris', rar: 'gris', dmg: 'gris'
}

function Glyph({ item }: { item: Pick<UiItem, 'type' | 'ext'> }) {
  if (item.type === 'dossier') {
    return (
      <svg className="holo-glyph" viewBox="0 0 32 26" aria-hidden="true">
        <path d="M2 5.5a2 2 0 0 1 2-2h7l3 3h14a2 2 0 0 1 2 2V22a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" />
        <path d="M2 10h28" />
      </svg>
    )
  }
  return (
    <span className={`holo-ext holo-ext--${TYPE_TONE[item.ext ?? ''] ?? 'neutre'}`} aria-hidden="true">
      {(item.ext || '—').slice(0, 4).toUpperCase()}
    </span>
  )
}

function Skeleton({ kind }: { kind: UiKind }) {
  const n = kind === 'dossier' ? 12 : kind === 'recherche' || kind === 'donnees' ? 6 : 4
  return (
    <div className={`holo-skeleton holo-skeleton--${kind}`} aria-label="Chargement">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="holo-ghost" style={{ '--i': i } as CSSProperties} />
      ))}
    </div>
  )
}

// ── Rendus par type ──────────────────────────────────────────────────────

function FolderView({ data }: { data: Extract<UiData, { kind: 'dossier' }> }) {
  const { act } = useContext(Api)
  const parent = parentOf(data.chemin)
  return (
    <>
      <div className="holo-counters">
        <Counter value={data.dossiers} label={data.dossiers > 1 ? 'DOSSIERS' : 'DOSSIER'} />
        <Counter value={data.fichiers} label={data.fichiers > 1 ? 'FICHIERS' : 'FICHIER'} />
        <span className="holo-actions">
          {parent && (
            <button type="button" className="holo-action" onClick={() => act('parcourir', parent)}>
              ↑ Dossier parent
            </button>
          )}
          <button type="button" className="holo-action" onClick={() => act('finder', data.chemin)}>
            Finder
          </button>
        </span>
      </div>
      <ul className="holo-grid">
        {data.items.map((it, i) => (
          <li key={it.chemin} style={{ '--i': Math.min(i, 40) } as CSSProperties} className="holo-cell">
            <button
              type="button"
              className={`holo-tile holo-tile--${it.type}`}
              onClick={() => act(it.type === 'dossier' ? 'parcourir' : 'afficher', it.chemin)}
              aria-label={`${it.type === 'dossier' ? 'Ouvrir le dossier' : 'Afficher'} ${it.nom}`}
            >
              <Glyph item={it} />
              <span className="holo-tile__name" title={it.nom}>
                {it.nom}
              </span>
              <span className="holo-tile__meta">
                {it.detail}
                {it.date ? ` · ${it.date}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {data.items.length === 0 && <p className="holo-empty">Dossier vide.</p>}
      {data.autres > 0 && <p className="holo-more">+ {data.autres} autres éléments</p>}
    </>
  )
}

function SearchView({ data }: { data: Extract<UiData, { kind: 'recherche' }> }) {
  const { act } = useContext(Api)
  return (
    <>
      <div className="holo-counters">
        <Counter value={data.total} label={data.total > 1 ? 'RÉSULTATS' : 'RÉSULTAT'} />
      </div>
      {data.items.length === 0 ? (
        <p className="holo-empty">Aucun élément trouvé.</p>
      ) : (
        <ol className="holo-list">
          {data.items.map((it, i) => (
            <li key={it.chemin} style={{ '--i': i } as CSSProperties} className="holo-cell">
              <button type="button" className="holo-row" onClick={() => act(it.type === 'dossier' ? 'parcourir' : 'afficher', it.chemin)}>
              <span className="holo-row__rank">{String(i + 1).padStart(2, '0')}</span>
              <Glyph item={it} />
              <span className="holo-row__text">
                <span className="holo-row__name">{it.nom}</span>
                <span className="holo-row__path">{it.chemin}</span>
              </span>
              <span className="holo-row__meta">
                {it.detail}
                <br />
                {it.date}
              </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

function InfoView({ data }: { data: Extract<UiData, { kind: 'infos' }> }) {
  return (
    <>
      <div className="holo-info-head">
        <Glyph item={{ type: data.type, ext: data.nom.split('.').pop()?.toLowerCase() }} />
        <span className="holo-info-name">{data.nom}</span>
      </div>
      <dl className="holo-facts">
        {data.lignes.map((l, i) => (
          <div key={l.label} className="holo-fact" style={{ '--i': i } as CSSProperties}>
            <dt>{l.label}</dt>
            <dd>{l.valeur}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

function DocumentView({ data }: { data: Extract<UiData, { kind: 'document' }> }) {
  const { act, url } = useContext(Api)
  const [failed, setFailed] = useState(false)
  const onError = useCallback(() => setFailed(true), [])
  const src = data.url ? url(data.url) : null
  const parent = parentOf(data.chemin)
  let body: ReactNode
  const needsUrl = data.media === 'pdf' || data.media === 'image' || data.media === 'video' || data.media === 'audio'
  if (failed || data.media === 'autre' || (needsUrl && !src)) {
    body = (
      <div className="holo-sheet holo-sheet--fiche">
        <span className={`holo-ext holo-ext--${TYPE_TONE[data.ext] ?? 'neutre'}`}>{(data.ext || 'FICHIER').toUpperCase()}</span>
        <p className="holo-sheet__text">{failed ? 'Aperçu impossible pour ce fichier.' : 'Pas d’aperçu pour ce format.'} Vous pouvez l’ouvrir sur le Mac.</p>
      </div>
    )
  } else if (data.media === 'pdf') {
    body = <PdfViewer url={src!} onError={onError} />
  } else if (data.media === 'image') {
    body = (
      <figure className="holo-figure">
        <img className="holo-media holo-media--image" src={src!} alt={data.nom} onError={onError} />
        {data.apercu && <figcaption className="holo-more">{data.apercu === 'quicklook' ? 'Aperçu de la première page. Ouvrez le fichier sur le Mac pour le reste.' : 'Image convertie pour l’aperçu.'}</figcaption>}
      </figure>
    )
  } else if (data.media === 'markdown') {
    body = <MarkdownReader text={data.texte ?? ''} />
  } else if (data.media === 'code') {
    body = <CodeReader text={data.texte ?? ''} lang={data.ext} />
  } else if (data.media === 'tableau' && data.tableau) {
    body = <SheetReader tableau={data.tableau} />
  } else if (data.media === 'page' && data.html) {
    body = <PageReader html={data.html} title={data.nom} />
  } else if (data.media === 'video') {
    body = <video className="holo-media" src={src!} controls playsInline onError={onError} />
  } else if (data.media === 'audio') {
    body = (
      <div className="holo-audio">
        <span className={`holo-ext holo-ext--violet`}>{data.ext.toUpperCase()}</span>
        <audio src={src!} controls onError={onError} />
      </div>
    )
  } else {
    body = <TextReader text={data.texte ?? ''} />
  }
  return (
    <div className="holo-doc">
      <div className="holo-doc__bar">
        <span className="holo-doc__meta">
          {data.taille} · {data.date}
        </span>
        <span className="holo-actions">
          {parent && (
            <button type="button" className="holo-action" onClick={() => act('parcourir', parent)}>
              ↑ Dossier
            </button>
          )}
          <button type="button" className="holo-action" onClick={() => act('finder', data.chemin)}>
            Finder
          </button>
          <button type="button" className="holo-action holo-action--main" onClick={() => act('ouvrir_mac', data.chemin)}>
            Ouvrir sur le Mac
          </button>
        </span>
      </div>
      {body}
      {data.tronque && <p className="holo-more">Document long : seul le début est affiché. Ouvrez-le sur le Mac pour la suite.</p>}
    </div>
  )
}

/** Un chiffre « 42 » s'anime ; un texte (« 12,5 % », « actif ») s'affiche tel quel. */
function Figure({ label, valeur }: { label: string; valeur: string }) {
  const numeric = /^-?\d+$/.test(valeur)
  const n = useCountUp(numeric ? Number(valeur) : 0)
  return (
    <div className={`holo-counter${!numeric && valeur.length > 10 ? ' holo-counter--text' : ''}`}>
      <span className="holo-counter__value">{numeric ? n : valeur}</span>
      <span className="holo-counter__label">{label.toUpperCase()}</span>
    </div>
  )
}

const ROWS_PER_PAGE = 15

function DataView({ data }: { data: Extract<UiData, { kind: 'donnees' }> }) {
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(data.lignes.length / ROWS_PER_PAGE))
  const rows = data.lignes.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)
  return (
    <>
      {(data.chiffres.length > 0 || data.total > 0) && (
        <div className="holo-counters holo-counters--wrap">
          {data.lignes.length > 0 && <Figure label={data.total > 1 ? 'résultats' : 'résultat'} valeur={String(data.total)} />}
          {data.chiffres.map((c) => (
            <Figure key={c.label} label={c.label} valeur={c.valeur} />
          ))}
        </div>
      )}
      {data.lignes.length > 0 ? (
        <div className="holo-table-wrap">
          <table className="holo-table">
            <thead>
              <tr>
                {data.colonnes.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${page}-${i}`} style={{ '--i': Math.min(i, 30) } as CSSProperties}>
                  {row.map((v, j) => (
                    <td key={j}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        data.chiffres.length === 0 && <p className="holo-empty">Aucune donnée.</p>
      )}
      <Pager pager={{ page, pages, total: data.lignes.length, parPage: ROWS_PER_PAGE }} onGo={setPage} />
      {data.total > data.lignes.length && <p className="holo-more">Les {data.lignes.length} premiers sur {data.total}.</p>}
    </>
  )
}
