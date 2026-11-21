/**
 * Protocole temps réel entre les clients (app de bureau, miniature, téléphone) et le serveur.
 *
 * Messages texte : JSON `{ v, type, id, ts, ...contenu }`.
 * Trames binaires :
 *  - client → serveur : audio du micro, PCM 16 bits mono 16 kHz (après `audio.start`) ;
 *  - serveur → client : audio de l'assistant, PCM 16 bits mono 24 kHz, toujours précédé d'un `reply.audio`.
 */

export const PROTOCOL_VERSION = 1 as const
export const MIC_SAMPLE_RATE = 16_000
export const VOICE_SAMPLE_RATE = 24_000
/** Durée couverte par une valeur de l'enveloppe de volume (`reply.audio.levels`). */
export const LEVEL_STEP_MS = 20

export type Etat = 'veille' | 'ecoute' | 'reflexion' | 'parole' | 'attente_validation' | 'arret'
/** `mac` : l'app de bureau (macOS, Windows, Linux) ; `mini` : sa miniature flottante. */
export type DeviceKind = 'mac' | 'mini' | 'mobile'

export type Turn = { role: 'user' | 'assistant'; text: string; ts: number }

export type LogEntry = {
  id: number
  ts: number
  kind: 'voix' | 'reponse' | 'validation' | 'action' | 'systeme' | 'erreur'
  summary: string
}

export type Card = {
  kind: 'brouillon' | 'evenement' | 'fichier'
  title: string
  body: string
  meta?: string
}

export type ConfirmRequest = {
  actionId: string
  title: string
  summary: string
  expiresAt: number
}

export type ConfirmOutcome = 'valide' | 'annule' | 'expire'

/** Reconnaissance de la voix du propriétaire (sherpa-onnx, sur le serveur). */
export type SpeakerStatus = {
  /** Moteur et modèle présents sur le serveur. */
  available: boolean
  /** Empreinte vocale enregistrée. */
  enrolled: boolean
  /** L'assistant n'écoute que cette voix. */
  enabled: boolean
  /** Appareils où une empreinte est enregistrée (« mac », « mobile » ; « ancien » : d'avant les empreintes par appareil). */
  appareils: string[]
}

/**
 * Écoute sans mot d'activation pour un utilisateur. `relanceMs` : le micro reste ouvert ce temps après chaque
 * réponse. `conversation` : mode conversation actif, tenu par une connexion (l'appareil qui l'a demandé),
 * dont le micro reste ouvert jusqu'à `silenceMs` sans votre voix ; null : désactivé.
 */
export type Ecoute = {
  relanceMs: number
  conversation: { connectionId: string; appareil: DeviceKind | null; silenceMs: number } | null
}

// ── Interfaces d'outils (UI adaptative) ──────────────────────────────────
// Chaque outil décrit son résultat en données ; chaque client choisit le rendu adapté au type.

export type UiKind = 'dossier' | 'recherche' | 'infos' | 'document' | 'donnees' | 'mails' | 'mail' | 'agenda' | 'rappels' | 'taches' | 'tache' | 'drive' | 'drive_fichier' | 'meteo' | 'web' | 'itineraire' | 'connecteur' | 'schema' | 'projet' | 'lieux' | 'contacts' | 'echeancier' | 'papier' | 'papiers' | 'liste' | 'listes' | 'maison' | 'camera' | 'reunion' | 'reunions' | 'memoire' | 'competence' | 'competences'

export type UiItem = {
  nom: string
  /** Chemin lisible (« ~/Desktop/Projects/Asso »). */
  chemin: string
  type: 'dossier' | 'fichier'
  ext?: string
  /** « 16 éléments », « 2,4 Mo ». */
  detail?: string
  /** AAAA-MM-JJ. */
  date?: string
}

export type UiData =
  | { kind: 'dossier'; chemin: string; dossiers: number; fichiers: number; items: UiItem[]; autres: number }
  | { kind: 'recherche'; requete: string; total: number; items: UiItem[] }
  | { kind: 'infos'; chemin: string; nom: string; type: 'dossier' | 'fichier'; lignes: { label: string; valeur: string }[] }
  | UiDataTable
  | UiConnecteur
  | UiSchema
  | UiProjet
  | UiMails
  | UiMailFil
  | UiAgenda
  | UiRappels
  | UiTaches
  | UiTacheResultat
  | UiDrive
  | UiDriveFichier
  | UiMeteo
  | UiWeb
  | UiItineraire
  | UiLieux
  | UiContacts
  | UiEcheancier
  | UiPapier
  | UiPapiers
  | UiReunion
  | UiReunions
  | UiMemoire
  | UiCompetence
  | UiCompetences
  | UiListe
  | UiListes
  | UiMaison
  | UiCamera
  | {
      kind: 'document'
      chemin: string
      nom: string
      ext: string
      /**
       * Comment l'afficher : le fichier lui-même (pdf, image, video, audio), un rendu (markdown, code, texte,
       * tableau pour CSV et Excel, page pour HTML, Word, RTF), ou rien (autre).
       */
      media: 'pdf' | 'image' | 'video' | 'audio' | 'texte' | 'markdown' | 'code' | 'tableau' | 'page' | 'autre'
      /** Adresse d'aperçu (relative au serveur : « /apercu/… »), pour les PDF, images, vidéos et sons. */
      url?: string
      /** L'image n'est pas le fichier : sa première page (Quick Look) ou une conversion (HEIC, TIFF…). */
      apercu?: 'quicklook' | 'converti'
      /** Texte du document (texte, Markdown, code). */
      texte?: string
      /** Tableau (CSV, Excel) : en-têtes, lignes (au plus 1 000), nombre total ; la feuille montrée et celles du classeur. */
      tableau?: { colonnes: string[]; lignes: string[][]; total: number; feuille?: string; feuilles?: string[] }
      /** Page HTML déjà assainie (sans script ni lien ni chargement extérieur), montrée dans un cadre isolé. */
      html?: string
      tronque: boolean
      taille: string
      date: string
    }

// ── Météo et web ─────────────────────────────────────────────────────────

/** Famille de ciel, pour l'icône et la couleur. */
export type MeteoCiel = 'soleil' | 'eclaircies' | 'nuages' | 'pluie' | 'orage' | 'brouillard' | 'neige'

/** Carte météo : maintenant, les 12 prochaines heures, 5 jours. Températures en °C, vent en km/h, pluie en mm. */
export type UiMeteo = {
  kind: 'meteo'
  lieu: string
  /** Heure locale de la mise à jour des prévisions (« 20:15 »). */
  maj: string
  maintenant: { temp: number; ressenti: number; ciel: MeteoCiel; libelle: string; nuit: boolean; vent: number; humidite: number; pluie: number }
  heures: { heure: string; temp: number; ciel: MeteoCiel; nuit: boolean; pluie: number }[]
  jours: { jour: string; min: number; max: number; ciel: MeteoCiel; libelle: string; pluie: number }[]
  /** Attribution (« MET Norway »). */
  source: string
}

/** Résultats d'une recherche web demandée par la personne (pas pour une simple information). */
export type UiWeb = {
  kind: 'web'
  requete: string
  resultats: { titre: string; site: string; url: string; resume?: string; date?: string }[]
}

/** Un lieu sur la carte : une adresse, ou un lieu connu (avec son code). */
export type UiLieu = { nom: string; code?: string; adresse?: string; lat: number; lng: number }

/**
 * Position d'un lieu, et le trajet pour s'y rendre depuis l'appareil (ou un point de départ donné).
 * La durée est une estimation sans circulation ; la navigation se fait dans Google Maps.
 */
export type UiItineraire = {
  kind: 'itineraire'
  destination: UiLieu
  /** Point de départ : la position de l'appareil qui a demandé, ou un lieu nommé. */
  depart?: UiLieu & { source: 'appareil' | 'lieu'; precision?: number; appareil?: string }
  trajet?: {
    /** Distance en kilomètres, durée en minutes (sans circulation, sauf trajet de Google). */
    km: number
    minutes: number
    mode: 'voiture' | 'pied' | 'velo' | 'transports'
    /** Tracé simplifié [lat, lng]. */
    trace: [number, number][]
  }
  /** Ouvrir la navigation (ou le lieu) dans Google Maps. */
  google: string
  /** Pourquoi il n'y a pas de trajet (position refusée, départ introuvable…). */
  note?: string
  /** Trajet calculé par Google Maps (connecteur) plutôt que par l'assistant : la durée vient de Google. */
  fournisseur?: 'google'
}

/** Un lieu de Google Maps : son numéro dans le résumé (« [0] »), son nom tel que le résumé le donne, ses liens. */
export type UiLieuMaps = {
  n: number
  nom: string
  lat: number
  lng: number
  /** La fiche du lieu, le trajet jusqu'à lui, ses avis, ses photos (liens fournis par Google, jamais construits). */
  lien?: string
  trajet?: string
  avis?: string
  photos?: string
}

/** Lieux trouvés par Google Maps : le résumé rédigé par Google, chaque lieu numéroté sur la carte. */
export type UiLieux = {
  kind: 'lieux'
  requete: string
  /** Le résumé de Google ; « [n] » renvoie au lieu n. */
  resume: string
  lieux: UiLieuMaps[]
  /** Source à citer (exigée par Google). */
  attribution: { titre: string; lien?: string }
}

/** Données tabulaires : chiffres clés + tableau, quel que soit l'outil. */
export type UiDataTable = {
  kind: 'donnees'
  /** Service d'où viennent les données. */
  source: string
  /** Libellé de l'outil (« Factures du mois »). */
  titre: string
  /** Chiffres mis en avant (« 12 factures »). */
  chiffres: { label: string; valeur: string }[]
  colonnes: string[]
  lignes: string[][]
  total: number
}

/**
 * Résultat d'un connecteur (GitHub, Vercel, Expo…) mis en blocs : chaque élément (pull request, déploiement,
 * build…) devient une carte lisible, en français, sans adresses d'API ni champs techniques.
 */
export type UiConnecteur = {
  kind: 'connecteur'
  /** Identifiant du service (« github ») : couleur et pictogramme du panneau. */
  service: string
  /** « GitHub ». */
  source: string
  /** « Pull requests ». */
  titre: string
  /** cartes : liste ; frise : chronologie (déploiements, builds, commits) ; grille : tuiles (dépôts, projets) ; journal : lignes de log ; fiche : un seul objet ; texte : réponse rédigée. */
  disposition: 'cartes' | 'frise' | 'grille' | 'journal' | 'fiche' | 'texte'
  /** Chiffres utiles (« 3 ouvertes », « 2 fusionnées »). */
  resume: { label: string; valeur: string; ton?: UiDevTon }[]
  cartes: UiDevCarte[]
  total: number
  /** Réponse en texte (Markdown) quand le service ne renvoie pas de données structurées. */
  texte?: string
}

/** Ton d'un élément : réussi, échoué, en cours, en file, ouvert, fusionné, fermé, brouillon, neutre. */
export type UiDevTon = 'ok' | 'echec' | 'encours' | 'attente' | 'ouvert' | 'fusionne' | 'ferme' | 'brouillon' | 'neutre'

export type UiDevIcone = 'pr' | 'issue' | 'commit' | 'depot' | 'deploiement' | 'projet' | 'build' | 'ios' | 'android' | 'workflow' | 'version' | 'fichier' | 'commentaire' | 'personne' | 'ligne' | 'element'

export type UiDevCarte = {
  icone: UiDevIcone
  titre: string
  /** « #12 », « v1.4.0 », « a1b2c3d ». */
  numero?: string
  statut?: { label: string; ton: UiDevTon }
  /** Dépôt, projet ou application (« octocat/hello-world »). */
  contexte?: string
  /** Branches, étiquettes, cible, plateforme. */
  puces?: string[]
  auteur?: string
  avatar?: string
  /** ISO 8601. */
  date?: string
  /** Un extrait (description, message de commit). */
  extrait?: string
  /** Page web de l'élément (jamais une adresse d'API). */
  lien?: string
  faits?: UiFact[]
}

/** Un schéma Excalidraw, dessiné par l'assistant lui-même à partir des éléments envoyés au service. */
export type UiSchema = {
  kind: 'schema'
  source: string
  titre: string
  /** Identifiant du schéma chez le service (pour le reprendre). */
  id: string
  /** Éléments Excalidraw à dessiner (rectangle, ellipse, losange, texte, flèche, ligne), dans l'ordre. */
  elements: Record<string, unknown>[]
  /** Cadre à montrer (le dernier `cameraUpdate`), sinon l'emprise des éléments. */
  camera?: { x: number; y: number; width: number; height: number }
}

/** Un état coloré (« En ligne », « Échec »). */
export type UiProjetEtat = { label: string; ton: UiDevTon }

/**
 * Un projet (« Atlas ») vu d'un coup : son code (dépôts GitHub), ses sites (Vercel) et ses applications (Expo),
 * réunis par leur nom.
 */
export type UiProjet = {
  kind: 'projet'
  /** Le nom demandé (« Atlas »). */
  nom: string
  /** Bilan : un échec quelque part, quelque chose en cours, tout va bien, ou rien trouvé. */
  sante: 'ok' | 'echec' | 'encours' | 'inconnu'
  /** « Le build Android de Atlas a échoué. » */
  phrase: string
  depots: UiProjetDepot[]
  sites: UiProjetSite[]
  applis: UiProjetAppli[]
  /** Ce qui n'a pas pu être consulté (« Vercel : non relié »). */
  manques: string[]
  /** ms. */
  verifieLe: number
}

export type UiProjetDepot = {
  /** « octocat/atlas-api ». */
  nom: string
  lien: string
  branche: string
  prive: boolean
  /** ISO : dernier push. */
  pousse?: string
  /** Dernière exécution des GitHub Actions sur la branche principale. */
  ci?: { titre: string; statut: UiProjetEtat; date: string; lien: string }
  commits: { sha: string; message: string; auteur?: string; date: string; lien: string }[]
  prs: { numero: number; titre: string; auteur?: string; date: string; lien: string; brouillon: boolean }[]
  /** Plus de pull requests ouvertes que celles listées. */
  prsPlus: boolean
}

export type UiProjetDeploiement = { statut: UiProjetEtat; cible: 'production' | 'preview'; date: string; branche?: string; commit?: string; lien?: string }

export type UiProjetSite = {
  nom: string
  /** Adresse publique de la production. */
  lien?: string
  framework?: string
  production?: UiProjetDeploiement
  /** Le dernier déploiement, s'il n'est pas celui de la production. */
  dernier?: UiProjetDeploiement
}

export type UiProjetBuild = { plateforme: 'ios' | 'android'; statut: UiProjetEtat; version?: string; profil?: string; date: string; erreur?: string; lien: string }

export type UiProjetAppli = {
  nom: string
  /** « @octocat/atlas ». */
  id: string
  lien: string
  /** Le dernier build de chaque plateforme. */
  builds: UiProjetBuild[]
}

// ── Cartes et fiches (textes déjà mis en forme par le serveur) ──

/** Couleur d'un statut : ok (vert), attention (ambre), alerte (rouge), info (cyan), neutre. */
export type UiTone = 'ok' | 'attention' | 'alerte' | 'info' | 'neutre'

export type UiBadge = { label: string; tone?: UiTone }
export type UiFact = { label: string; valeur: string; tone?: UiTone }

/**
 * Pagination côté serveur : l'interface rappelle `tool` avec `args` et la page voulue
 * (message `ui.page`), sans passer par Claude.
 */
export type UiPager = { tool: string; args: Record<string, unknown>; page: number; pages: number; total: number; parPage: number }

/** Un indicateur mis en avant : valeur, unité, jauge facultative (0-100), détail. */
export type UiKpi = { label: string; valeur: string; unite?: string; jauge?: number; detail?: string; tone?: UiTone }

// ── Vie personnelle : Gmail et Google Agenda (textes déjà mis en forme par le serveur) ──

export type UiMailRow = {
  /** Identifiant du fil Gmail. */
  id: string
  de: string
  deEmail: string
  initiales: string
  objet: string
  extrait: string
  /** « 09:42 », « hier », « lun. 27 », « 12.09.2026 ». */
  quand: string
  nonLu: boolean
  important: boolean
  messages: number
  pieces: number
  /** Boîte d'où vient le mail, quand l'utilisateur en a plusieurs (« Pro ») ; absente pour Gmail seul. */
  boite?: string
  /** Date du dernier message (ms), pour mêler les boîtes dans l'ordre. */
  ts?: number
}

/**
 * Une compétence : une méthode en texte simple (un fichier Markdown sur le serveur), que l'assistant lit quand
 * une demande correspond à sa description. `modeles` : celles livrées avec CODE 2.0, à ajouter d'un geste.
 */
export type CompetenceInfo = {
  /** Nom du fichier, sans « .md ». */
  id: string
  nom: string
  /** Quand s'en servir. */
  description: string
  /** La méthode, en Markdown. */
  corps: string
  modifieLe: number
}

/**
 * Une boîte mail reliée par IMAP (lecture) et SMTP (envoi), en plus de Gmail : adresse pro, autre fournisseur.
 * Le mot de passe reste chiffré sur le serveur : l'écran ne le reçoit jamais.
 */
export type BoiteMail = {
  id: number
  /** Nom court affiché (« Pro », « Direction »). */
  libelle: string
  email: string
  /** « Orange », « Yahoo », ou le serveur. */
  fournisseur: string
  imap: string
  smtp: string
  /** Boîte d'envoi par défaut pour un nouveau message. */
  defaut: boolean
}

/** État d'un connecteur MCP : `a_autoriser` attend le consentement OAuth de l'utilisateur. */
export type ConnecteurEtat = 'inactif' | 'connecte' | 'a_autoriser' | 'erreur'

/** Un connecteur MCP relié (GitHub, Figma…). Le jeton ou l'accès OAuth reste chiffré sur le serveur. */
export type ConnecteurInfo = {
  id: number
  /** Identifiant du catalogue (« github ») ou « mcp » pour un serveur ajouté à la main. */
  service: string
  libelle: string
  url: string
  etat: ConnecteurEtat
  outils: number
  /** Outils qui écrivent : chacun passe par la carte de validation. */
  actions: number
  message: string
  /** Le jeton complémentaire du service est enregistré. */
  complement?: boolean
}

/** Un service du catalogue des connecteurs, tel que l'écran le propose. */
export type ServiceConnecteur = {
  id: string
  nom: string
  description: string
  /** `jeton` : jeton personnel à coller ; `oauth` : consentement dans le navigateur ; `les_deux` : au choix ; `aucun` : sans compte. */
  acces: 'jeton' | 'oauth' | 'les_deux' | 'aucun'
  /** L'adresse du serveur dépend de l'installation (Coolify) : à saisir. */
  urlLibre?: boolean
  /** Où créer le jeton, et quels droits cocher. */
  aide?: string
  lien?: string
  /** Un jeton facultatif en plus de la connexion, pour ce que le serveur MCP n'offre pas (Expo : la liste des projets). */
  complement?: { libelle: string; aide: string; lien?: string }
}

export type UiMails = {
  kind: 'mails'
  titre: string
  /** Requête Gmail affichée (« from:banque is:unread »). */
  requete?: string
  /** Adresse du compte. */
  compte?: string
  total: number
  nonLus: number
  /** Plusieurs boîtes (Gmail, Pro…) : les non lus de chacune, dans l'ordre des Réglages. */
  boites?: { nom: string; nonLus: number; gmail?: boolean }[]
  lignes: UiMailRow[]
  pager?: UiPager
}

export type UiMailMessage = {
  id: string
  de: string
  deEmail: string
  initiales: string
  a: string
  cc?: string
  /** « mer. 29 oct. · 09:42 ». */
  quand: string
  /** Texte nettoyé (sans HTML, sans citations). */
  texte: string
  tronque: boolean
  /** Pièces jointes : nom et taille (l’assistant en lit une quand on le lui demande). */
  pieces: { nom: string; taille: string }[]
  /** Envoyé par le propriétaire du compte. */
  moi: boolean
}

export type UiMailFil = {
  kind: 'mail'
  id: string
  objet: string
  compte?: string
  badges: UiBadge[]
  messages: UiMailMessage[]
  /** Brouillon de réponse préparé par CODE (rien n'est envoyé sans « oui »). */
  brouillon?: { id: string; a: string; objet: string; texte: string; /** Fichiers joints au brouillon. */ pieces?: { nom: string; taille: string }[]; statut: UiBadge; /** Envoi demandé : la carte de validation attend le « oui ». */ enAttente: boolean }
}

export type UiAgendaEvent = {
  id: string
  titre: string
  /** « 15:00 » ; vide pour un événement d'une journée. */
  debut: string
  fin: string
  /** Minutes depuis minuit (fuseau du propriétaire), pour placer le bloc. */
  de: number
  a: number
  journee: boolean
  lieu?: string
  visio: boolean
  participants: number
  /** Réponse du propriétaire (« accepté », « à confirmer »…). */
  reponse?: UiBadge
  /** « propose » : rendez-vous en attente de validation (création, déplacement). */
  etat: 'passe' | 'en_cours' | 'a_venir' | 'propose'
}

export type UiAgendaJour = {
  /** AAAA-MM-JJ. */
  date: string
  /** « MER. 29 ». */
  label: string
  aujourdhui: boolean
  evenements: UiAgendaEvent[]
  /** Créneaux libres (disponibilités), en minutes depuis minuit. */
  libres?: { de: number; a: number; debut: string; fin: string }[]
}

export type UiAgenda = {
  kind: 'agenda'
  titre: string
  /** « SEMAINE DU 27.10 AU 02.11 · 9 ÉVÉNEMENTS ». */
  sousTitre: string
  compte?: string
  kpis: UiKpi[]
  /** Le prochain rendez-vous, mis en avant. */
  prochain?: { id: string; titre: string; quand: string; dans: string; lieu?: string; visio: boolean }
  /** Plage horaire affichée, en minutes depuis minuit (08:00 → 20:00 par défaut). */
  plage: { de: number; a: number }
  /** Heure actuelle en minutes (ligne « maintenant ») si aujourd'hui est affiché. */
  maintenant?: number
  jours: UiAgendaJour[]
  /** Mode disponibilités : durée cherchée, en minutes. */
  duree?: number
}

/** Connexion au compte Google personnel (Gmail, Agenda). */
export type GoogleStatus = {
  etat: 'non_configure' | 'deconnecte' | 'connexion' | 'connecte' | 'expire' | 'erreur'
  email?: string
  /** Fin probable de l'accès (mode test de Google : 7 jours après la connexion), en ms. */
  expireLe?: number
  gmail: boolean
  agenda: boolean
  /** Lecture de tout le Drive (et création de fichiers) : à autoriser en reconnectant Google. */
  drive: boolean
  /** Phrase à afficher (« Connecté · expire dans 5 jours », « Reconnectez Google »). */
  message: string
  /** Pendant la connexion : la page de consentement Google, si le navigateur ne s'est pas ouvert. */
  url?: string
  /**
   * `local` : serveur sur l'ordinateur, Google revient sur une boucle locale (client « Application de bureau »),
   * la connexion se fait depuis cet ordinateur. `heberge` : Google revient sur l'adresse publique du serveur
   * (client « Application Web », adresse `retour` à déclarer), depuis n'importe quel appareil.
   */
  mode: 'local' | 'heberge'
  /** Hébergé : l'adresse de retour à coller dans la console Google. */
  retour?: string
  /** D'où viennent les identifiants du client Google : Réglages (propriétaire), serveur (environnement), aucun. */
  identifiants: 'reglages' | 'serveur' | null
}

/** Ce que le cockpit affiche en permanence : les rendez-vous du jour et les mails importants. */
export type PersoResume = {
  at: number
  agenda: UiAgendaEvent[] | null
  mails: UiMailRow[] | null
  /** Pourquoi une partie manque (« accès expiré »). */
  erreur?: string
}

// ── Google Drive ──

export type UiDriveType = 'dossier' | 'document' | 'tableur' | 'presentation' | 'pdf' | 'image' | 'texte' | 'autre'

export type UiDriveItem = {
  id: string
  nom: string
  type: UiDriveType
  /** Format lisible (« Google Docs », « PDF », « Excel »). */
  format: string
  /** « hier », « 09:42 », « 12.09.2026 ». */
  modifie: string
  /** « 2,4 Mo » ; absent pour les fichiers Google (Docs, Sheets…). */
  taille?: string
  /** Propriétaire, si ce n'est pas l'utilisateur (fichier partagé avec lui). */
  proprietaire?: string
  /** Page du fichier sur drive.google.com. */
  lien?: string
}

/** Résultat d'une recherche Drive ou contenu d'un dossier. */
export type UiDrive = {
  kind: 'drive'
  titre: string
  /** Texte cherché. */
  requete?: string
  /** Dossier parcouru. */
  dossier?: { id: string; nom: string; lien?: string }
  compte?: string
  items: UiDriveItem[]
  /** D'autres résultats existent : affiner la recherche. */
  plus: boolean
}

/** Un onglet de tableur : les premières lignes, valeurs affichées telles que dans Sheets. */
export type UiDriveFeuille = { nom: string; lignes: string[][]; /** Lignes et colonnes réelles de l'onglet. */ totalLignes: number; totalColonnes: number }

// ── Contacts ──

/** Une personne du carnet (ou quelqu'un avec qui l'utilisateur a échangé des mails). */
export type UiContact = {
  nom: string
  initiales: string
  organisation?: string
  fonction?: string
  emails: string[]
  telephones: { numero: string; type?: string }[]
  adresse?: string
  /** « 12 mars ». */
  anniversaire?: string
  /** Pas dans le carnet : retrouvé dans les échanges de mails. */
  echange?: boolean
}

export type UiContacts = {
  kind: 'contacts'
  requete: string
  contacts: UiContact[]
  /** Fiche d'une seule personne : ses derniers mails et ses prochains rendez-vous. */
  mails?: { id: string; objet: string; quand: string; nonLu: boolean }[]
  rendezVous?: { titre: string; quand: string }[]
}

/** Contenu d'un fichier Drive. */
export type UiDriveFichier = {
  kind: 'drive_fichier'
  id: string
  nom: string
  type: UiDriveType
  format: string
  modifie: string
  taille?: string
  proprietaire?: string
  lien?: string
  /** Texte (Markdown pour un Google Doc). */
  texte?: string
  /** Onglets d'un tableur (Google Sheets, CSV). */
  feuilles?: UiDriveFeuille[]
  tronque: boolean
  /** Ce qui n'est pas affiché ici (« PDF lu par CODE : ouvrez-le dans Drive pour le voir »). */
  note?: string
  /** Fichier que l’assistant vient de créer (dans le dossier « CODE 2.0 » du Drive). */
  cree?: boolean
  /** Pièce jointe d'un mail Gmail lue par l’assistant (et non un fichier du Drive). */
  source?: 'gmail'
}

// ── Échéancier ──

/** Ce qui tombe à date fixe : factures, loyer, impôts, assurances, abonnements, papiers à renouveler. */
export type EcheanceCategorie = 'facture' | 'loyer' | 'impot' | 'assurance' | 'abonnement' | 'document' | 'autre'
export type EcheanceRecurrence = 'mensuel' | 'trimestriel' | 'semestriel' | 'annuel'

export type UiEcheance = {
  id: number
  titre: string
  categorie: EcheanceCategorie
  /** « AAAA-MM-JJ ». */
  date: string
  /** « ven. 14 nov. ». */
  quand: string
  /** Jours jusqu'à l'échéance, négatif si elle est passée. */
  jours: number
  /** « dans 5 jours », « en retard de 2 jours ». */
  dans: string
  /** « 84,90 € ». */
  montant?: string
  /** « tous les mois ». */
  recurrence?: string
  etat: 'a_regler' | 'regle'
  /** « réglée le 3 nov. ». */
  regleLe?: string
  note?: string
}

export type UiEcheancier = {
  kind: 'echeancier'
  titre: string
  /** « 6 ÉCHÉANCES À RÉGLER · 2 RÉCURRENTES ». */
  sousTitre: string
  kpis: UiKpi[]
  /** « AAAA-MM-JJ » : le repère de la frise. */
  aujourdhui: string
  /** Jours couverts par la frise, à partir d'aujourd'hui. */
  horizon: number
  groupes: { label: string; tone?: UiTone; echeances: UiEcheance[] }[]
  /** Réglées ces 30 derniers jours, la plus récente d'abord. */
  reglees: UiEcheance[]
  /** Échéance qui vient d'être ajoutée ou modifiée, mise en évidence. */
  focus?: number
}

// ── Papiers (documents photographiés ou envoyés) ──

/** Le classement d'un papier : le dossier où il est rangé. */
export type PapierCategorie = 'facture' | 'impot' | 'assurance' | 'logement' | 'banque' | 'sante' | 'identite' | 'vehicule' | 'travail' | 'scolarite' | 'autre'
/** Le nom du dossier de chaque classement (dans le Drive : « CODE 2.0 › Papiers › Factures »). */
export const PAPIER_DOSSIERS: Record<PapierCategorie, string> = {
  facture: 'Factures',
  impot: 'Impôts',
  assurance: 'Assurances',
  logement: 'Logement',
  banque: 'Banque',
  sante: 'Santé',
  identite: 'Identité',
  vehicule: 'Véhicule',
  travail: 'Travail',
  scolarite: 'Scolarité',
  autre: 'Autres'
}
export const PAPIER_CATEGORIES = Object.keys(PAPIER_DOSSIERS) as PapierCategorie[]

/** Un papier reçu d'un appareil : lu par l'assistant, puis rangé (Drive ou serveur), avec son échéance s'il en a une. */
export type UiPapier = {
  kind: 'papier'
  id: number
  /** Nom du fichier envoyé. */
  nom: string
  media: 'image' | 'pdf'
  /** Adresse d'aperçu (temporaire). */
  apercu?: string
  /** « reçu aujourd’hui à 10:42 ». */
  recu: string
  taille: string
  etat: 'recu' | 'range'
  titre?: string
  categorie?: PapierCategorie
  emetteur?: string
  resume?: string
  /** Ce que l'assistant en a relevé : montant, date limite, référence… */
  champs: { label: string; valeur: string }[]
  rangement?: { ou: 'drive' | 'serveur'; chemin: string; lien?: string }
  echeance?: { id: number; titre: string; quand: string; montant?: string }
}

export type UiPapierLigne = Pick<UiPapier, 'id' | 'nom' | 'media' | 'apercu' | 'recu' | 'titre' | 'categorie' | 'emetteur'> & { lien?: string; echeance?: string }

export type UiPapiers = {
  kind: 'papiers'
  titre: string
  sousTitre: string
  papiers: UiPapierLigne[]
}

// ── Réunions (enregistrées ou importées, puis transcrites) ──

export type EtatReunion = 'enregistrement' | 'transcription' | 'prete' | 'erreur'

/** Une réunion dans une liste, et son avancement pendant la transcription. */
export type UiReunionLigne = {
  id: number
  titre: string
  /** « aujourd’hui à 10:42 ». */
  quand: string
  /** « 52 min », « 1 h 05 ». */
  duree: string
  etat: EtatReunion
  source: 'micro' | 'fichier'
  /** Pendant l'enregistrement : l'instant où il a commencé (pour le chrono des autres écrans). */
  debut?: number
  /** L'enregistrement est en pause : rien n'est capté jusqu'à la reprise. */
  enPause?: boolean
  /** Rangée par l'assistant (un rapport existe). */
  rangee?: boolean
  /** Morceaux transcrits sur morceaux reçus. */
  progression?: { transcrits: number; recus: number }
  /** Le début du résumé, une fois rangée. */
  resume?: string
  erreur?: string
}

/** Une réunion ouverte : son résumé, ses actions, et son texte par passages horodatés. */
export type UiReunion = Omit<UiReunionLigne, 'resume'> & {
  kind: 'reunion'
  /** Qui a transcrit, et pour combien (« Groq Whisper · ≈ 0,04 $ »). */
  transcritPar?: string
  resume?: string
  /** Ce qui a été décidé, puis ce qui reste à trancher. */
  decisions: string[]
  points: string[]
  actions: { quoi: string; qui?: string; quand?: string }[]
  participants: string[]
  /** Nombre de mots de la transcription (toute la réunion, même quand seuls quelques passages sont montrés). */
  mots: number
  /** Durée en secondes, pour situer les passages sur la frise. */
  dureeS: number
  /** `a` : l'instant du passage (« 12:40 »), `s` en secondes ; `trouve` : il contient les mots cherchés. */
  passages: { a: string; s: number; texte: string; trouve?: boolean }[]
  /** Les mots cherchés, quand seuls les passages qui les contiennent sont montrés. */
  recherche?: string
  /** Texte long, montré par parties. */
  partie?: { n: number; sur: number }
}

export type UiReunions = {
  kind: 'reunions'
  titre: string
  sousTitre: string
  reunions: UiReunionLigne[]
}

// ── Mémoire et compétences ──

/** Ce que l'assistant sait de la personne : ses notes par rubrique, et les mots appris à la transcription. */
export type UiMemoire = {
  kind: 'memoire'
  titre: string
  sousTitre: string
  rubriques: {
    id: string
    nom: string
    /** `date` : « 3 nov. 2026 », quand la note en porte une. */
    notes: { texte: string; date?: string }[]
  }[]
  /** Les mots que la transcription avait mal entendus, corrigés par la personne. */
  lexique: string[]
  /** La note qui vient d'être retenue. */
  focus?: string
}

/** Une compétence : la méthode que l'assistant suit, telle que la personne l'a écrite. */
export type UiCompetence = {
  kind: 'competence'
  id: string
  nom: string
  /** Quand s'en servir. */
  description: string
  /** La méthode, en Markdown. */
  corps: string
  /** « modifiée le 3 nov. 2026 ». */
  modifie: string
  /** L'assistant la suit pour la demande en cours. */
  suivie?: boolean
}

export type UiCompetences = {
  kind: 'competences'
  titre: string
  sousTitre: string
  competences: { id: string; nom: string; description: string; etapes: number }[]
}

// ── Listes partagées (courses, choses à faire) ──

/** Une personne de la maison, reconnaissable d'un coup d'œil : son prénom et sa teinte (0-359). */
export type UiPersonne = { prenom: string; teinte: number }

/** Qui voit une liste : la personne seule, toute la maison, ou quelques personnes. */
export type UiPartage = {
  mode: 'prive' | 'tous' | 'personnes'
  /** « Privée », « Toute la maison », « Avec Léo et Sam ». */
  libelle: string
  /** Ceux qui la voient, créateur compris (vide pour une liste privée). */
  personnes: UiPersonne[]
}

export type UiListeElement = {
  id: number
  texte: string
  /** « 2 », « 1 kg ». */
  quantite?: string
  coche: boolean
  /** Ajouté par : affiché seulement dans une liste partagée. */
  par?: UiPersonne
  /** Coché par (liste partagée). */
  cochePar?: UiPersonne
}

export type UiListe = {
  kind: 'liste'
  id: number
  nom: string
  partage: UiPartage
  /** Le créateur, s'il n'est pas la personne qui regarde. */
  auteur?: UiPersonne
  /** La personne qui regarde l'a créée : elle seule la partage ou la supprime. */
  mienne: boolean
  /** Ce qu'il reste à prendre (dans l'ordre d'ajout), puis ce qui est coché. */
  elements: UiListeElement[]
  restants: number
  /** Éléments qui viennent d'être ajoutés ou cochés, mis en évidence. */
  focus?: number[]
}

export type UiListeResume = {
  id: number
  nom: string
  partage: UiPartage
  restants: number
  total: number
  /** Les premiers éléments à prendre. */
  apercu: string[]
  /** « il y a 5 min ». */
  modifie: string
}

export type UiListes = {
  kind: 'listes'
  titre: string
  sousTitre: string
  listes: UiListeResume[]
}

// ── Maison (Home Assistant) ──

/** Ce qu'est un appareil de la maison, pour son icône et ce qu'on peut lui demander. */
export type TypeAppareil =
  | 'lumiere'
  | 'prise'
  | 'ventilateur'
  | 'clim'
  | 'chauffe_eau'
  | 'volet'
  | 'portail'
  | 'media'
  | 'serrure'
  | 'alarme'
  | 'camera'
  | 'aspirateur'
  | 'humidificateur'
  | 'scene'
  | 'script'
  | 'vanne'
  | 'sirene'
  | 'bouton'
  | 'capteur'
  | 'detecteur'

/** Un appareil vu par Home Assistant (son entité). */
export type UiAppareil = {
  /** Identifiant Home Assistant (« light.salon »). */
  id: string
  nom: string
  type: TypeAppareil
  piece?: string
  /** L'état en mots (« allumée », « 22 °C · froid », « ouverte »). */
  etat: string
  /** Détail en plus (« 70 % », « Netflix », « consigne 22 °C »). */
  detail?: string
  /** Dans son état « en marche » : allumé, en route, ouvert, armé. */
  actif: boolean
  /** À regarder : porte ouverte, serrure déverrouillée, alarme déclenchée, fuite, fumée. */
  alerte?: boolean
  /** Hors ligne pour Home Assistant. */
  indisponible?: boolean
  /** Un toucher l'allume ou l'éteint (jamais pour ce qui demande une validation). */
  basculable: boolean
  /** Ses actions demandent un « oui » (serrure, alarme, portail, caméra…). */
  sensible: boolean
}

export type UiMaison = {
  kind: 'maison'
  titre: string
  /** « 3 PIÈCES · 5 ALLUMÉS ». */
  sousTitre: string
  pieces: { nom: string; appareils: UiAppareil[] }[]
  /** Les appareils que la dernière commande vient de toucher. */
  focus?: string[]
  /** « 21:04 ». */
  heure: string
  /** Un toucher refusé, et pourquoi. */
  message?: string
}

/** L'image d'une caméra, prise à la demande ; elle n'est gardée nulle part. */
export type UiCamera = {
  kind: 'camera'
  id: string
  nom: string
  piece?: string
  /** Image (adresse data:) ; absente si la caméra n'a pas répondu. */
  image?: string
  /** « 21:04:12 ». */
  heure: string
  erreur?: string
}

// ── Tâches planifiées ──

/** Une tâche : une consigne que CODE exécute seul à l'heure dite (« tous les jours à 17 h, résume les nouvelles du jour… »). */
export type UiTache = {
  id: number
  titre: string
  /** Consigne complète, telle que l'utilisateur l'a donnée. */
  consigne: string
  /** « tous les jours à 17:00 », « demain à 09:00 ». */
  quand: string
  /** Prochaine exécution (ms) ; `null` si en pause ou terminée. */
  prochaine: number | null
  /** « aujourd’hui · 17:00 ». */
  prochaineLabel: string
  etat: 'active' | 'pause' | 'terminee'
  /** Une exécution est en cours. */
  enCours: boolean
  derniere?: { id: number; fin: number; quand: string; statut: 'ok' | 'erreur'; resume: string }
}

export type UiTaches = {
  kind: 'taches'
  titre: string
  sousTitre: string
  taches: UiTache[]
  focus?: number
}

/** Ce qu'une exécution a produit (Markdown simple). */
export type UiTacheResultat = {
  kind: 'tache'
  executionId: number
  tacheId: number
  titre: string
  /** « aujourd’hui à 17:00 ». */
  quand: string
  statut: 'en_cours' | 'ok' | 'erreur'
  resume: string
  texte: string
  /** Exécutée en retard (Mac éteint à l'heure prévue). */
  retard: boolean
  /** Exécutions précédentes, de la plus récente à la plus ancienne. */
  precedentes: { id: number; quand: string; statut: 'en_cours' | 'ok' | 'erreur' }[]
}

// ── Notifications du téléphone ──

export type PushInfo = {
  /** Clé publique VAPID (base64url) que le téléphone donne à Apple ou Google en s'abonnant ; `null` si indisponible. */
  publicKey: string | null
  /** Téléphones abonnés. */
  abonnes: number
}

/** Abonnement Web Push d'un navigateur (`PushSubscription.toJSON()`). */
export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } }

// ── Rappels ──

export type UiRappel = {
  id: number
  texte: string
  /** Prochaine échéance (ms) : l'interface calcule « dans 25 min » elle-même. */
  echeance: number
  /** « 09:00 ». */
  heure: string
  /** « aujourd’hui », « demain », « jeu. 6 nov. ». */
  jour: string
  /** « tous les lundis à 08:00 » ; absent pour un rappel ponctuel. */
  recurrence?: string
  /** « sonne » : déclenché, en attente de « fait » ou d'un report. */
  etat: 'a_venir' | 'sonne' | 'fait'
  /** Déclenché en retard (serveur arrêté à l'heure prévue). */
  retard?: boolean
  /** Donné par une autre personne de la maison : son prénom. */
  de?: string
}

export type UiRappels = {
  kind: 'rappels'
  titre: string
  /** « 3 RAPPELS ACTIFS · 1 RÉCURRENT ». */
  sousTitre: string
  kpis: UiKpi[]
  groupes: { label: string; rappels: UiRappel[] }[]
  /** Rappel qui vient d'être créé ou modifié, mis en évidence. */
  focus?: number
}

// ── Utilisateurs, appareils, compteur ─────────────────────────────────────

/** Thèmes proposés (orbe, logo, interfaces) ; la palette de chacun est dérivée côté écran. `aube` est le seul clair. */
export const THEMES = ['cyan', 'ambre', 'vert', 'violet', 'rouge', 'glacier', 'aurore', 'aube'] as const
export type ThemeId = (typeof THEMES)[number]

/** Formes de l'orbe, au choix de chacun ; toutes prennent les couleurs du thème et montrent les mêmes états. */
export const ORBES = ['nebule', 'anneaux', 'filaments', 'onde', 'cristal', 'pulsar', 'liquide', 'mercure', 'particules', 'galaxie', 'plasma', 'constellation', 'robot'] as const
export type OrbeId = (typeof ORBES)[number]

/** Bornes de la vitesse de la voix de l'assistant (1 : normale). */
export const VITESSE_VOIX = { min: 0.8, max: 1.2, pas: 0.05 } as const

/** Les cartes du cockpit (et de la réglette du téléphone), que chacun affiche, range et place à sa guise. */
export const WIDGETS = ['meteo', 'aujourdhui', 'rappels', 'echeances', 'mails', 'taches'] as const
export type WidgetId = (typeof WIDGETS)[number]
export const WIDGET_NOMS: Record<WidgetId, string> = { meteo: 'Météo', aujourdhui: 'Aujourd’hui (agenda)', rappels: 'Rappels', echeances: 'Échéances', mails: 'Mails importants', taches: 'Tâches' }
/** Une carte : sa colonne sur le Mac et si elle est affichée. L'ordre de la liste est l'ordre à l'écran. */
export type WidgetPlace = { id: WidgetId; colonne: 'gauche' | 'droite'; visible: boolean }

/**
 * Les cartes au complet, dans l'ordre choisi : chaque carte une fois, celles qui manquent (ajoutées depuis)
 * à la fin, à leur place par défaut. Commun au serveur et aux écrans.
 */
export function normalizeWidgets(list: readonly WidgetPlace[] | undefined, defaults: readonly WidgetPlace[]): WidgetPlace[] {
  const seen = new Set<WidgetId>()
  const out: WidgetPlace[] = []
  for (const w of list ?? []) {
    if (!WIDGETS.includes(w.id) || seen.has(w.id)) continue
    seen.add(w.id)
    out.push({ id: w.id, colonne: w.colonne === 'droite' ? 'droite' : 'gauche', visible: w.visible !== false })
  }
  for (const d of defaults) if (!seen.has(d.id)) out.push({ ...d })
  return out
}

/** Profils d'usage : consignes, outils sous la main, cartes et briefing (`PROFIL_DETAILS`). */
export const PROFILS = ['general', 'developpeur', 'secretariat', 'administration', 'foyer'] as const
export type ProfilId = (typeof PROFILS)[number]
export const PROFIL_NOMS: Record<ProfilId, { nom: string; description: string }> = {
  general: { nom: 'Usage général', description: 'Un peu de tout : mails, agenda, rappels, recherches.' },
  developpeur: { nom: 'Développeur', description: 'Projets, dépôts, déploiements, documentation technique.' },
  secretariat: { nom: 'Secrétariat', description: 'Courrier, rendez-vous, relances, comptes rendus.' },
  administration: { nom: 'Administration', description: 'Dossiers, échéances, tableaux de suivi, procédures.' },
  foyer: { nom: 'Foyer', description: 'La maison et la famille : courses, rendez-vous, rappels du quotidien.' }
}

/** Ce que le briefing du matin peut passer en revue ; chaque profil en choisit une suite, dans son ordre. */
export const BRIEFING_PARTIES = ['meteo', 'agenda', 'demain', 'echeances', 'projets', 'mails', 'rappels', 'taches'] as const
export type BriefingPartie = (typeof BRIEFING_PARTIES)[number]
export const BRIEFING_NOMS: Record<BriefingPartie, string> = {
  meteo: 'la météo',
  agenda: 'l’agenda du jour',
  demain: 'ce qui se prépare pour demain',
  echeances: 'les échéances de la semaine',
  projets: 'l’état des projets',
  mails: 'les mails importants',
  rappels: 'les rappels du jour',
  taches: 'ce qu’ont produit les tâches planifiées'
}

const carte = (id: WidgetId, colonne: WidgetPlace['colonne'], visible = true): WidgetPlace => ({ id, colonne, visible })

/**
 * Ce que change chaque profil, en plus de ses consignes (côté serveur) : `outils`, ce qu'il annonce avoir
 * sous la main (les autres outils restent trouvables par la recherche d'outils) ; `cartes`, les cartes
 * proposées, dans l'ordre ; `briefing`, ce que couvre le point du matin.
 */
export const PROFIL_DETAILS: Record<ProfilId, { outils: string; cartes: WidgetPlace[]; briefing: BriefingPartie[] }> = {
  general: {
    outils: 'mails, agenda, rappels, tâches, fichiers',
    cartes: [carte('meteo', 'gauche'), carte('aujourdhui', 'gauche'), carte('rappels', 'gauche'), carte('mails', 'droite'), carte('taches', 'droite'), carte('echeances', 'droite', false)],
    briefing: ['agenda', 'mails', 'rappels']
  },
  developpeur: {
    outils: 'état des projets (GitHub, Vercel, Expo), fichiers, tâches, mails',
    cartes: [carte('aujourdhui', 'gauche'), carte('taches', 'gauche'), carte('mails', 'droite'), carte('rappels', 'droite'), carte('meteo', 'droite', false), carte('echeances', 'droite', false)],
    briefing: ['agenda', 'projets', 'mails', 'taches']
  },
  secretariat: {
    outils: 'mails et brouillons, disponibilités et rendez-vous, relances, Drive',
    cartes: [carte('aujourdhui', 'gauche'), carte('rappels', 'gauche'), carte('mails', 'droite'), carte('taches', 'droite'), carte('meteo', 'droite', false), carte('echeances', 'droite', false)],
    briefing: ['agenda', 'demain', 'mails', 'rappels']
  },
  administration: {
    outils: 'mails, Drive et tableaux de suivi, échéances, tâches',
    cartes: [carte('echeances', 'gauche'), carte('rappels', 'gauche'), carte('aujourdhui', 'gauche'), carte('mails', 'droite'), carte('taches', 'droite'), carte('meteo', 'droite', false)],
    briefing: ['echeances', 'agenda', 'mails', 'taches']
  },
  foyer: {
    outils: 'rappels, agenda, factures et papiers à renouveler, météo, trajets',
    cartes: [carte('meteo', 'gauche'), carte('aujourdhui', 'gauche'), carte('rappels', 'droite'), carte('echeances', 'droite'), carte('mails', 'droite', false), carte('taches', 'droite', false)],
    briefing: ['meteo', 'agenda', 'echeances', 'rappels']
  }
}

/** Les cartes proposées par un profil (une copie, à ranger ensuite à sa guise). */
export function cartesDuProfil(profil: ProfilId): WidgetPlace[] {
  return (PROFIL_DETAILS[profil] ?? PROFIL_DETAILS.general).cartes.map((c) => ({ ...c }))
}

/** Les mêmes cartes, au même endroit, dans le même ordre. */
export function memesCartes(a: readonly WidgetPlace[], b: readonly WidgetPlace[]): boolean {
  return a.length === b.length && a.every((w, i) => w.id === b[i]!.id && w.colonne === b[i]!.colonne && w.visible === b[i]!.visible)
}

/** Clés API qu'un utilisateur peut ranger dans son coffre (chiffrées sur le serveur, jamais renvoyées aux écrans). */
export const CLES_API = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'MISTRAL_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'ELEVENLABS_API_KEY',
  'DEEPGRAM_API_KEY',
  'BRAVE_API_KEY'
] as const
export type CleApi = (typeof CLES_API)[number]
export const CLE_NOMS: Record<CleApi, { nom: string; usage: string; ou: string }> = {
  ANTHROPIC_API_KEY: { nom: 'Anthropic', usage: 'Moteur Claude, avec la recherche web intégrée.', ou: 'https://console.anthropic.com/settings/keys' },
  OPENAI_API_KEY: { nom: 'OpenAI', usage: 'Moteur GPT, la voix de l’assistant et la transcription de la vôtre.', ou: 'https://platform.openai.com/api-keys' },
  GEMINI_API_KEY: { nom: 'Google Gemini', usage: 'Moteur Gemini, et une voix pour l’assistant.', ou: 'https://aistudio.google.com/apikey' },
  MISTRAL_API_KEY: { nom: 'Mistral', usage: 'Moteur Mistral, et la transcription de votre voix (Voxtral).', ou: 'https://console.mistral.ai/api-keys' },
  DEEPSEEK_API_KEY: { nom: 'DeepSeek', usage: 'Moteur DeepSeek.', ou: 'https://platform.deepseek.com/api_keys' },
  OPENROUTER_API_KEY: { nom: 'OpenRouter', usage: 'Des centaines de modèles avec une seule clé.', ou: 'https://openrouter.ai/settings/keys' },
  GROQ_API_KEY: { nom: 'Groq', usage: 'Moteurs ouverts très rapides, et la transcription de votre voix (Whisper).', ou: 'https://console.groq.com/keys' },
  ELEVENLABS_API_KEY: { nom: 'ElevenLabs', usage: 'Voix et transcription de meilleure qualité.', ou: 'https://elevenlabs.io/app/settings/api-keys' },
  DEEPGRAM_API_KEY: { nom: 'Deepgram', usage: 'La transcription de votre voix en direct, et une voix rapide pour l’assistant.', ou: 'https://console.deepgram.com' },
  BRAVE_API_KEY: { nom: 'Brave Search', usage: 'La recherche web des moteurs qui n’en ont pas (tous sauf Claude).', ou: 'https://api-dashboard.search.brave.com/app/keys' }
}

/**
 * La voix, côté services : qui transcrit ce que vous dites, qui parle pour l'assistant. Chacun choisit
 * avec ses propres clés ; `auto` prend le premier disponible dans l'ordre des listes (le plus juste en
 * français d'abord, puis le plus rapide). Deepgram, quand sa clé existe, affiche aussi le texte en direct.
 */
export const TRANSCRIPTIONS = ['elevenlabs', 'deepgram', 'groq', 'mistral', 'openai'] as const
export type TranscriptionId = (typeof TRANSCRIPTIONS)[number]
export const SYNTHESES = ['elevenlabs', 'openai', 'deepgram', 'gemini'] as const
export type SyntheseId = (typeof SYNTHESES)[number]
export type ChoixTranscription = TranscriptionId | 'auto'
export type ChoixSynthese = SyntheseId | 'auto'

export const TRANSCRIPTION_INFOS: Record<TranscriptionId, { nom: string; cle: CleApi; aide: string }> = {
  elevenlabs: { nom: 'ElevenLabs Scribe', cle: 'ELEVENLABS_API_KEY', aide: 'Le plus juste en français et sur les noms propres.' },
  deepgram: { nom: 'Deepgram', cle: 'DEEPGRAM_API_KEY', aide: 'Le plus rapide : le texte s’écrit pendant que vous parlez.' },
  groq: { nom: 'Groq Whisper', cle: 'GROQ_API_KEY', aide: 'Whisper, très rapide et peu cher.' },
  mistral: { nom: 'Mistral Voxtral', cle: 'MISTRAL_API_KEY', aide: 'Européen, bon en français.' },
  openai: { nom: 'OpenAI', cle: 'OPENAI_API_KEY', aide: 'Juste, un peu plus lent.' }
}
export const SYNTHESE_INFOS: Record<SyntheseId, { nom: string; cle: CleApi; aide: string }> = {
  elevenlabs: { nom: 'ElevenLabs', cle: 'ELEVENLABS_API_KEY', aide: 'Les voix les plus naturelles.' },
  openai: { nom: 'OpenAI', cle: 'OPENAI_API_KEY', aide: 'Naturelle, avec la clé de vos moteurs GPT.' },
  deepgram: { nom: 'Deepgram Aura', cle: 'DEEPGRAM_API_KEY', aide: 'Très rapide ; deux voix françaises (une femme, un homme).' },
  gemini: { nom: 'Google Gemini', cle: 'GEMINI_API_KEY', aide: 'Avec la clé de vos moteurs Gemini ; démarre moins vite.' }
}

/**
 * Qui transcrit vraiment, selon le choix et les clés présentes. `finale` : la phrase que lit le moteur ;
 * `direct` : Deepgram, pour le texte en direct (même quand un autre écrit la phrase finale). Un choix
 * sans sa clé retombe sur l'automatique ; `null` partout : aucune clé de transcription.
 */
export function transcriptionEffective(choix: ChoixTranscription, aCle: (cle: CleApi) => boolean): { finale: TranscriptionId | null; direct: boolean; repli: boolean } {
  const direct = aCle('DEEPGRAM_API_KEY')
  if (choix !== 'auto' && aCle(TRANSCRIPTION_INFOS[choix].cle)) return { finale: choix, direct, repli: false }
  const finale = TRANSCRIPTIONS.find((t) => aCle(TRANSCRIPTION_INFOS[t].cle)) ?? null
  return { finale, direct, repli: choix !== 'auto' }
}

/** Qui parle vraiment, selon le choix et les clés présentes (même repli) ; `null` : pas de voix, réponses écrites. */
export function syntheseEffective(choix: ChoixSynthese, aCle: (cle: CleApi) => boolean): { synthese: SyntheseId | null; repli: boolean } {
  if (choix !== 'auto' && aCle(SYNTHESE_INFOS[choix].cle)) return { synthese: choix, repli: false }
  return { synthese: SYNTHESES.find((t) => aCle(SYNTHESE_INFOS[t].cle)) ?? null, repli: choix !== 'auto' }
}

/**
 * Fournisseurs de moteurs (LLM). Claude parle son propre format ; tous les autres, le format d'OpenAI
 * (Chat Completions). Ollama tourne sur une machine de l'installation : pas de clé, une adresse fixée par
 * le propriétaire du serveur.
 */
export const FOURNISSEURS = ['anthropic', 'openai', 'gemini', 'mistral', 'deepseek', 'openrouter', 'groq', 'ollama'] as const
export type FournisseurId = (typeof FOURNISSEURS)[number]

/**
 * `suggestions` : des modèles pour commencer ; la liste complète se lit chez le fournisseur, avec votre
 * clé (`moteurs.modeles`). Les catalogues changent souvent : le banc d'essai dit ce qui marche.
 */
export const FOURNISSEUR_INFOS: Record<FournisseurId, { nom: string; cle: CleApi | null; suggestions: { principal: string; rapide: string } }> = {
  anthropic: { nom: 'Claude (Anthropic)', cle: 'ANTHROPIC_API_KEY', suggestions: { principal: 'claude-opus-5-5', rapide: 'claude-haiku-5-5' } },
  openai: { nom: 'OpenAI', cle: 'OPENAI_API_KEY', suggestions: { principal: 'gpt-5.5', rapide: 'gpt-5.4-mini' } },
  gemini: { nom: 'Google Gemini', cle: 'GEMINI_API_KEY', suggestions: { principal: 'gemini-pro-latest', rapide: 'gemini-flash-latest' } },
  mistral: { nom: 'Mistral', cle: 'MISTRAL_API_KEY', suggestions: { principal: 'mistral-medium-latest', rapide: 'mistral-small-latest' } },
  deepseek: { nom: 'DeepSeek', cle: 'DEEPSEEK_API_KEY', suggestions: { principal: 'deepseek-v4-flash', rapide: 'deepseek-v4-flash' } },
  openrouter: { nom: 'OpenRouter', cle: 'OPENROUTER_API_KEY', suggestions: { principal: 'openrouter/auto', rapide: 'openrouter/auto' } },
  groq: { nom: 'Groq', cle: 'GROQ_API_KEY', suggestions: { principal: 'openai/gpt-oss-120b', rapide: 'llama-3.3-70b-versatile' } },
  ollama: { nom: 'Ollama (sur votre machine)', cle: null, suggestions: { principal: 'qwen3', rapide: 'qwen3' } }
}

/** Les trois usages d'un moteur : la conversation, les réponses rapides (et petites tâches internes), les tâches planifiées. */
export const ROLES_MOTEUR = ['principal', 'rapide', 'taches'] as const
export type RoleMoteur = (typeof ROLES_MOTEUR)[number]
export const ROLE_NOMS: Record<RoleMoteur, { nom: string; aide: string }> = {
  principal: { nom: 'Conversation', aide: 'Les demandes à plusieurs étapes : chercher, comparer, préparer, rédiger.' },
  rapide: { nom: 'Réponses rapides', aide: 'Les questions simples, la fin de vos phrases, les notes à retenir, le briefing.' },
  taches: { nom: 'Tâches planifiées', aide: 'Ce qui tourne seul, à heure fixe : personne n’attend, la qualité prime.' }
}
export type ChoixMoteur = { fournisseur: FournisseurId; modele: string }

/** Un modèle proposé par un fournisseur (`moteurs.modeles`) ; `prix` : dollars par million de tokens, si connus. */
export type ModeleInfo = { id: string; prix?: { entree: number; sortie: number } }

/** Le résultat d'un scénario du banc d'essai. `ignore` : rien pour le jouer (pas de recherche web, par exemple). */
export type BancScenario = { id: string; nom: string; ok: boolean; ignore?: boolean; detail?: string; ms: number }

/**
 * Le banc d'essai d'un modèle : les mêmes scénarios pour tous, sans effet réel (outils simulés).
 * `teste` : tout passe ; `limite` : la moitié au moins ; `echec` : moins ; `en_cours` : il tourne.
 */
export type BancResultat = {
  fournisseur: FournisseurId
  modele: string
  etat: 'teste' | 'limite' | 'echec' | 'en_cours'
  scenarios: BancScenario[]
  /** Ce qu'a coûté le banc, en dollars. */
  cout: number
  le: number
}

/** L'état des moteurs de l'installation, pour la page « Moteurs ». */
export type MoteursEtat = {
  /** Ollama est relié à ce serveur (adresse fixée par le propriétaire). */
  ollama: boolean
  /**
   * La mémoire de travail qu'Ollama accorde au modèle chargé (tokens), si un modèle tourne. Par défaut 4 096 :
   * les consignes de l'assistant n'y tiennent pas, Ollama en coupe le début sans prévenir.
   */
  ollamaContexte?: number
  /** Un SearXNG est relié à ce serveur : recherche web sans clé pour tous les moteurs. */
  searxng: boolean
  bancs: BancResultat[]
}

/**
 * Une clé du coffre, telle que les écrans la voient : jamais sa valeur. `source` : `coffre` (rangée par la
 * personne), `serveur` (celle de l'installation, pour le propriétaire seulement), ou absente.
 */
export type CleInfo = { nom: CleApi; source: 'coffre' | 'serveur' | null; fin?: string; modifie?: number }

/** Un compte de l'installation, vu par le propriétaire. */
export type CompteInfo = {
  id: number
  prenom: string
  nom: string
  /** Identifiant de connexion ; absent : pas encore de mot de passe (appareils associés par code seulement). */
  identifiant?: string
  proprietaire: boolean
  actif: boolean
  cree: number
  vuLe: number | null
}

/** Une invitation en attente : le code n'est montré qu'à sa création. */
export type InvitationInfo = { id: number; prenom: string; cree: number; expire: number }

/** Le nom de l'assistant tant que personne n'en a choisi un autre (CODE 2.0 est le nom de l'app, pas le sien). */
export const NOM_ASSISTANT_DEFAUT = 'Nova'

/** Réglages d'un utilisateur (valeurs par défaut dans config/code.config.ts). */
export type Reglages = {
  /** Le nom de l'assistant, choisi par chacun (et le mot qui l'appelle). */
  nomAssistant: string
  profil: ProfilId
  appellation: string
  tutoiement: boolean
  theme: ThemeId
  orbe: OrbeId
  /** Le moteur (fournisseur et modèle) de chaque usage. */
  moteurs: Record<RoleMoteur, ChoixMoteur>
  /** Identifiant d'une des voix proposées (`VoixChoix.id`) : une voix de base, ou une voix de son compte ElevenLabs. */
  voix: string
  vitesseVoix: number
  /** Modèle ElevenLabs : `rapide` (réponse immédiate) ou `naturelle` (plus réaliste, un peu plus lente). */
  qualiteVoix: QualiteVoix
  /** Qui transcrit ce que vous dites (`auto` : le premier disponible avec vos clés). */
  transcription: ChoixTranscription
  /** Qui parle pour l'assistant (`auto` : le premier disponible avec vos clés). */
  synthese: ChoixSynthese
  briefing: string
  retourApresMinutes: number
  silence: { de: string; a: string } | null
  notifications: boolean
  ville: string
  fuseau: string
  /** Cartes du cockpit : ordre, colonne, affichées ou non. */
  widgets: WidgetPlace[]
  /** Dépense par jour (dollars) au-delà de laquelle l'assistant passe sur le modèle rapide ; `null` : sans plafond. */
  plafondJour: number | null
  /** Écran simplifié, pour un usage tout à la voix : l'orbe, l'heure, ce qui vient d'être dit ; ni cartes ni menus. */
  ecranSimple: boolean
  /** Proposer d'enregistrer une réunion en visio de l'agenda, à l'heure où elle commence. */
  reunionsAgenda: boolean
}

/** Plafonds proposés dans Réglages › Consommation (dollars par jour). */
export const PLAFONDS_JOUR = [1, 2, 3, 5, 10] as const

/** L'utilisateur connecté, tel que ses écrans le voient (jamais sa clé). */
export type UtilisateurInfo = {
  id: number
  prenom: string
  nom: string
  /** Comment l'assistant l'appelle (« Madame Diallo », « Sam »). */
  appellation: string
  photo?: string
  fonction?: string
  /** Le propriétaire de l'installation : vue des coûts par personne. */
  proprietaire: boolean
  /** L'assistant de premier lancement est terminé (ou passé) : sinon, il s'affiche après la connexion. */
  configure: boolean
  /** Identifiant de connexion ; absent : pas encore de mot de passe. */
  identifiant?: string
  reglages: Reglages
}

/**
 * Une voix de l'assistant proposée à l'écoute : une voix de base (configuration), ou une voix du compte
 * ElevenLabs de la personne (clonée, ajoutée depuis la bibliothèque…).
 */
export type VoixChoix = { id: string; nom: string; description: string; source?: 'base' | 'compte' }

export const QUALITES_VOIX = ['rapide', 'naturelle'] as const
export type QualiteVoix = (typeof QUALITES_VOIX)[number]

/** Filtres de la bibliothèque de voix ElevenLabs (voix françaises). */
export type VoixRecherche = { recherche?: string; genre?: 'femme' | 'homme'; usage?: 'conversation' | 'narration' | 'infos'; page?: number }

/** Une voix de la bibliothèque ElevenLabs, à écouter (extrait fourni par ElevenLabs) puis ajouter à son compte. */
export type VoixBibliotheque = {
  id: string
  /** Identifiant public de son auteur, nécessaire pour l'ajouter. */
  auteur: string
  nom: string
  description: string
  /** Étiquettes déjà en français : « Femme · Adulte · Conversation · Accent parisien ». */
  etiquettes: string[]
  /** Extrait sonore (MP3 chez ElevenLabs), dans sa langue. */
  apercu: string | null
  /** Déjà dans le compte ElevenLabs de la personne. */
  ajoutee: boolean
  /** Nombre de personnes qui l'ont ajoutée (popularité). */
  ajouts: number
}

/** Ce qu'un réglage refusé avait de faux, champ par champ (rien n'est enregistré). */
export type ReglagesErreurs = Partial<Record<keyof Reglages, string>>

export type Appareil = { id: number; type: 'mac' | 'mobile' | 'navigateur'; nom: string; cree: number; vuLe: number | null }

/** Ce pour quoi le modèle a été appelé. */
export type UsageKind = 'conversation' | 'tache' | 'briefing' | 'retour'

export type UsageTotals = {
  /** Coût en dollars. */
  cout: number
  entree: number
  sortie: number
  cacheLecture: number
  cacheEcriture: number
  appels: number
}

export type UsagePeriode = { total: UsageTotals; parUsage: Partial<Record<UsageKind, UsageTotals>> }

/** Compteur de tokens : coût du jour et du mois de l'utilisateur ; `parPersonne` pour le premier utilisateur seulement. */
export type UsageResume = {
  at: number
  jour: UsagePeriode
  mois: UsagePeriode
  parPersonne?: { utilisateurId: number; nom: string; jour: number; mois: number }[]
}

/** Association d'un téléphone : l'adresse du serveur (Tailscale ou publique), ou l'étape qui manque. */
export type PairInfo = {
  status: 'pret' | 'sans_tailscale' | 'deconnecte' | 'sans_https' | 'sans_serve'
  message: string
  /** « mon-mac.tailnet.ts.net ». */
  host?: string
  /** Lien d'association complet, avec un code à usage unique valable dix minutes (seulement quand tout est prêt). */
  url?: string
  /** Commande à lancer sur le Mac pour l'étape manquante. */
  command?: string
}

export type UiView = {
  /** Identifiant de l'appel d'outil : la même vue passe de « chargement » à « pret ». */
  id: string
  turnId: string
  kind: UiKind
  title: string
  status: 'chargement' | 'pret' | 'erreur'
  data?: UiData
  message?: string
  at: number
  /** Pas encore affichée : elle apparaîtra quand l'assistant en parlera. */
  masque?: boolean
}

type Envelope = { v: typeof PROTOCOL_VERSION; id: string; ts: number }

/**
 * Ce que le Mac renvoie par le pont. Pour un outil : son résultat (`resultat`), et pour une modification,
 * ce qu'il faut faire valider (`confirmation`, l'action attendant sur le Mac sous `cle`). Pour une action
 * validée : ce qu'elle a noté au journal et ce que CODE doit dire. `erreur` : le Mac n'a rien pu faire.
 */
export type PontReponse = {
  /** `content` : du texte, ou des blocs pour Claude (image, PDF lus). */
  resultat?: { content: string | unknown[]; isError?: boolean; summary: string; view?: UiData }
  confirmation?: { titre: string; resume: string; cle: string }
  journal?: string[]
  annonces?: string[]
  erreur?: string
}

export type ClientPayload =
  | { type: 'hello'; token: string; device: DeviceKind }
  /** Connexion à un compte de l'installation (premier message, sans jeton) : le serveur répond `auth.ok` avec un jeton d'appareil, puis `welcome`. */
  | { type: 'auth.login'; identifiant: string; motDePasse: string; device: DeviceKind; nom?: string }
  /** Association par le QR du Mac : le code à usage unique contre un jeton, rattaché au même utilisateur. */
  | { type: 'auth.pair'; code: string; device: DeviceKind; nom?: string }
  /** Invitation du propriétaire : le code, plus le prénom, l'identifiant et le mot de passe du nouveau compte. */
  | { type: 'auth.invitation'; code: string; prenom: string; identifiant: string; motDePasse: string; device: DeviceKind; nom?: string }
  /** Son prénom et son nom (réponse : `reglages` à ses appareils, ou `compte.resultat` en cas de refus). */
  | { type: 'compte.nom'; prenom: string; nom: string }
  /** Identifiant et mot de passe de son compte (`ancien` : le mot de passe actuel, s'il y en a un). Réponse : `compte.resultat`. */
  | { type: 'compte.identifiants'; identifiant: string; motDePasse: string; ancien?: string }
  /** Propriétaire seulement : comptes et invitations (réponse : `comptes`), inviter, annuler, activer ou désactiver un compte. */
  | { type: 'comptes.lister' }
  | { type: 'invitation.creer'; prenom: string }
  | { type: 'invitation.annuler'; id: number }
  | { type: 'compte.actif'; id: number; actif: boolean }
  /** Coffre de clés API : état de chaque clé (réponse : `cles`), et rangement (valeur vide : retirée). */
  | { type: 'cles.lister' }
  | { type: 'cle.definir'; nom: CleApi; valeur: string }
  /** Page « Moteurs » : état de l'installation et bancs d'essai (réponse : `moteurs`) ; modèles d'un fournisseur, lus avec sa clé (réponse : `moteurs.modeles`). */
  | { type: 'moteurs.lister' }
  | { type: 'moteurs.modeles'; fournisseur: FournisseurId }
  /** Lance le banc d'essai d'un modèle, avec ses clés (réponse : `banc`, puis `moteurs`). */
  | { type: 'moteurs.banc'; fournisseur: FournisseurId; modele: string }
  /** Déconnexion de cet appareil : son jeton est révoqué. */
  | { type: 'auth.logout' }
  /** Appareils connectés de l'utilisateur (réponse : `devices`), et révocation de l'un d'eux. */
  | { type: 'devices.list' }
  | { type: 'device.revoke'; id: number }
  /** Compteur de tokens (réponse : `usage`). */
  | { type: 'usage.request' }
  /** Réglages de l'utilisateur et voix proposées (réponse : `reglages`, à cet appareil). */
  | { type: 'reglages.get' }
  /** Change une partie des réglages : validés champ par champ, puis `reglages` à tous ses appareils (ou `reglages.erreur`). */
  | { type: 'reglages.set'; reglages: Partial<Reglages> }
  /** Court extrait d'une voix, à cette vitesse : l'audio ne part qu'à cet appareil (`reply.audio`). */
  | { type: 'voix.echantillon'; voix: string; vitesse: number }
  | { type: 'voix.bibliotheque'; filtres: VoixRecherche }
  | { type: 'voix.ajouter'; auteur: string; id: string; nom: string }
  /** Fin du premier lancement. `presentation` : l'assistant se présente à voix haute sur cet appareil. */
  | { type: 'assistant.fini'; presentation: boolean }
  /** `overReply` : la parole a commencé pendant que l'appareil jouait encore la réponse de CODE. */
  | { type: 'audio.start'; overReply?: boolean; called?: boolean }
  | { type: 'audio.end' }
  | { type: 'audio.cancel' }
  /** Message écrit. `voice: false` (mode chat) : réponse affichée seulement, sans voix. */
  | { type: 'text'; text: string; voice?: boolean }
  | { type: 'interrupt' }
  | { type: 'confirm'; actionId: string }
  | { type: 'cancel'; actionId: string }
  | { type: 'halt' }
  | { type: 'resume' }
  /** Action dans l'interface, sans passer par Claude : parcourir un dossier, afficher un fichier, l'ouvrir sur le Mac. */
  | { type: 'ui.action'; action: 'parcourir' | 'afficher' | 'ouvrir_mac' | 'finder'; chemin: string; turnId: string }
  /** Autre page, onglet ou recherche d'une liste (UiPager), sans passer par Claude : le panneau `viewId` est remplacé. */
  | { type: 'ui.page'; viewId: string; turnId: string; tool: string; args: Record<string, unknown> }
  /** Le Mac demande de quoi associer un téléphone (QR code). Refusé aux autres appareils. */
  | { type: 'pair.request' }
  /** Le Mac lance la connexion au compte Google (page de consentement dans le navigateur). Refusé aux autres appareils. */
  | { type: 'google.connect' }
  /** Le propriétaire relie l'installation à son projet Google Cloud (réponse : `google.identifiants`, puis `google.status`). */
  | { type: 'google.identifiants'; clientId: string; clientSecret: string }
  | { type: 'google.disconnect' }
  /** Rendez-vous du jour et mails importants pour le cockpit (réponse : `perso.resume`). */
  | { type: 'perso.refresh' }
  /** Météo de la ville de l'utilisateur, pour sa carte (réponse : `meteo`). */
  | { type: 'meteo.refresh' }
  /** Boîtes mail IMAP de l'utilisateur (réponse : `boites`). */
  | { type: 'boites.lister' }
  /**
   * Relier une boîte : la connexion est testée (lecture et envoi) avant d'enregistrer. Serveurs devinés
   * d'après l'adresse (Orange, Yahoo, iCloud…) s'ils ne sont pas donnés. Réponse : `boite.resultat`.
   */
  | { type: 'boite.ajouter'; libelle: string; email: string; motDePasse: string; imapHote?: string; imapPort?: number; smtpHote?: string; smtpPort?: number }
  | { type: 'boite.retirer'; id: number }
  | { type: 'boite.defaut'; id: number }
  /**
   * Réunions. `reunion.demarrer` ouvre un enregistrement (micro) ou un import (fichier audio) : réponse
   * `reunion.ouverte`, puis l'appareil envoie les morceaux par `POST /reunions/<numéro>/segments` et finit par
   * `reunion.terminer`. Pas de champ `id` : celui de l'enveloppe se confondrait avec lui.
   */
  | { type: 'reunion.demarrer'; source: 'micro' | 'fichier'; titre?: string }
  | { type: 'reunion.terminer'; reunion: number }
  | { type: 'reunion.annuler'; reunion: number }
  /** Mettre l'enregistrement en pause ou le reprendre, depuis n'importe quel écran. */
  | { type: 'reunion.pause'; reunion: number; pause: boolean }
  /** Arrêter l'enregistrement depuis un autre écran que celui qui enregistre (la miniature, le téléphone). */
  | { type: 'reunion.stop'; reunion: number }
  /** Les réunions de la personne (réponse `reunions`). */
  | { type: 'reunions.lister' }
  /** Compétences : liste et modèles (réponse `competences`). */
  | { type: 'competences.lister' }
  /**
   * Enregistrer une compétence : `competence` pour modifier celle-là, sinon nouvelle ; `texte` : un fichier
   * importé (en-tête nom/description, ou format SKILL.md), à la place des champs. Réponse : `competence.resultat`.
   * Pas de champ `id` ici : absent, celui de l'enveloppe du message serait pris pour une compétence.
   */
  | { type: 'competence.enregistrer'; competence?: string; nom?: string; description?: string; corps?: string; texte?: string; fichier?: string }
  | { type: 'competence.supprimer'; competence: string }
  /** Connecteurs MCP : liste (réponse `connecteurs`), ajout (jeton, ou OAuth sans jeton), autorisation, retrait. */
  | { type: 'connecteurs.lister' }
  | { type: 'connecteur.ajouter'; service: string; jeton?: string; url?: string; libelle?: string; complement?: string }
  /** Ajoute (ou retire, jeton vide) le jeton complémentaire d'un connecteur relié ; vérifié avant d'être gardé. */
  | { type: 'connecteur.complement'; id: number; jeton: string }
  | { type: 'connecteur.autoriser'; id: number }
  | { type: 'connecteur.retirer'; id: number }
  /** Réponse à `position.demande` : la position de l'appareil, ou pourquoi il n'en donne pas. */
  | { type: 'position'; id: string; lat?: number; lng?: number; precision?: number; erreur?: string }
  /** L'app Mac sait exécuter les outils de fichiers sur ce Mac (le pont) : annoncé après `welcome`. */
  | { type: 'pont.pret'; outils: string[] }
  /** Réponse du Mac à `pont.outil` ou `pont.executer`. */
  | ({ type: 'pont.resultat'; id: string } & PontReponse)
  /** Un rappel qui sonne : « fait », ou reporté de quelques minutes. */
  | { type: 'reminder.action'; id: number; action: 'fait' | 'reporter'; minutes?: number }
  /** Une tâche planifiée : la lancer tout de suite, la mettre en pause ou la reprendre. */
  | { type: 'task.action'; id: number; action: 'executer' | 'pause' | 'reprendre' }
  /** Un document vient d'être envoyé (`POST /documents`) : l'assistant le lit et le range. */
  | { type: 'document'; id: number; voice?: boolean }
  /** Une échéance cochée comme réglée depuis une carte (la suivante est créée si elle revient). */
  | { type: 'echeance.regler'; id: number }
  /** Un élément coché ou décoché d'un toucher, dans une liste affichée. */
  | { type: 'liste.cocher'; liste: number; element: number; coche: boolean }
  /** Un toucher sur un appareil de la maison : l'allumer ou l'éteindre (jamais une action sensible). */
  | { type: 'maison.basculer'; entite: string }
  /** Reprendre l'image d'une caméra. */
  | { type: 'maison.camera'; entite: string }
  /** Le téléphone s'abonne aux notifications (rappels, briefing), ou se désabonne. */
  | { type: 'push.subscribe'; subscription: PushSubscriptionJson }
  | { type: 'push.unsubscribe'; endpoint: string }
  /** Une notification d'essai sur tous les téléphones abonnés. */
  | { type: 'push.test' }
  /** Journal technique de l'appareil (étapes d'ouverture du micro…), pour diagnostiquer à distance. Jamais de contenu. */
  | { type: 'client.log'; message: string }
  | { type: 'enroll.start' }
  | { type: 'enroll.end' }
  | { type: 'enroll.cancel' }
  | { type: 'speaker.reset' }
  /** Mode conversation de cet appareil : le micro reste ouvert sans mot d'activation (refusé sans empreinte vocale). */
  | { type: 'conversation.set'; active: boolean }
  /** L’utilisateur est là : ordinateur réveillé ou utilisé, téléphone ouvert. Après une longue absence, l'assistant fait le point. `voice: false` : réponse écrite (mode chat). */
  | { type: 'presence'; voice?: boolean }
  | { type: 'ping' }

export type ServerPayload =
  | {
      type: 'welcome'
      version: typeof PROTOCOL_VERSION
      connectionId: string
      state: Etat
      micOwner: string | null
      history: Turn[]
      log: LogEntry[]
      pendingConfirm: ConfirmRequest | null
      speaker: SpeakerStatus
      ecoute: Ecoute
      google: GoogleStatus
      rappels: UiRappel[]
      push: PushInfo
      taches: UiTache[]
      /** Absent d'un serveur d'avant l'échéancier. */
      echeances?: UiEcheance[]
      utilisateur: UtilisateurInfo
      appareilId: number
    }
  /** Connexion réussie : le jeton de cet appareil, à garder (il n'est donné qu'ici). */
  | { type: 'auth.ok'; token: string; utilisateur: UtilisateurInfo }
  /** Connexion refusée ; la connexion WebSocket reste ouverte pour réessayer. */
  | { type: 'auth.error'; code: 'identifiants' | 'inactif' | 'trop_d_essais' | 'indisponible' | 'code' | 'invitation'; message: string; champ?: 'prenom' | 'identifiant' | 'motDePasse' }
  /** Résultat de `compte.identifiants`. */
  | { type: 'compte.resultat'; ok: boolean; message: string; champ?: 'identifiant' | 'motDePasse' | 'ancien' | 'prenom' | 'nom' }
  | { type: 'comptes'; comptes: CompteInfo[]; invitations: InvitationInfo[] }
  /** Une invitation vient d'être créée : son code (montré une fois) et le lien à envoyer, si le serveur est joignable. */
  | { type: 'invitation'; prenom: string; code: string; expire: number; url?: string }
  | { type: 'cles'; cles: CleInfo[] }
  | { type: 'cle.resultat'; nom: CleApi; ok: boolean; message: string }
  | { type: 'moteurs'; etat: MoteursEtat }
  | { type: 'moteurs.modeles'; fournisseur: FournisseurId; modeles: ModeleInfo[]; erreur?: string }
  /** Un banc d'essai avance (`en_cours`, scénario par scénario) ou se termine. */
  | { type: 'banc'; resultat: BancResultat }
  | { type: 'devices'; appareils: Appareil[]; courant: number }
  | { type: 'usage'; usage: UsageResume }
  /** Réglages de l'utilisateur, à chaque changement (à tous ses appareils) ou sur demande. `synthese` : une voix est disponible sur le serveur. */
  | { type: 'reglages'; utilisateur: UtilisateurInfo; voix: VoixChoix[]; synthese: boolean; elevenlabs: boolean }
  | { type: 'voix.bibliotheque'; filtres: VoixRecherche; voix: VoixBibliotheque[]; suite: boolean; erreur?: string }
  | { type: 'voix.ajoutee'; id: string; nom: string; erreur?: string }
  | { type: 'reglages.erreur'; erreurs: ReglagesErreurs }
  | { type: 'state'; state: Etat; micOwner: string | null }
  | { type: 'transcript.partial'; text: string }
  /** Le sens de la transcription `text`, jugé pendant une pause : demande complète (`fini`) ou phrase au milieu. */
  | { type: 'transcript.sens'; text: string; fini: boolean }
  | { type: 'transcript.final'; text: string }
  | { type: 'reply.text'; turnId: string; delta: string }
  | { type: 'reply.audio'; turnId: string; seq: number; levels: number[] }
  | { type: 'reply.end'; turnId: string; interrupted: boolean }
  | { type: 'card'; card: Card }
  | { type: 'ui.view'; view: UiView }
  | { type: 'pair.info'; info: PairInfo }
  /**
   * Le pont vers le Mac : exécuter un outil de fichiers sur ce Mac (`envoi` : jeton pour y déposer les
   * aperçus, par HTTP), ou faire l'action qu'il a préparée une fois l'utilisateur d'accord (`cle`).
   */
  | { type: 'pont.outil'; id: string; outil: string; input: Record<string, unknown>; envoi: string }
  | { type: 'pont.executer'; id: string; cle: string; envoi: string }
  | ({ type: 'confirm.request' } & ConfirmRequest)
  | { type: 'confirm.result'; actionId: string; outcome: ConfirmOutcome }
  | { type: 'log'; entry: LogEntry }
  | { type: 'enroll.progress'; percentage: number }
  | { type: 'enroll.done'; ok: boolean; message: string }
  | { type: 'speaker.status'; status: SpeakerStatus }
  /** Le mode conversation change (activé, coupé par un silence, la veille, un autre appareil). */
  | { type: 'ecoute'; ecoute: Ecoute }
  /** La phrase est close par le serveur (suivi de la voix) : `fin`, vous avez fini ; `autre`, d'autres voix seulement. */
  | { type: 'audio.stop'; reason: 'fin' | 'autre' }
  /** Votre voix reconnue pendant que l'assistant répondait : la réponse s'arrête (l'appareil coupe le son). */
  | { type: 'audio.barge' }
  | { type: 'google.status'; status: GoogleStatus }
  | { type: 'google.identifiants'; ok: boolean; message: string }
  | { type: 'perso.resume'; resume: PersoResume }
  | { type: 'meteo'; meteo: UiMeteo | null; erreur?: string }
  | { type: 'boites'; boites: BoiteMail[] }
  /** Résultat de `boite.ajouter` : `manuel` quand les serveurs n'ont pas pu être devinés (à saisir). */
  | { type: 'boite.resultat'; ok: boolean; message: string; manuel?: boolean }
  /**
   * L'enregistrement peut commencer : comment découper (secondes), qui transcrira et à quel prix (dollars par
   * heure d'audio). `refus` : pourquoi il ne peut pas (aucune clé de transcription).
   */
  | { type: 'reunion.ouverte'; reunion: number; titre: string; segmentS: number; segmentMaxS: number; dureeMaxS: number; service: string; tarif: number }
  | { type: 'reunion.refus'; message: string }
  /** Une réunion a avancé (morceau transcrit, prête, rangée) ; sans `ligne` : supprimée. */
  | { type: 'reunion.etat'; reunion: number; ligne?: UiReunionLigne }
  | { type: 'reunions'; reunions: UiReunionLigne[] }
  /** Une réunion en visio de l'agenda commence : proposer de l'enregistrer (`cle` : pour ne la montrer qu'une fois). */
  | { type: 'reunion.proposition'; cle: string; titre: string; heure: string; service: string }
  /** L'assistant demande à cet appareil de lancer ou d'arrêter l'enregistrement (« enregistre la réunion »). */
  | { type: 'reunion.commande'; action: 'demarrer' | 'arreter'; titre?: string }
  | { type: 'competences'; competences: CompetenceInfo[]; modeles: CompetenceInfo[] }
  /** Résultat de `competence.enregistrer` ; `competence` : celle qui vient d'être enregistrée. */
  | { type: 'competence.resultat'; ok: boolean; message: string; competence?: string }
  | { type: 'connecteurs'; connecteurs: ConnecteurInfo[]; catalogue: ServiceConnecteur[] }
  /** Un appareil après un toucher (son nouvel état), ou l'erreur. */
  | { type: 'maison.appareil'; entite: string; appareil?: UiAppareil; erreur?: string }
  /** Une nouvelle image de caméra. */
  | { type: 'maison.camera'; vue: UiCamera }
  /** Résultat d'un ajout ou d'une autorisation ; `url` : page de consentement à ouvrir dans le navigateur. */
  | { type: 'connecteur.resultat'; ok: boolean; message: string; url?: string }
  /** Le serveur demande sa position à l'appareil qui a posé la question (itinéraire) : une fois, rien n'est gardé. */
  | { type: 'position.demande'; id: string }
  /** Rappels actifs (à venir et qui sonnent), à chaque changement. */
  | { type: 'reminders'; rappels: UiRappel[] }
  /** Tâches planifiées, à chaque changement (création, exécution commencée ou finie). */
  | { type: 'tasks'; taches: UiTache[] }
  /** Échéances à régler, à chaque changement (carte « Échéances »). */
  | { type: 'echeances'; echeances: UiEcheance[] }
  /** Un rappel vient de sonner. */
  | { type: 'reminder.fire'; rappel: UiRappel }
  /** Une liste affichée a changé (quelqu'un de la maison l'a écrite ou cochée) ; `liste` absente : elle n'est plus visible. */
  | { type: 'liste'; id: number; liste?: UiListe }
  /** Réponse à `push.subscribe` (à l'appareil) et nombre d'abonnés (à tous). */
  | { type: 'push.status'; info: PushInfo; ok?: boolean; message?: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' }

export type ClientMessage = Envelope & ClientPayload
export type ServerMessage = Envelope & ServerPayload

let counter = 0
function newId(): string {
  counter = (counter + 1) % 1_000_000
  return `${Date.now().toString(36)}-${counter.toString(36)}`
}

export function encode<T extends ClientPayload | ServerPayload>(payload: T): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, id: newId(), ts: Date.now(), ...payload })
}

/** Lit un message JSON ; renvoie `null` s'il est mal formé ou d'une autre version. */
export function decode<T extends ClientMessage | ServerMessage>(raw: string): T | null {
  try {
    const msg = JSON.parse(raw) as { v?: unknown; type?: unknown }
    if (msg.v !== PROTOCOL_VERSION || typeof msg.type !== 'string') return null
    return msg as T
  } catch {
    return null
  }
}

/** Float32 [-1, 1] → PCM 16 bits little-endian. */
export function floatToPcm16(samples: Float32Array): ArrayBuffer {
  const out = new DataView(new ArrayBuffer(samples.length * 2))
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0))
    out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return out.buffer
}

/** PCM 16 bits little-endian → Float32 [-1, 1]. */
export function pcm16ToFloat(bytes: ArrayBuffer): Float32Array<ArrayBuffer> {
  const view = new DataView(bytes)
  const out = new Float32Array(Math.floor(bytes.byteLength / 2))
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000
  return out
}

// ── Fin de phrase ──

/** Mots après lesquels une phrase ne s'arrête pas : liaisons, articles, prépositions, hésitations. */
const MOTS_DE_SUITE = new Set([
  'et', 'ou', 'mais', 'donc', 'car', 'or', 'ni', 'puis', 'ensuite', 'alors', 'parce', 'puisque', 'que', 'qu', 'qui', 'quand', 'lorsque',
  'si', 'comme', 'pour', 'avec', 'sans', 'de', 'd', 'du', 'des', 'le', 'la', 'les', 'l', 'un', 'une', 'au', 'aux', 'à', 'en', 'dans',
  'sur', 'sous', 'chez', 'par', 'vers', 'entre', 'depuis', 'pendant', 'avant', 'après', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes',
  'son', 'sa', 'ses', 'notre', 'nos', 'votre', 'vos', 'leur', 'leurs', 'ce', 'cet', 'cette', 'ces', 'quel', 'quelle', 'quels',
  'quelles', 'euh', 'heu', 'hum', 'bah', 'ben', 'genre', 'notamment', 'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils',
  'elles', 'me', 'te', 'se', 'est-ce', 'c', 'j', 'n', 's', 'très'
])

/**
 * La phrase dite jusqu'ici semble inachevée : elle finit sur une virgule, des points de suspension ou un mot
 * qui annonce une suite (« et », « parce que », « le », « euh »). L'assistant attend alors un peu plus avant de
 * considérer que vous avez fini (appareil et serveur).
 */
export function phraseInachevee(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false
  if (/(,|…|\.\.\.|:|-)$/.test(t)) return true
  if (/[.!?]$/.test(t)) return false
  const dernier = t.split(/[\s'’]+/).filter(Boolean).at(-1) ?? ''
  return MOTS_DE_SUITE.has(dernier.replace(/[^\p{L}-]/gu, ''))
}
