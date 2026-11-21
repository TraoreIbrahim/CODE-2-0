import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { Code } from '../hooks.ts'
import { Orb, type OrbMode } from '../Orb.tsx'
import { paletteOf } from '../palette.ts'
import { FOURNISSEUR_INFOS, PROFIL_NOMS } from '@code/protocol'
import { AppellationField, ConnecteursField, HabitudesField, LieuField, RegistreField, OrbeField, ThemeField, ThemePreview, VoicePrintField, VoixField, registre } from './fields.tsx'
import { MoteursField } from './moteurs.tsx'
import { VoixServicesField } from './voix-services.tsx'
import { ClesField, IdentifiantsField, NomAssistantField, NomPersonneField, ProfilField, nomDe } from './comptes.tsx'

/**
 * Assistant de premier lancement : une étape à la fois, l'orbe à gauche dans son orbite d'étapes, la question à droite. Chaque choix s'applique aussitôt, partout
 * (le thème recolore l'écran, la voix se fait entendre) ; à la fin, l'assistant se présente à voix haute, sous le nom qu'on lui a donné.
 */

type StepId = 'assistant' | 'appellation' | 'lieu' | 'cles' | 'moteurs' | 'theme' | 'voix' | 'empreinte' | 'compte' | 'connecteurs' | 'habitudes' | 'recap' | 'presentation'

/**
 * Les étapes, jusqu'au récapitulatif. `nom` : dans le bouton « Étape suivante ». `passable` : « Plus tard » tant qu'elle n'est pas faite. Les clés passent
 * avant la voix (sans clé de synthèse, pas de voix à écouter). `compte` : le propriétaire seulement (un
 * compte invité a choisi son mot de passe en se créant).
 */
const STEPS: { id: StepId; code: string; nom: string; passable?: boolean }[] = [
  { id: 'assistant', code: 'NOM', nom: 'nom' },
  { id: 'appellation', code: 'APPELLATION', nom: 'appellation' },
  { id: 'lieu', code: 'LIEU', nom: 'lieu' },
  { id: 'cles', code: 'CLÉS API', nom: 'clés API', passable: true },
  { id: 'moteurs', code: 'MOTEURS', nom: 'moteurs' },
  { id: 'theme', code: 'THÈME', nom: 'thème' },
  { id: 'voix', code: 'VOIX', nom: 'voix' },
  { id: 'empreinte', code: 'EMPREINTE', nom: 'empreinte', passable: true },
  { id: 'compte', code: 'CONNEXION', nom: 'connexion', passable: true },
  {
    id: 'connecteurs',
    code: 'CONNECTEURS',
    nom: 'connecteurs',
    passable: true
  },
  { id: 'habitudes', code: 'HABITUDES', nom: 'habitudes' },
  { id: 'recap', code: 'RÉCAPITULATIF', nom: 'récapitulatif' }
]

type Props = {
  code: Code
  device: 'mac' | 'mobile'
  /** Notifications et association du téléphone : propres à l'appareil (abonnement sur le téléphone, QR sur le Mac). */
  phone?: ReactNode
  /** L'assistant se ferme (fini ici, fini sur un autre appareil, ou passé). */
  onDone: () => void
}

/**
 * Montre l'assistant tant que l'utilisateur n'a pas fini (ou passé) : une fois ouvert, il reste affiché
 * jusqu'à ce qu'il se ferme lui-même, le temps que CODE se présente.
 */
export function useOnboarding(code: Code | null): [boolean, () => void] {
  const configure = code?.state.utilisateur?.configure
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (configure === false) setOpen(true)
  }, [configure])
  return [open, () => setOpen(false)]
}

/**
 * L'orbite autour de l'orbe : une étoile par étape, en ellipse vue de biais. Les étapes faites s'allument
 * et laissent un sillage, la courante brille en contrepoint avec son nom. La moitié basse passe devant l'orbe.
 */
function Orbite({ index, total, largeur, orbe, etiquette, children }: { index: number; total: number; largeur: number; orbe: number; etiquette?: string; children: ReactNode }) {
  const clip = useId()
  const rx = largeur / 2 - 14
  const ry = rx * 0.3
  const hauteur = Math.max(orbe, ry * 2) + 48
  const cx = largeur / 2
  const cy = hauteur / 2
  // La première étape est devant, en bas ; on tourne vers la gauche, puis on passe derrière l'orbe.
  const angle = (i: number) => ((90 + (i * 360) / total) * Math.PI) / 180
  const pt = (a: number) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as const
  const fin = angle(Math.min(index, total))
  const sillage = Array.from({ length: 73 }, (_, k) => pt(angle(0) + ((fin - angle(0)) * k) / 72))
    .map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join('')
  const etoiles = Array.from({ length: total }, (_, i) => {
    const a = angle(i)
    const [x, y] = pt(a)
    // Plus grosses devant, plus petites au fond : la profondeur.
    const r = i === index ? 8 : 2.5 + 1.75 * (Math.sin(a) + 1)
    return {
      i,
      x,
      y,
      r,
      cls: i < index ? 'is-faite' : i === index ? 'is-courante' : ''
    }
  })
  const courante = etoiles[index]
  // Le nom de l'étape se pose hors de l'orbe : dessous devant, dessus au fond, sur le côté ailleurs.
  const place = (() => {
    if (!courante) return null
    const a = angle(index)
    if (Math.sin(a) > 0.5) return { x: courante.x, y: courante.y + 30, ancre: 'middle' as const }
    if (Math.sin(a) < -0.5) return { x: courante.x, y: courante.y - 18, ancre: 'middle' as const }
    return Math.cos(a) < 0 ? { x: courante.x - 16, y: courante.y + 4, ancre: 'end' as const } : { x: courante.x + 16, y: courante.y + 4, ancre: 'start' as const }
  })()
  const calque = (devant: boolean) => (
    <svg className="ob-orbite" width={largeur} height={hauteur} viewBox={`0 0 ${largeur} ${hauteur}`} aria-hidden="true">
      <clipPath id={`${clip}${devant ? 'd' : 'a'}`}>
        <rect x={-20} y={devant ? cy : -20} width={largeur + 40} height={devant ? hauteur - cy + 20 : cy + 20} />
      </clipPath>
      <g clipPath={`url(#${clip}${devant ? 'd' : 'a'})`}>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />
        {index > 0 && <path className="ob-orbite__sillage" d={sillage} />}
        {etoiles.map((e) => (
          <circle key={e.i} cx={e.x} cy={e.y} r={e.r} className={e.cls} />
        ))}
      </g>
      {devant && place && etiquette && (
        <text x={place.x} y={place.y} textAnchor={place.ancre} className="ob-orbite__nom">
          {etiquette}
        </text>
      )}
    </svg>
  )
  return (
    <div className="ob-ciel" style={{ width: largeur, height: hauteur }}>
      {calque(false)}
      <div className="ob-ciel__orbe">{children}</div>
      {calque(true)}
    </div>
  )
}

export function Onboarding({ code, device, phone, onDone }: Props) {
  const { state, status, voice, client } = code
  const u = state.utilisateur
  const t = registre(u)
  const [step, setStep] = useState<StepId>('assistant')
  const finishedHere = useRef(false)
  /** La dernière réponse avant la présentation : seule la phrase qui suit est affichée. */
  const [introAfter, setIntroAfter] = useState<string | null>(null)
  const compact = useCompact()

  useEffect(() => client.requestReglages(), [client])
  // Fini (ou passé) sur un autre appareil : l'assistant se ferme ici aussi.
  useEffect(() => {
    if (u?.configure && !finishedHere.current) onDone()
  }, [u?.configure, onDone])

  if (!u) return null
  const steps = STEPS.filter((s) => s.id !== 'compte' || u.proprietaire)
  const total = steps.length
  const nom = nomDe(code)
  /** Rang de l'étape ; la présentation vient après la dernière. */
  const pos = step === 'presentation' ? total : steps.findIndex((s) => s.id === step)
  const current = steps[pos]
  const go = (delta: number) => {
    const next = steps[pos + delta]
    if (next) setStep(next.id)
  }
  const finish = () => {
    finishedHere.current = true
    setIntroAfter(state.replyTurnId ?? '')
    client.finishAssistant(true)
    setStep('presentation')
  }
  const skipAll = () => {
    finishedHere.current = true
    client.finishAssistant(false)
    onDone()
  }

  // L'orbe vit avec ce qui se passe : elle parle avec les extraits de voix, écoute pendant l'empreinte.
  const orbMode: OrbMode = status.playing ? 'parole' : state.enroll ? 'ecoute' : state.connection !== 'connecte' ? 'injoignable' : 'repos'
  const orbSize = compact ? (step === 'presentation' ? 200 : 112) : step === 'presentation' ? 340 : 300
  const orbite = compact ? 300 : 600

  const { title, lead, body } = content(step, code, device, phone, t, setStep, introAfter)
  const prenom = u.prenom || u.appellation

  const suivante = steps[pos + 1]
  const plusTard = !!current?.passable && !doneFor(step, code)
  const fleche = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )

  return (
    <div className={`ob ob--${device} ob--${step}`} role="dialog" aria-modal="true" aria-label={`Premier lancement de ${nom}`}>
      <div className="ob__etoiles" aria-hidden="true" />
      <header className="ob__top">
        <span className="ob__nom">{nom}</span>
        {step !== 'presentation' && (
          <button type="button" className="ob__skip" onClick={skipAll}>
            Passer
          </button>
        )}
      </header>

      <div className="ob__ciel">
        <Orbite index={pos} total={total} largeur={orbite} orbe={orbSize} etiquette={current && `${current.code} · ${pos + 1}/${total}`}>
          <Orb mode={orbMode} size={orbSize} level={voice.level} label={nom} />
        </Orbite>
        {lead && !compact && <p className="ob__dit">« {lead} »</p>}
      </div>

      <div className="ob__colonne">
        <section className="ob__panel" key={step} aria-live="polite">
          {title && <h1 className="ob__title">{title}</h1>}
          {lead && compact && <p className="ob__lead">{lead}</p>}
          <div className="ob__body">{body}</div>
        </section>

        <footer className="ob__nav">
          {step === 'presentation' ? (
            <button type="button" className="ob__next" onClick={onDone}>
              <span>{t('Commencer', `C’est parti, ${prenom}`)}</span>
              {fleche}
            </button>
          ) : (
            <>
              <button type="button" className="ob__back" onClick={() => go(-1)} disabled={pos <= 0} aria-label="Étape précédente">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 12H5M11 6l-6 6 6 6" />
                </svg>
              </button>
              {step === 'recap' ? (
                <button type="button" className="ob__next" onClick={finish} disabled={state.connection !== 'connecte'}>
                  <span>Activer {nom}</span>
                  {fleche}
                </button>
              ) : (
                <button type="button" className={`ob__next${plusTard ? ' ob__next--soft' : ''}`} onClick={() => go(1)} disabled={!!state.enroll}>
                  <span>
                    {plusTard ? 'Plus tard' : 'Étape suivante'}
                    {suivante && <> : {suivante.nom}</>}
                  </span>
                  {fleche}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

/** Une étape passable est-elle faite (clé du moteur, voix enregistrée, mot de passe, Google) ? Sinon le bouton dit « Plus tard ». */
function doneFor(step: StepId, code: Code): boolean {
  if (step === 'cles') return !!code.state.cles?.some((c) => c.source && Object.values(FOURNISSEUR_INFOS).some((f) => f.cle === c.nom))
  if (step === 'compte') return !!code.state.utilisateur?.identifiant
  if (step === 'empreinte') return code.state.speaker.enrolled
  if (step === 'connecteurs') return code.state.google.etat === 'connecte'
  return true
}

/** Téléphone ou fenêtre étroite : l'orbe se fait plus petite, le contenu passe dessous. */
function useCompact(): boolean {
  const query = '(max-width: 720px), (max-height: 640px)'
  const [compact, setCompact] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const on = () => setCompact(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return compact
}

type T = ReturnType<typeof registre>

/** Titre (CODE parle, au registre choisi), phrase d'accompagnement et contenu de chaque étape. */
function content(step: StepId, code: Code, device: 'mac' | 'mobile', phone: ReactNode, t: T, setStep: (s: StepId) => void, introAfter: string | null): { title: string; lead?: string; body: ReactNode } {
  const u = code.state.utilisateur!
  const r = u.reglages
  const nom = nomDe(code)
  switch (step) {
    case 'assistant':
      return {
        title: 'Comment vais-je m’appeler ?',
        lead: 'Ce nom sera aussi le mot qui m’appelle. Puis, ce pour quoi vous m’utiliserez surtout.',
        body: (
          <>
            <NomAssistantField code={code} />
            <ProfilField code={code} />
          </>
        )
      }
    case 'appellation':
      return {
        title: t('Comment dois-je vous appeler ?', 'Comment dois-je t’appeler ?'),
        lead: t(`Votre prénom, puis sur quel ton : ${nom} peut vous vouvoyer ou vous tutoyer.`, `Ton prénom, puis sur quel ton : ${nom} peut te vouvoyer ou te tutoyer.`),
        body: (
          <>
            <NomPersonneField code={code} />
            <AppellationField code={code} />
            <RegistreField code={code} />
          </>
        )
      }
    case 'lieu':
      return {
        title: t('Où êtes-vous ?', 'Où es-tu ?'),
        lead: t('Pour la météo, les itinéraires et l’heure de vos rappels.', 'Pour la météo, les itinéraires et l’heure de tes rappels.'),
        body: <LieuField code={code} />
      }
    case 'cles':
      return {
        title: t('Vos clés API', 'Tes clés API'),
        lead: 'Chacun utilise les siennes : elles restent chiffrées sur le serveur et ne s’affichent jamais.',
        body: <ClesField code={code} />
      }
    case 'moteurs':
      return {
        title: 'Avec quel moteur dois-je penser ?',
        lead: t(
          'Un modèle par usage, parmi ceux dont vous avez la clé. « Tester » vérifie qu’il sait se servir de mes outils.',
          'Un modèle par usage, parmi ceux dont tu as la clé. « Tester » vérifie qu’il sait se servir de mes outils.'
        ),
        body: <MoteursField code={code} variante="lignes" />
      }
    case 'compte':
      return {
        title: t('Votre connexion', 'Ta connexion'),
        lead: t('Un identifiant et un mot de passe, pour vous connecter depuis un autre appareil.', 'Un identifiant et un mot de passe, pour te connecter depuis un autre appareil.'),
        body: <IdentifiantsField code={code} />
      }
    case 'theme':
      return {
        title: t('Quelle couleur, quelle orbe vous ressemblent ?', 'Quelle couleur, quelle orbe te ressemblent ?'),
        lead: t('Elle habille l’orbe, le logo et toutes les interfaces, sur chacun de vos appareils.', 'Elle habille l’orbe, le logo et toutes les interfaces, sur chacun de tes appareils.'),
        body: (
          <>
            <ThemeField code={code} />
            <OrbeField code={code} />
            <ThemePreview theme={r.theme} nom={nomDe(code)} />
          </>
        )
      }
    case 'voix':
      return {
        title: t('Avec quelle voix dois-je vous parler ?', 'Avec quelle voix dois-je te parler ?'),
        lead: t('Touchez une voix pour l’entendre, puis réglez la vitesse.', 'Touche une voix pour l’entendre, puis règle la vitesse.'),
        body: (
          <>
            <VoixField code={code} />
            <VoixServicesField code={code} variante="resume" />
          </>
        )
      }
    case 'empreinte':
      return {
        title: t('Laissez-moi reconnaître votre voix', 'Laisse-moi reconnaître ta voix'),
        lead: t('Une seule fois suffit. Vous pourrez aussi le faire plus tard, dans les Réglages.', 'Une seule fois suffit. Tu pourras aussi le faire plus tard, dans les Réglages.'),
        body: <VoicePrintField code={code} />
      }
    case 'connecteurs':
      return {
        title: t('Vos comptes', 'Tes comptes'),
        lead: t('Google ouvre vos mails, votre agenda et votre Drive.', 'Google ouvre tes mails, ton agenda et ton Drive.'),
        body: <ConnecteursField code={code} device={device} />
      }
    case 'habitudes':
      return {
        title: t('Vos habitudes', 'Tes habitudes'),
        lead: `Quand ${nom} prend la parole de lui-même, et quand il se tait.`,
        body: <HabitudesField code={code} phone={phone} />
      }
    case 'recap':
      return {
        title: 'Tout est prêt',
        lead: t(`Vérifiez, puis activez : ${nom} va se présenter.`, `Vérifie, puis active : ${nom} va se présenter.`),
        body: <Recap code={code} edit={setStep} />
      }
    case 'presentation':
      return {
        title: '',
        body: <Presentation code={code} after={introAfter} />
      }
  }
}

/** Le récapitulatif : chaque choix sur une ligne, modifiable d'un geste. */
function Recap({ code, edit }: { code: Code; edit: (s: StepId) => void }) {
  const { state } = code
  const u = state.utilisateur!
  const r = u.reglages
  const voix = state.voixChoix.find((v) => v.id === r.voix)?.nom ?? 'Voix par défaut'
  const p = paletteOf(r.theme)
  const retour = r.retourApresMinutes < 60 ? `${r.retourApresMinutes} min` : `${r.retourApresMinutes / 60} h`.replace('.', ',')
  const cles = (state.cles ?? []).filter((c) => c.source).length
  const rows: { k: string; v: ReactNode; step: StepId }[] = [
    {
      k: 'Assistant',
      v: `${nomDe(code)} · ${PROFIL_NOMS[r.profil].nom}`,
      step: 'assistant'
    },
    {
      k: 'Appellation',
      v: `${u.appellation} · ${r.tutoiement ? 'tutoiement' : 'vouvoiement'}`,
      step: 'appellation'
    },
    { k: 'Ville', v: r.ville, step: 'lieu' },
    {
      k: 'Clés API',
      v: cles ? `${cles} enregistrée${cles > 1 ? 's' : ''}` : 'Aucune',
      step: 'cles'
    },
    {
      k: 'Moteur',
      v: `${FOURNISSEUR_INFOS[r.moteurs.principal.fournisseur].nom.replace(/ \(.*\)$/, '')} · ${r.moteurs.principal.modele}`,
      step: 'moteurs'
    },
    {
      k: 'Thème',
      v: (
        <>
          <i className="ob-recap__swatch" style={{ background: p.accent }} />
          {p.nom}
        </>
      ),
      step: 'theme'
    },
    {
      k: 'Voix',
      v: `${voix} · ×${r.vitesseVoix.toFixed(2).replace(/0$/, '').replace('.', ',')}`,
      step: 'voix'
    },
    {
      k: 'Empreinte',
      v: state.speaker.enrolled ? 'Enregistrée' : 'Plus tard',
      step: 'empreinte'
    },
    {
      k: 'Google',
      v: state.google.etat === 'connecte' ? 'Connecté' : 'Plus tard',
      step: 'connecteurs'
    },
    {
      k: 'Briefing',
      v: `${r.briefing.replace(':', ' h ')} · point du retour après ${retour}`,
      step: 'habitudes'
    },
    {
      k: 'Silence',
      v: r.silence ? `${r.silence.de} → ${r.silence.a}` : 'Aucun',
      step: 'habitudes'
    },
    {
      k: 'Notifications',
      v: r.notifications ? 'Oui' : 'Non',
      step: 'habitudes'
    }
  ]
  return (
    <dl className="ob-recap">
      {rows.map((row, i) => (
        <div key={row.k} className="ob-recap__row" style={{ animationDelay: `${i * 60}ms` }}>
          <dt className="code-mono">{row.k}</dt>
          <dd>{row.v}</dd>
          <button type="button" className="rg-link" onClick={() => edit(row.step)} aria-label={`Modifier : ${row.k}`}>
            Modifier
          </button>
        </div>
      ))}
    </dl>
  )
}

/** CODE se présente : sa phrase s'écrit pendant qu'il la dit. */
function Presentation({ code, after }: { code: Code; after: string | null }) {
  const said = code.state.replyTurnId !== after ? code.state.reply : ''
  return (
    <div className="ob-intro">
      <p className="ob-intro__said">
        {said || '…'}
        <span className="code-caret" aria-hidden="true" />
      </p>
      {!code.state.synthese && <p className="rg-note">Pas encore de voix (clé ElevenLabs, OpenAI, Deepgram ou Gemini) : {nomDe(code)} se présente par écrit.</p>}
    </div>
  )
}
