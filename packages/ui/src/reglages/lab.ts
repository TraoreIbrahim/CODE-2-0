import { useEffect, useMemo, useRef, useState } from 'react'
import { cartesDuProfil, memesCartes, type FournisseurId, type Reglages, type ServiceConnecteur, type UiEcheancier, type UiMeteo, type UsageTotals, type VoixBibliotheque, type VoixRecherche, type WidgetPlace } from '@code/protocol'
import type { ClientState } from '../client.ts'
import type { Code } from '../hooks.ts'
import { SAMPLES } from '../holo/samples.ts'
import { applyOrbe, applyTheme } from '../palette.ts'
import { FUSEAUX } from './fields.tsx'

/**
 * Atelier (développement seulement) : un faux client pour l'assistant et les Réglages, sans serveur.
 * Les choix s'appliquent comme en vrai (thème, voix, habitudes) ; une voix « parle » quelques secondes.
 */

const totals = (cout: number, appels: number): UsageTotals => ({ cout, appels, entree: appels * 9000, sortie: appels * 400, cacheLecture: appels * 30000, cacheEcriture: appels * 2000 })

export function useLabCode(opts: { configure?: boolean; device?: 'mac' | 'mobile' } = {}): Code {
  const [state, setState] = useState<ClientState>(() => initial(opts.configure ?? false))
  const [playing, setPlaying] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const patch = (p: Partial<ClientState>) => setState((s) => ({ ...s, ...p }))
  const setReglages = (r: Partial<Reglages>) =>
    setState((s) => {
      if (!s.utilisateur) return s
      const avant = s.utilisateur.reglages
      // Comme le serveur : un autre profil apporte ses cartes, sauf si elles ont été rangées à la main.
      const cartes = r.profil && r.profil !== avant.profil && !r.widgets && memesCartes(avant.widgets, cartesDuProfil(avant.profil)) ? { widgets: cartesDuProfil(r.profil) } : {}
      return { ...s, utilisateur: { ...s.utilisateur, appellation: r.appellation ?? s.utilisateur.appellation, reglages: { ...avant, ...r, ...cartes } } }
    })
  const speak = () => {
    clearTimeout(timer.current)
    setPlaying(true)
    timer.current = setTimeout(() => setPlaying(false), 2600)
  }

  const client = useMemo(
    () =>
      sansEchec({
        requestReglages() {},
        refreshMeteo() {},
        // Boîte : une adresse @exemple.com est reliée après un court instant ; une autre demande ses serveurs.
        ajouterBoite(b: { libelle: string; email: string; imapHote?: string }) {
          patch({ boiteAjout: { busy: true } })
          setTimeout(() => {
            if (!b.email.endsWith('@exemple.com') && !b.imapHote) return patch({ boiteAjout: { busy: false, ok: false, manuel: true, message: 'Serveurs de cette adresse inconnus : indiquez-les (lecture IMAP, envoi SMTP).' } })
            setState((s) => ({ ...s, boiteAjout: { busy: false, ok: true, message: `${b.email} est reliée : lecture et envoi vérifiés.` }, boites: [...(s.boites ?? []), { id: Date.now(), libelle: b.libelle || 'Direction', email: b.email, fournisseur: b.imapHote ?? 'Exemple', imap: '', smtp: '', defaut: false }] }))
          }, 1200)
        },
        retirerBoite: (id: number) => setState((s) => ({ ...s, boites: (s.boites ?? []).filter((b) => b.id !== id) })),
        boiteParDefaut: (id: number) => setState((s) => ({ ...s, boites: (s.boites ?? []).map((b) => ({ ...b, defaut: b.id === id })) })),
        oublierAjoutBoite: () => patch({ boiteAjout: null }),
        // Connecteurs : un jeton relie après un court instant ; sans jeton, la page du service « s'ouvre ».
        // Réunion : un faux enregistrement (le témoin bouge), puis l'envoi et la transcription qui avancent.
        demarrerReunion() {
          patch({ reunion: { id: 14, source: 'micro', etat: 'enregistrement', titre: 'Réunion du 11 novembre, 14:30', debut: Date.now(), decoupes: 0, envoyes: 0, service: 'Groq Whisper', tarif: 0.04 } })
        },
        niveauReunion: () => 0.25 + 0.6 * Math.abs(Math.sin(Date.now() / 260) * Math.sin(Date.now() / 97)),
        arreterReunion() {
          setState((s) => (s.reunion ? { ...s, reunion: { ...s.reunion, etat: 'envoi', decoupes: 4, envoyes: 3 } } : s))
          const ligne = (transcrits: number, etat: 'transcription' | 'prete' = 'transcription') => ({ id: 14, titre: 'Réunion du 11 novembre, 14:30', quand: 'aujourd’hui à 14:30', duree: '8 min', etat, source: 'micro' as const, progression: { transcrits, recus: 4 } })
          setTimeout(() => patch({ reunion: null, reunions: [ligne(3)] }), 1500)
          setTimeout(() => patch({ reunions: [ligne(4, 'prete')] }), 4500)
        },
        annulerReunion: () => patch({ reunion: null }),
        repondreReunionProposee(oui: boolean) {
          patch({ reunionProposee: null })
          if (oui) client.demarrerReunion()
        },
        // Compétences : enregistrées après un court instant, comme par le serveur (nom en double refusé).
        requestCompetences() {},
        enregistrerCompetence(c: { id?: string; nom: string; description: string; corps: string }) {
          patch({ competenceAction: { busy: true } })
          setTimeout(() => {
            const id = labSlug(c.nom)
            setState((s) => {
              const liste = s.competences ?? []
              if (!c.id && liste.some((x) => x.id === id)) return { ...s, competenceAction: { busy: false, ok: false, message: `« ${c.nom} » existe déjà : modifiez-la, ou choisissez un autre nom.` } }
              const nouvelle = { id, nom: c.nom.trim(), description: c.description.trim(), corps: c.corps.trim(), modifieLe: Date.now() }
              const competences = [...liste.filter((x) => x.id !== c.id && x.id !== id), nouvelle].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
              return { ...s, competences, competenceAction: { busy: false, ok: true, message: `« ${nouvelle.nom} » est apprise.`, id } }
            })
          }, 600)
        },
        importerCompetence(texte: string, fichier: string) {
          const nom = texte.match(/^nom:\s*(.+)$/m)?.[1] ?? texte.match(/^#\s+(.+)$/m)?.[1] ?? fichier.replace(/\.\w+$/, '')
          const description = texte.match(/^description:\s*(.+)$/m)?.[1] ?? 'Importée d’un fichier.'
          client.enregistrerCompetence({ nom, description, corps: texte.replace(/^---[\s\S]*?---\n?/, '') })
        },
        supprimerCompetence: (id: string) => setState((s) => ({ ...s, competences: (s.competences ?? []).filter((c) => c.id !== id) })),
        oublierActionCompetence: () => patch({ competenceAction: null }),
        requestConnecteurs() {},
        ajouterConnecteur(c: { service: string; jeton?: string }) {
          patch({ connecteurAction: { service: c.service, busy: true } })
          setTimeout(() => {
            const nom = LAB_CATALOGUE.find((x) => x.id === c.service)?.nom ?? 'Serveur'
            const id = Date.now()
            if (!c.jeton) return setState((s) => ({ ...s, connecteurAction: { service: c.service, busy: false, ok: true, message: `Autorisez CODE 2.0 dans la page ${nom} qui s’ouvre.`, url: 'https://example.com' }, connecteurs: [...(s.connecteurs ?? []), { id, service: c.service, libelle: nom, url: '', etat: 'a_autoriser', outils: 0, actions: 0, message: 'Autorisation à donner' }] }))
            setState((s) => ({ ...s, connecteurAction: { service: c.service, busy: false, ok: true, message: `${nom} est relié : 6 outils.` }, connecteurs: [...(s.connecteurs ?? []), { id, service: c.service, libelle: nom, url: '', etat: 'connecte', outils: 6, actions: 0, message: '' }] }))
          }, 1000)
        },
        autoriserConnecteur: (id: number) => setState((s) => ({ ...s, connecteurs: (s.connecteurs ?? []).map((c) => (c.id === id ? { ...c, etat: 'connecte', outils: 12, actions: 4, message: '' } : c)) })),
        complementConnecteur: (id: number, service: string, jeton: string) =>
          setState((s) => ({ ...s, connecteurAction: { service, busy: false, ok: true, message: jeton ? 'Expo : jeton enregistré, Nova voit maintenant tous vos projets.' : 'Expo : jeton retiré.' }, connecteurs: (s.connecteurs ?? []).map((c) => (c.id === id ? { ...c, complement: Boolean(jeton) } : c)) })),
        retirerConnecteur: (id: number) => setState((s) => ({ ...s, connecteurs: (s.connecteurs ?? []).filter((c) => c.id !== id) })),
        oublierActionConnecteur: () => patch({ connecteurAction: null }),
        refreshPerso() {},
        uiPage() {},
        requestDevices() {},
        requestUsage() {},
        setReglages,
        sampleVoice: speak,
        // Bibliothèque : des voix fictives, filtrées comme le ferait ElevenLabs, après un court instant.
        chercherVoix(filtres: VoixRecherche) {
          setState((s) => ({ ...s, bibliotheque: { filtres, voix: (filtres.page ?? 0) > 0 ? (s.bibliotheque?.voix ?? []) : [], suite: false, chargement: true } }))
          setTimeout(() => {
            const q = (filtres.recherche ?? '').toLowerCase()
            const voix = LAB_BIBLIOTHEQUE.filter((v) => (!filtres.genre || v.etiquettes[0] === (filtres.genre === 'femme' ? 'Femme' : 'Homme')) && (!q || `${v.nom} ${v.description} ${v.etiquettes.join(' ')}`.toLowerCase().includes(q)))
            setState((s) => ({ ...s, bibliotheque: { filtres, voix: voix.map((v) => ({ ...v, ajoutee: s.voixChoix.some((c) => c.id === v.id) })), suite: false, chargement: false } }))
          }, 500)
        },
        ajouterVoix(v: { auteur: string; id: string; nom: string }) {
          patch({ voixAjout: { id: v.id, nom: v.nom, busy: true } })
          setTimeout(
            () =>
              setState((s) => ({
                ...s,
                voixAjout: { id: v.id, nom: v.nom, busy: false },
                voixChoix: [{ id: v.id, nom: v.nom, description: LAB_BIBLIOTHEQUE.find((b) => b.id === v.id)?.etiquettes.join(' · ') ?? '', source: 'compte' }, ...s.voixChoix],
                bibliotheque: s.bibliotheque && { ...s.bibliotheque, voix: s.bibliotheque.voix.map((b) => (b.id === v.id ? { ...b, ajoutee: true } : b)) },
                utilisateur: s.utilisateur && { ...s.utilisateur, reglages: { ...s.utilisateur.reglages, voix: v.id } }
              })),
            900
          )
        },
        finishAssistant(presentation: boolean) {
          setState((s) => ({ ...s, utilisateur: s.utilisateur && { ...s.utilisateur, configure: true } }))
          if (!presentation) return
          speak()
          setTimeout(() => patch({ reply: 'Bonjour Claire, je suis Aya. Touchez l’orbe ou parlez-moi quand vous voulez ; chaque matin à 7 h 30, je vous fais le point.', replyTurnId: 'presentation' }), 400)
        },
        revokeDevice: (id: number) => setState((s) => ({ ...s, appareils: (s.appareils ?? []).filter((d) => d.id !== id) })),
        connectGoogle: () => patch({ google: { ...GOOGLE_LAB, etat: 'connecte', gmail: true, agenda: true, drive: true, message: 'Connecté · expire dans 7 jours', email: 'claire.martin@gmail.com' } }),
        disconnectGoogle: () => patch({ google: { ...GOOGLE_LAB, etat: 'deconnecte', message: 'Google n’est pas connecté.' } }),
        // N'importe quels identifiants : Google les « reconnaît » après un court instant.
        relierGoogle() {
          patch({ googleIdentifiants: { busy: true } })
          setTimeout(() => patch({ googleIdentifiants: { busy: false, ok: true, message: 'Identifiants reconnus par Google. Vous pouvez connecter votre compte.' }, google: { ...GOOGLE_LAB, etat: 'deconnecte', identifiants: 'reglages', message: 'Google n’est pas connecté.' } }), 900)
        },
        oublierGoogleIdentifiants: () => patch({ googleIdentifiants: null }),
        // N'importe quels identifiants : la connexion réussit après un court instant.
        login() {
          patch({ auth: { busy: true, error: null } })
          setTimeout(() => setState((s) => ({ ...s, auth: { busy: false, error: null }, utilisateur: s.utilisateur })), 900)
        },
        logout() {},
        requestCles() {},
        setCle() {},
        requestMoteurs() {},
        // Modèles : la liste arrive après un court instant, avec des tarifs.
        requestModeles(f: FournisseurId) {
          setState((s) => ({ ...s, modeles: { ...s.modeles, [f]: { liste: [], busy: true } } }))
          setTimeout(() => setState((s) => ({ ...s, modeles: { ...s.modeles, [f]: { busy: false, liste: [{ id: 'gpt-5.5', prix: { entree: 5, sortie: 30 } }, { id: 'gpt-5.4-mini', prix: { entree: 0.75, sortie: 4.5 } }, { id: 'gpt-5.4-nano', prix: { entree: 0.2, sortie: 1.25 } }] } } })), 700)
        },
        // Banc : un scénario toutes les 700 ms, le web ignoré, puis le verdict.
        lancerBanc(fournisseur: FournisseurId, modele: string) {
          const le = Date.now()
          LAB_SCENARIOS.forEach((sc, i) =>
            setTimeout(() => {
              setState((s) => {
                const scenarios = [...(s.banc?.scenarios ?? []), sc.id === 'web' ? { ...sc, ok: false, ignore: true, detail: 'aucune recherche web sur ce serveur (clé Brave ou SearXNG)', ms: 0 } : { ...sc, ok: sc.id !== 'enchainement', ...(sc.id === 'enchainement' ? { detail: 'rappels_lister pas appelé' } : {}), ms: 1500 }]
                const fin = scenarios.length === LAB_SCENARIOS.length
                return { ...s, banc: { fournisseur, modele, etat: fin ? 'limite' : 'en_cours', scenarios, cout: 0.03, le } }
              })
            }, 700 * (i + 1))
          )
          patch({ banc: { fournisseur, modele, etat: 'en_cours', scenarios: [], cout: 0, le } })
        },
        // L'arrêt d'urgence et la reprise, pour voir le header dans les deux états.
        send: (m: { type: string }) => {
          if (m.type === 'halt' || m.type === 'resume') patch({ serverState: m.type === 'halt' ? 'arret' : 'veille' })
          return true
        }
      }) as unknown as Code['client'],
    []
  )
  const voice = useMemo(
    () =>
      ({
        level: () => (timer.current ? 0.3 + 0.5 * Math.abs(Math.sin(performance.now() / 120)) : -1),
        preview: async () => speak(),
        startEnrollment: async () => {
          let p = 0
          const step = () => {
            p = Math.min(100, p + 7)
            patch({ enroll: p < 100 ? { percentage: p } : null, ...(p >= 100 ? { speaker: { available: true, enrolled: true, enabled: true, appareils: ['mobile'] }, enrollMessage: { ok: true, text: 'Votre voix est enregistrée. Je n’écoute plus que vous.' } } : {}) })
            if (p < 100) setTimeout(step, 350)
          }
          step()
        },
        cancelEnrollment: async () => patch({ enroll: null }),
        // Comme le serveur : refusé sans empreinte vocale.
        setConversation: async (active: boolean) =>
          setState((s) =>
            !active
              ? { ...s, ecoute: { ...s.ecoute, conversation: null } }
              : s.speaker.enabled
                ? { ...s, ecoute: { ...s.ecoute, conversation: { connectionId: 'lab', appareil: opts.device ?? 'mac', silenceMs: 300_000 } } }
                : { ...s, error: 'Le mode conversation demande votre empreinte vocale, sinon je répondrais à toutes les voix de la pièce : enregistrez-la dans Réglages, « Votre voix ».' }
          )
      }) as unknown as Code['voice'],
    []
  )
  // Comme useCode : le thème et l'orbe choisis habillent aussitôt tout l'écran.
  const theme = state.utilisateur?.reglages.theme
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])
  const orbe = state.utilisateur?.reglages.orbe
  useEffect(() => {
    if (orbe) applyOrbe(orbe)
  }, [orbe])
  return { client, voice, state, status: { micOn: !!state.enroll, opening: false, playing, micError: null } }
}

/** La bibliothèque de voix de l'atelier : des voix fictives, sans extrait (rien n'est demandé à ElevenLabs). */
const LAB_BIBLIOTHEQUE: VoixBibliotheque[] = [
  { id: 'LabBiblioVoixCamille', auteur: 'labauteur01', nom: 'Camille – posée et claire', description: 'Une voix chaleureuse et nette, pour un assistant au quotidien.', etiquettes: ['Femme', 'Adulte', 'Calme', 'Conversation'], apercu: null, ajoutee: false, ajouts: 18400 },
  { id: 'LabBiblioVoixThomas1', auteur: 'labauteur02', nom: 'Thomas', description: 'Grave, rassurante, un léger sourire dans la voix.', etiquettes: ['Homme', 'Adulte', 'Grave', 'Conversation', 'Accent parisien'], apercu: null, ajoutee: false, ajouts: 9200 },
  { id: 'LabBiblioVoixMaeva01', auteur: 'labauteur03', nom: 'Maëva', description: 'Jeune et vive, idéale pour des réponses courtes.', etiquettes: ['Femme', 'Jeune', 'Énergique', 'Réseaux'], apercu: null, ajoutee: false, ajouts: 3100 },
  { id: 'LabBiblioVoixJulien1', auteur: 'labauteur04', nom: 'Julien – radio', description: 'Le ton d’un animateur de radio du matin.', etiquettes: ['Homme', 'Adulte', 'Assurée', 'Infos'], apercu: null, ajoutee: false, ajouts: 640 },
  { id: 'LabBiblioVoixAmina01', auteur: 'labauteur05', nom: 'Amina', description: 'Douce et posée, avec une belle diction.', etiquettes: ['Femme', 'Adulte', 'Douce', 'Narration', 'Accent ouest-africain'], apercu: null, ajoutee: false, ajouts: 1200 }
]

/** Les cartes du cockpit, comme la configuration par défaut. */
/** Paramètre de l'adresse du labo (`?google=guide`, `?heberge`, `?membre`). */
const param = (nom: string) => (typeof location !== 'undefined' ? new URLSearchParams(location.search).get(nom) : null)

/** Google dans le labo : client relié depuis les Réglages ; `?heberge` : serveur hébergé (client Web). */
const GOOGLE_LAB: ClientState['google'] = {
  etat: 'deconnecte',
  gmail: false,
  agenda: false,
  drive: false,
  message: 'Google n’est pas connecté.',
  identifiants: 'reglages',
  ...(param('heberge') !== null ? { mode: 'heberge' as const, retour: 'https://assistant.exemple.fr/google/retour' } : { mode: 'local' as const })
}

const LAB_WIDGETS: WidgetPlace[] = [
  { id: 'meteo', colonne: 'gauche', visible: true },
  { id: 'aujourdhui', colonne: 'gauche', visible: true },
  { id: 'rappels', colonne: 'gauche', visible: true },
  { id: 'echeances', colonne: 'droite', visible: true },
  { id: 'mails', colonne: 'droite', visible: true },
  { id: 'taches', colonne: 'droite', visible: true }
]

/** Le catalogue des connecteurs, comme le serveur l'envoie (sans les aides). */
const LAB_CATALOGUE: ServiceConnecteur[] = [
  { id: 'github', nom: 'GitHub', description: 'Dépôts, pull requests, issues, tests (Actions), commits.', acces: 'jeton' },
  { id: 'vercel', nom: 'Vercel', description: 'Projets, déploiements et leur état, journal de construction.', acces: 'jeton', aide: 'Jeton : Vercel › Account Settings › Tokens.', lien: 'https://vercel.com/account/tokens' },
  { id: 'figma', nom: 'Figma', description: 'Fichiers, pages et cadres, commentaires, projets d’équipe.', acces: 'jeton' },
  { id: 'expo', nom: 'Expo', description: 'Builds et soumissions EAS, mises à jour, projets.', acces: 'oauth', complement: { libelle: 'Jeton d’accès Expo (facultatif)', aide: 'La connexion donne les builds, mises à jour et soumissions d’un projet ; le jeton permet en plus à l’assistant de lister tous vos projets. Expo › Account settings › Access tokens.', lien: 'https://expo.dev/settings/access-tokens' } },
  { id: 'trello', nom: 'Trello', description: 'Tableaux, listes et cartes.', acces: 'oauth' },
  { id: 'cloudinary', nom: 'Cloudinary', description: 'Médias : recherche, dossiers, transformations.', acces: 'les_deux' },
  { id: 'excalidraw', nom: 'Excalidraw', description: 'Schémas et diagrammes, avec un lien à ouvrir.', acces: 'aucun' },
  { id: 'maps', nom: 'Google Maps', description: 'Lieux et adresses sur une carte, trajets et durées (voiture, à pied, transports).', acces: 'jeton', aide: 'Clé d’API Google Maps Platform : activez la facturation du projet, puis l’API « Maps Experience agent tools » (Bibliothèque d’API), et créez une clé limitée à cette API (Identifiants). 10 000 requêtes gratuites par mois, ensuite payant.', lien: 'https://console.cloud.google.com/apis/library/mapstools.googleapis.com' },
  { id: 'homeassistant', nom: 'Home Assistant', description: 'La maison : lumières, clim et chauffage, volets, télé, prises, serrures, alarme, caméras, de toutes marques.', acces: 'jeton', urlLibre: true, aide: 'Jeton : dans Home Assistant, votre profil › Sécurité › Jetons d’accès longue durée › Créer un jeton.' },
  { id: 'coolify', nom: 'Coolify', description: 'Applications, déploiements, serveurs.', acces: 'jeton', urlLibre: true },
  { id: 'sentry', nom: 'Sentry', description: 'Erreurs de production, problèmes et versions.', acces: 'les_deux' }
]

function initial(configure: boolean): ClientState {
  const now = Date.now()
  return {
    connection: 'connecte',
    serverState: 'veille',
    connectionId: 'lab',
    micOwner: null,
    partial: '',
    sens: null,
    lastUser: '',
    reply: '',
    replyTurnId: null,
    history: [],
    // ?simple : l'écran simplifié, avec un échange déjà affiché.
    thread:
      param('simple') !== null
        ? [
            { id: 'u1', role: 'user', text: 'Qu’est-ce que j’ai cet après-midi ?', ts: now - 40_000 },
            { id: 'a1', role: 'assistant', text: 'Deux rendez-vous : le dentiste à quinze heures, puis la réunion des parents d’élèves à dix-huit heures trente.', ts: now - 30_000 }
          ]
        : [],
    log: [],
    // `&confirm=1` : une carte de validation (envoi d'un mail) pour voir sa mise en page.
    pending: typeof location !== 'undefined' && new URLSearchParams(location.search).has('confirm')
      ? { actionId: 'lab', title: 'Envoyer le mail', summary: 'À Claire Martin (claire.martin@exemple.com)\nBonjour Claire, merci pour votre message. Je vous confirme le rendez-vous de jeudi à 10 h. Bonne journée.', expiresAt: now + 30_000 }
      : null,
    lastOutcome: null,
    error: null,
    documentEnvoi: null,
    speaker: { available: true, enrolled: false, enabled: false, appareils: [] },
    // `&conversation=1` : le mode conversation en cours sur cet écran.
    ecoute: { relanceMs: 20_000, conversation: typeof location !== 'undefined' && new URLSearchParams(location.search).has('conversation') ? { connectionId: 'lab', appareil: 'mac', silenceMs: 300_000 } : null },
    enroll: null,
    enrollMessage: null,
    pair: null,
    views: [],
    pile: [],
    google: { ...GOOGLE_LAB, ...(param('google') === 'guide' ? { etat: 'non_configure', identifiants: null } : {}) },
    googleIdentifiants: null,
    // Agenda et mails « en relève », pour voir les cartes en chargement.
    perso: { at: now, agenda: null, mails: null },
    meteo: { data: SAMPLES.meteo![0]!.data as UiMeteo, at: now },
    rappels: param('sonne') !== null ? [{ id: 7, texte: 'Prendre le rendez-vous chez le pédiatre', echeance: now, heure: '16:00', jour: 'aujourd’hui', etat: 'sonne' }] : [],
    taches: [],
    // L'échéancier de l'atelier (`?lab=echeancier`), pour voir la carte « Échéances ».
    echeances: (SAMPLES.echeancier![0]!.data as UiEcheancier).groupes.flatMap((g) => g.echeances),
    push: { publicKey: null, abonnes: 1 },
    pushResult: null,
    utilisateur: {
      id: 2,
      prenom: 'Claire',
      nom: 'Martin',
      fonction: 'Assistante de direction',
      appellation: 'Claire',
      proprietaire: param('google') === 'guide' && param('membre') === null,
      configure,
      identifiant: 'claire',
      reglages: { nomAssistant: 'Nova', profil: 'secretariat', appellation: '', tutoiement: false, theme: 'cyan', orbe: 'nebule', voix: 'demo', vitesseVoix: 1, qualiteVoix: 'rapide', transcription: 'auto', synthese: 'elevenlabs', briefing: '07:30', retourApresMinutes: 60, silence: null, notifications: true, ville: 'Lyon', fuseau: FUSEAUX[0]!.tz, widgets: LAB_WIDGETS, plafondJour: 3, ecranSimple: param('simple') !== null, reunionsAgenda: true, moteurs: { principal: { fournisseur: 'anthropic', modele: 'claude-opus-5-5' }, rapide: { fournisseur: 'openai', modele: 'gpt-5.4-mini' }, taches: { fournisseur: 'mistral', modele: 'mistral-medium-latest' } } }
    },
    appareilId: 11,
    boites: [{ id: 1, libelle: 'Pro', email: 'claire.martin@exemple.com', fournisseur: 'Exemple', imap: 'imap.exemple.com:993', smtp: 'smtp.exemple.com:465', defaut: true }],
    boiteAjout: null,
    connecteurs: [
      { id: 1, service: 'github', libelle: 'GitHub', url: 'https://api.githubcopilot.com/mcp/', etat: 'connecte', outils: 41, actions: 19, message: '' },
      { id: 2, service: 'expo', libelle: 'Expo', url: 'https://mcp.expo.dev/mcp', etat: 'connecte', outils: 38, actions: 9, message: '' }
    ],
    catalogue: LAB_CATALOGUE,
    reunion: null,
    reunionProposee: param('visio') !== null ? { cle: 'lab', titre: 'Point hebdo avec Camille', heure: '14:30', service: 'Meet' } : null,
    reunions: null,
    competences: LAB_COMPETENCES,
    modelesCompetences: LAB_MODELES,
    competenceAction: null,
    connecteurAction: null,
    auth: { busy: false, error: null },
    usage: {
      at: now,
      jour: { total: totals(0.42, 9), parUsage: { conversation: totals(0.31, 7), briefing: totals(0.11, 2) } },
      mois: { total: totals(11.8, 240), parUsage: { conversation: totals(7.9, 170), tache: totals(2.2, 30), briefing: totals(1.1, 22), retour: totals(0.5, 14) } }
    },
    appareils: [
      { id: 11, type: 'mobile', nom: 'Téléphone', cree: now - 86400_000, vuLe: now },
      { id: 12, type: 'mac', nom: 'Mac', cree: now - 3 * 86400_000, vuLe: now - 40 * 60_000 },
      { id: 13, type: 'mobile', nom: 'Tablette', cree: now - 9 * 86400_000, vuLe: now - 5 * 86400_000 }
    ],
    voixChoix: [
      { id: 'LabCompteVoixAmelie1', nom: 'Amélie', description: 'Femme · Adulte · Calme · Conversation', source: 'compte' },
      { id: 'ohItIVrXTBI80RrUECOD', nom: 'Origine', description: 'La voix d’origine : posée, assurée.' },
      { id: 'onwK4e9ZLuTAKqWW03F9', nom: 'Daniel', description: 'Grave et calme, celle d’un présentateur.' },
      { id: 'XB0fDUnXU5powFXDhCwa', nom: 'Helen', description: 'Claire et chaleureuse.' },
      { id: 'EXAVITQu4vr4xnSDxMaL', nom: 'Sarah', description: 'Douce, un peu feutrée.' }
    ],
    synthese: true,
    elevenlabs: true,
    bibliotheque: null,
    voixAjout: null,
    reglagesErreurs: null,
    compteAction: null,
    comptes: null,
    invitations: [],
    invitationCreee: null,
    cles: [
      { nom: 'ANTHROPIC_API_KEY', source: 'coffre', fin: 'x9Qa', modifie: now - 86400_000 },
      { nom: 'OPENAI_API_KEY', source: 'coffre', fin: 'T3kM', modifie: now - 86400_000 },
      { nom: 'MISTRAL_API_KEY', source: 'coffre', fin: 'p7Ve', modifie: now - 3600_000 },
      { nom: 'ELEVENLABS_API_KEY', source: null },
      { nom: 'DEEPGRAM_API_KEY', source: null },
      { nom: 'GROQ_API_KEY', source: null }
    ],
    cleAction: null,
    moteurs: {
      ollama: false,
      searxng: false,
      bancs: [
        { fournisseur: 'anthropic', modele: 'claude-opus-5-5', etat: 'teste', scenarios: LAB_SCENARIOS.map((s) => ({ ...s, ok: true, ms: 4200 })), cout: 0.21, le: now - 86400_000 },
        { fournisseur: 'openai', modele: 'gpt-5.4-mini', etat: 'teste', scenarios: LAB_SCENARIOS.map((s) => (s.id === 'web' ? { ...s, ok: false, ignore: true, detail: 'aucune recherche web sur ce serveur (clé Brave ou SearXNG)', ms: 0 } : { ...s, ok: true, ms: 1800 })), cout: 0.02, le: now - 7200_000 },
        { fournisseur: 'mistral', modele: 'mistral-medium-latest', etat: 'limite', scenarios: LAB_SCENARIOS.map((s) => (s.id === 'recherche_outils' ? { ...s, ok: false, detail: 'tache_creer pas appelé', ms: 6100 } : s.id === 'web' ? { ...s, ok: false, ignore: true, detail: 'aucune recherche web sur ce serveur (clé Brave ou SearXNG)', ms: 0 } : { ...s, ok: true, ms: 2600 })), cout: 0.03, le: now - 3600_000 }
      ]
    },
    modeles: {},
    banc: null
  }
}

/** Le faux client : une méthode qu'il n'imite pas ne fait rien (au lieu de faire tomber l'écran). */
function sansEchec<T extends object>(o: T): T {
  return new Proxy(o, { get: (t, k) => (k in t || typeof k === 'symbol' || k === 'then' ? Reflect.get(t, k) : () => {}) })
}

const LAB_SCENARIOS = [
  { id: 'presentation', nom: 'Présentation' },
  { id: 'rappel', nom: 'Rappel' },
  { id: 'meteo', nom: 'Météo' },
  { id: 'memoire', nom: 'Mémoire' },
  { id: 'enchainement', nom: 'Enchaînement' },
  { id: 'recherche_outils', nom: 'Recherche d’outils' },
  { id: 'web', nom: 'Web' }
]

const labSlug = (nom: string) =>
  nom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'competence'

/** Compétences fictives de l'atelier. */
const LAB_COMPETENCES = [
  {
    id: 'relance-de-facture',
    nom: 'Relance de facture',
    description: 'Quand il faut relancer un client pour une facture impayée.',
    corps: "1. Retrouver le fil d'origine (référence, montant, échéance).\n2. Brouillon cordial en réponse au fil ; deuxième relance plus ferme.\n3. Rappel dans sept jours pour vérifier le paiement.",
    modifieLe: Date.UTC(2026, 10, 2)
  }
]

const LAB_MODELES = [
  { id: 'compte-rendu-de-reunion', nom: 'Compte rendu de réunion', description: "Quand on me demande un compte rendu, un résumé ou les notes d'une réunion, d'un appel ou d'un rendez-vous.", corps: '1. Présents, décisions, actions, points ouverts.\n2. Un rappel pour chaque action datée.', modifieLe: 0 },
  { id: 'preparer-un-deplacement', nom: 'Préparer un déplacement', description: 'Quand il part en rendez-vous ou en voyage et demande de préparer le trajet ou la journée.', corps: "1. L'agenda, le trajet, la météo.\n2. L'heure de départ conseillée.", modifieLe: 0 },
  { id: 'relance-de-facture', nom: 'Relance de facture', description: 'Quand il faut relancer un client ou un fournisseur pour une facture impayée.', corps: '1. Retrouver le fil.\n2. Brouillon de relance.', modifieLe: 0 }
]
