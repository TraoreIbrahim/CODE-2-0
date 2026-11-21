import type { ChoixMoteur, ChoixSynthese, ChoixTranscription, OrbeId, ProfilId, QualiteVoix, RoleMoteur, ThemeId, WidgetPlace } from '@code/protocol'

/**
 * Configuration de l'installation : tout ce qui se règle sans toucher au code. Chaque personne change
 * ensuite ses propres réglages (assistant de premier lancement, Réglages).
 * Les secrets (clés API, jeton d'appareil) n'ont rien à faire ici : ils vivent dans le trousseau du
 * système (`npm run secrets`) ou dans les variables d'environnement du serveur.
 */
export const codeConfig = {
  server: {
    /** Écoute uniquement en local ; l'accès distant passe par un tunnel (`tailscale serve`…). Hébergé (Docker) : CODE_HOST=0.0.0.0. */
    host: process.env.CODE_HOST || '127.0.0.1',
    /** Port d'écoute ; CODE_PORT le remplace. */
    port: Number(process.env.CODE_PORT) || 8787,
    /**
     * Adresse publique HTTPS quand le serveur est hébergé (VPS, Docker) plutôt que sur l'ordinateur : elle
     * sert à associer un téléphone. Vide : serveur sur l'ordinateur.
     */
    publicUrl: (process.env.CODE_PUBLIC_URL ?? '').replace(/\/$/, '')
  },

  /** L'app de bureau : le serveur auquel elle se connecte (WebSocket). */
  desktop: {
    serverUrl: process.env.CODE_SERVER_URL || 'ws://127.0.0.1:8787/ws',
    /**
     * Mot d'activation (le nom de l'assistant), écouté en continu sur l'ordinateur ; rien ne part au serveur
     * avant le mot. Coupé par défaut : l'assistant écoute au clic sur l'orbe (ou ⌘⇧Espace). `threshold` :
     * plus bas, il réagit plus souvent (et se trompe plus).
     */
    wakeWord: { enabled: false, threshold: 0.15, boost: 1 }
  },

  /**
   * Réglages de chaque utilisateur : valeurs par défaut. Chacun les change pour lui (assistant de premier
   * lancement, Réglages) ; seule la différence est gardée en base.
   */
  reglages: {
    /** Le nom de l'assistant : celui de l'installation, jusqu'à ce que chacun choisisse le sien (`NOM_ASSISTANT_DEFAUT`). */
    nomAssistant: process.env.CODE_NOM_ASSISTANT || 'Nova',
    /** Profil d'usage (`PROFILS` du protocole). */
    profil: 'general' as ProfilId,
    /** Comment l'assistant appelle la personne ; vide : son nom de famille. */
    appellation: '',
    /** Vouvoiement par défaut. */
    tutoiement: false,
    /** Couleur principale de l'orbe et des interfaces (`THEMES` du protocole). */
    theme: 'cyan' as ThemeId,
    /** Forme de l'orbe (`ORBES` du protocole). */
    orbe: 'nebule' as OrbeId,
    /** Moteur de chaque usage ; chacun change les siens dans Réglages › Moteurs (avec ses propres clés). */
    moteurs: {
      principal: { fournisseur: 'anthropic', modele: 'claude-opus-5-5' },
      rapide: { fournisseur: 'anthropic', modele: 'claude-haiku-5-5' },
      taches: { fournisseur: 'anthropic', modele: 'claude-opus-5-5' }
    } as Record<RoleMoteur, ChoixMoteur>,
    /** Voix de l'assistant (une de `voice.tts.choix`) et vitesse de lecture (0,8 à 1,2). */
    voix: 'onwK4e9ZLuTAKqWW03F9',
    vitesseVoix: 1,
    /** Modèle ElevenLabs : `rapide` (Flash, réponse immédiate) ou `naturelle` (plus réaliste, un peu plus lente). */
    qualiteVoix: 'rapide' as QualiteVoix,
    /** Qui transcrit et qui parle (Réglages › Voix) ; `auto` : le premier disponible avec les clés de chacun. */
    transcription: 'auto' as ChoixTranscription,
    synthese: 'auto' as ChoixSynthese,
    /** Heure du briefing du matin (HH:MM). */
    briefing: '07:30',
    /** Absence (minutes) au-delà de laquelle l'assistant fait le point au retour. */
    retourApresMinutes: 60,
    /** Heures de silence (aucune annonce ni notification, sauf alerte grave) ; `null` : jamais. */
    silence: null as { de: string; a: string } | null,
    /** Notifications sur le téléphone. */
    notifications: true,
    /** Ville (météo, itinéraires) et fuseau horaire : par défaut ceux du serveur, changés au premier lancement. */
    ville: process.env.CODE_VILLE || 'Paris',
    fuseau: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    /**
     * Cartes du cockpit : celles du profil « Usage général » (`PROFIL_DETAILS`, vérifié par les tests) ; la
     * météo et l'agenda à gauche, les mails et les tâches à droite.
     */
    widgets: [
      { id: 'meteo', colonne: 'gauche', visible: true },
      { id: 'aujourdhui', colonne: 'gauche', visible: true },
      { id: 'rappels', colonne: 'gauche', visible: true },
      { id: 'mails', colonne: 'droite', visible: true },
      { id: 'taches', colonne: 'droite', visible: true },
      { id: 'echeances', colonne: 'droite', visible: false }
    ] as WidgetPlace[],
    /** Dépense par jour (dollars) au-delà de laquelle tout passe sur le modèle rapide ; `null` : sans plafond. */
    plafondJour: 3 as number | null,
    /** Écran simplifié (tout à la voix) : non par défaut. */
    ecranSimple: false,
    /** Proposer d'enregistrer une réunion en visio de l'agenda, à l'heure où elle commence. */
    reunionsAgenda: true
  },


  /**
   * Itinéraires : moteur OSRM (OpenStreetMap), sans circulation ; la navigation se fait dans Google Maps.
   * Serveurs publics de FOSSGIS par défaut (usage modéré) ; un serveur OSRM à soi peut les remplacer.
   */
  itineraire: {
    voiture: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
    pied: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
    /** Attente de la position de l'appareil (secondes) avant de renoncer au trajet. */
    attentePosition: 15
  },

  brain: {
    /**
     * Tarif de prudence : un modèle dont le prix est inconnu est compté à celui-ci. Les modèles de chacun se
     * choisissent dans `reglages.moteurs`.
     */
    deep: 'claude-opus-5-5',
    /** `auto` choisit selon la demande (conversation ou réponse rapide) ; `deep` ou `fast` force l'un des deux. */
    routing: 'auto' as 'auto' | 'deep' | 'fast',
    /** Effort de réflexion pour la voix : bas = réponse plus rapide. */
    effort: { deep: 'low', fast: 'low' } as const,
    /** Effort des tâches planifiées : personne n'attend, la qualité prime. */
    taskEffort: 'medium' as const,
    /** Nombre de messages gardés en contexte. */
    historyLimit: 30,
    /**
     * Tarifs (dollars par million de tokens) pour le compteur. `cacheWrite` : écriture du cache 5 minutes
     * (1,25 × l'entrée). Modèle absent de la liste (repli serveur imprévu) : compté au tarif d'Opus.
     */
    prices: {
      'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      // Modèles de repli possibles (fallbacks: 'default') quand Opus décline.
      'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }
    } as Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>,
    /**
     * Web : recherche et lecture de pages, par les outils serveur de Claude. Une recherche coûte 0,01 $
     * (10 $ les 1 000) en plus des tokens des résultats ; la lecture d'une page ne coûte que ses tokens.
     */
    web: {
      enabled: true,
      /**
       * Recherches et pages lues au plus par réponse : borne le coût d'une question (une question web coûte
       * environ 0,18 $ sur le modèle puissant, 0,03 $ sur le rapide) : les questions web courtes restent au
       * modèle rapide, qui n'a que la recherche (2 au plus).
       */
      maxSearches: 3,
      maxFetches: 2,
      /** Tokens au plus par page lue (une page longue est tronquée). */
      maxPageTokens: 12_000,
      searchPrice: 0.01,
      /**
       * Recherche web des autres moteurs (tous sauf Claude) : Brave Search avec la clé de la personne
       * (BRAVE_API_KEY), sinon un SearXNG auto-hébergé, sans clé, pour toute l'installation.
       */
      searxng: process.env.CODE_SEARXNG_URL || null,
      /** Recherches au plus par réponse pour ces moteurs, et caractères au plus d'une page lue. */
      maxLibres: 4,
      maxPageChars: 24_000
    },
    /**
     * Moteurs au format d'OpenAI (Chat Completions) : adresse de chaque fournisseur. Ollama tourne sur une
     * machine de l'installation : `CODE_OLLAMA_URL` (par exemple http://localhost:11434/v1) ; absent, il
     * n'est pas proposé.
     */
    compat: {
      openai: 'https://api.openai.com/v1',
      gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
      mistral: 'https://api.mistral.ai/v1',
      deepseek: 'https://api.deepseek.com/v1',
      openrouter: 'https://openrouter.ai/api/v1',
      groq: 'https://api.groq.com/openai/v1',
      ollama: process.env.CODE_OLLAMA_URL || null
    },
    /**
     * Tarifs des modèles absents de `prices` : le catalogue public d'OpenRouter (prix par token de chaque
     * modèle, relu une fois par jour, sans clé ni donnée personnelle). `null` : pas de catalogue ; un modèle
     * inconnu est alors compté au tarif du modèle puissant, par prudence (Ollama : gratuit).
     */
    catalogueTarifs: process.env.CODE_CATALOGUE_TARIFS === '0' ? null : 'https://openrouter.ai/api/v1/models',
    /** Scénarios du banc d'essai : durée au plus de chacun. */
    bancDelaiMs: 90_000
  },

  voice: {
    /**
     * Après chaque réponse, le micro reste ouvert `relanceMs` pour enchaîner ; 0 : il se referme dès la fin
     * de la réponse (sinon il capte les voix et les vidéos autour), et l'on reparle en touchant l'orbe.
     * Le mode conversation, activé et coupé par la personne (bouton ou « passe en mode conversation »,
     * « arrête d'écouter »), garde le micro ouvert jusqu'à `conversationSilenceMs` sans sa voix, ou jusqu'à la
     * mise en veille de l'ordinateur. Il demande une empreinte vocale : sans elle, l'assistant répondrait à
     * toutes les voix de la pièce. Seule la parole détectée part au serveur.
     */
    ecoute: { relanceMs: 0, conversationSilenceMs: 5 * 60_000 },
    /**
     * Réunions : l'appareil découpe l'audio en morceaux (16 kHz mono), coupés à une pause après `segmentS`
     * secondes et d'office à `segmentMaxS` ; le serveur les transcrit un par un avec le service le moins
     * cher dont la personne a la clé. `tarifs` : dollars par heure d'audio, prix publics relevés en
     * novembre 2026 (à ajuster ici s'ils changent) ; ils ne servent qu'à choisir et à afficher une estimation.
     */
    reunions: {
      segmentS: 120,
      segmentMaxS: 150,
      /** Durée la plus longue d'une réunion (enregistrée ou importée). */
      dureeMaxS: 4 * 3600,
      tarifs: { groq: 0.04, mistral: 0.18, openai: 0.18, elevenlabs: 0.22, deepgram: 0.26 },
      /** Modèles pour un long enregistrement, quand ils diffèrent de ceux de la voix (moins chers). */
      modeles: { openai: 'gpt-4o-mini-transcribe' }
    },
    stt: {
      // Le service de chacun se choisit dans Réglages › Voix (`reglages.transcription`) ; ici, les modèles.
      scribeModel: 'scribe_v2',
      deepgramModel: 'nova-3',
      groqModel: 'whisper-large-v3-turbo',
      mistralModel: 'voxtral-mini-latest',
      openaiModel: 'gpt-4o-transcribe',
      language: 'fr',
      /** Noms propres à mieux reconnaître, après le lexique de chacun (les mots qu'il a corrigés). */
      keyterms: [] as string[],
      vocabulaire: {
        /** Scribe (phrase finale) : 1 000 au plus, moins de 50 caractères et 5 mots chacun. Au-delà de 100, Scribe facture 20 s minimum par phrase (+20 % avec mots-clés). */
        scribeMax: 1000,
        /** Deepgram (texte en direct) : les plus utiles seulement, sous sa limite de 500 jetons par requête. */
        deepgramMax: 50,
        deepgramJetons: 450
      }
    },
    tts: {
      // Le service de chacun se choisit dans Réglages › Voix (`reglages.synthese`) ; ici, les modèles et les voix.
      // Voix par défaut des réglages. Les voix du compte sont listées au démarrage du serveur si celle-ci est introuvable.
      elevenlabsVoiceId: 'onwK4e9ZLuTAKqWW03F9',
      elevenlabsModel: 'eleven_flash_v2_5',
      /** Qualité « naturelle » : le modèle le plus réaliste en français, au prix d'un démarrage plus lent. */
      elevenlabsModelNaturel: 'eleven_multilingual_v2',
      openaiModel: 'gpt-4o-mini-tts',
      openaiVoice: 'onyx',
      /** Deepgram Aura : le modèle porte la voix (`aura-2-{voix}-fr`). */
      deepgramVoice: 'aura-2-hector-fr',
      geminiModel: 'gemini-2.5-flash-preview-tts',
      geminiVoice: 'Charon',
      /**
       * Voix proposées à chacun (assistant de premier lancement, Réglages) : la voix ElevenLabs, et la plus
       * proche chez OpenAI, Deepgram et Gemini quand la synthèse passe par eux.
       */
      choix: [
        { id: 'onwK4e9ZLuTAKqWW03F9', nom: 'Daniel', description: 'Grave et calme, celle d’un présentateur.', openai: 'onyx', deepgram: 'aura-2-hector-fr', gemini: 'Charon' },
        { id: 'XB0fDUnXU5powFXDhCwa', nom: 'Charlotte', description: 'Claire et chaleureuse.', openai: 'nova', deepgram: 'aura-2-agathe-fr', gemini: 'Sulafat' },
        { id: 'EXAVITQu4vr4xnSDxMaL', nom: 'Sarah', description: 'Douce, un peu feutrée.', openai: 'shimmer', deepgram: 'aura-2-agathe-fr', gemini: 'Achernar' },
        { id: 'TX3LPaxmHKxFdv7VOQHJ', nom: 'Liam', description: 'Jeune et vive.', openai: 'ash', deepgram: 'aura-2-hector-fr', gemini: 'Puck' },
        { id: 'pFZP5JQG7iQjIQuC4Bku', nom: 'Lily', description: 'Posée, avec un léger accent britannique.', openai: 'echo', deepgram: 'aura-2-agathe-fr', gemini: 'Vindemiatrix' },
        { id: 'Xy5q4w05TJGcKXPWeWoz', nom: 'Max', description: 'Chaleureuse, calme et charismatique.', openai: 'ballad', deepgram: 'aura-2-hector-fr', gemini: 'Achird' },
        { id: 'j1qkMM79X5JLC4ZM86vA', nom: 'Hugo', description: 'Dynamique et sérieuse.', openai: 'verse', deepgram: 'aura-2-hector-fr', gemini: 'Orus' },
        { id: '3BZLNrQEzQVYs6kPOW4S', nom: 'Justin', description: 'Calme et posée.', openai: 'alloy', deepgram: 'aura-2-hector-fr', gemini: 'Schedar' },
        { id: '3C1zYzXNXNzrB66ON8rj', nom: 'Jade', description: 'Vive et rassurante.', openai: 'coral', deepgram: 'aura-2-agathe-fr', gemini: 'Laomedeia' },
        { id: 'TTtB1x9U8PF0Vgf20IAP', nom: 'Adrien', description: 'Grave et réconfortante.', openai: 'onyx', deepgram: 'aura-2-hector-fr', gemini: 'Algenib' }
      ]
    }
  },

  safety: {
    /** Délai pour répondre à une demande de validation. */
    confirmTimeoutMs: 30_000,
    /** Phrases qui valent accord (comparées sans accents ni ponctuation). Tout le reste annule. */
    acceptPhrases: [
      'oui',
      'oui envoie',
      'oui vas y',
      'oui confirme',
      'oui je confirme',
      'vas y',
      'confirme',
      'je confirme',
      'envoie',
      'envoie le',
      'envoie la',
      'oui envoie le',
      'oui envoie la',
      'vas y envoie',
      'valide',
      'je valide',
      'oui valide',
      'oui je valide',
      'c est bon',
      'oui c est bon',
      'c est parfait',
      'parfait',
      'parfait envoie',
      'ok',
      'oui ok',
      'ok envoie',
      'ok vas y',
      'd accord',
      'oui d accord',
      'oui oui',
      'ca marche',
      'oui ca marche',
      'tu peux envoyer',
      'oui tu peux envoyer',
      'tu peux l envoyer',
      'oui tu peux l envoyer',
      'envoie le message',
      'oui envoie le message',
      'c est ok',
      'oui c est ok',
      'vous pouvez envoyer',
      'tu peux y aller',
      'exactement'
    ]
  },

  speaker: {
    /** N'écouter que la voix enregistrée (sherpa-onnx, sur le serveur). Sans empreinte, tout le monde est écouté. */
    enabled: true,
    /**
     * Ressemblance minimale avec l'empreinte (-1..1), pour TitaNet large. Mesuré dans le bruit d'une pièce
     * animée : les phrases de 4 s du propriétaire de l'empreinte ne sont pas descendues sous 0,39 (médiane
     * 0,68), les autres voix n'ont pas dépassé 0,29. Le score de chaque phrase s'affiche dans le journal.
     */
    threshold: 0.35,
    /** Une phrase trop courte pour être jugée (« oui ») est acceptée si votre voix a été reconnue depuis moins que ce délai. */
    trustWindowMs: 60_000,
    /**
     * Seuil d'une phrase jugée d'un bloc quand votre voix a été reconnue depuis moins de `trustWindowMs` : la
     * suite d'une conversation. Sans lui, une réplique dite un peu plus bas ou plus vite (0,30 à 0,34) était
     * refusée juste après une réponse ; les autres voix mesurées ne dépassaient pas 0,29.
     */
    seuilRecent: 0.3,
    /**
     * Suivi de la voix pendant la phrase : toutes les 0,5 s, la dernière 1,5 s est comparée aux empreintes (une
     * par appareil, la plus proche compte). La phrase commence à votre voix (`windowThreshold`), continue tant
     * qu'elle reste reconnue, avec un seuil plus bas (`continueThreshold`), et finit quand elle se tait, même si
     * d'autres parlent encore ; seuls vos passages sont transcrits. Sans votre voix pendant `giveUpMs`,
     * l'assistant cesse d'écouter. Après un appel exprès (mot d'activation, orbe), la phrase est acceptée sans
     * attendre votre voix : dans un grand bruit, elle n'atteint pas toujours `windowThreshold` ; elle finit au
     * plus tard après `calledMaxMs`. Le sens décide de la fin (voice/fin-de-tour.ts) : une demande complète finit
     * après `endFiniMs`, une phrase au milieu (« … parce que », « euh ») attend `endMaxMs`, une phrase pas encore
     * jugée `endMs`.
     */
    turn: { windowThreshold: 0.38, continueThreshold: 0.33, endMs: 2_500, endFiniMs: 1_200, endMaxMs: 6_000, giveUpMs: 8_000, calledMaxMs: 60_000 }
  },

  files: {
    /** Seuls ces dossiers sont visibles par l'assistant. */
    allowedFolders: ['~/Desktop', '~/Documents', '~/Downloads']
  },

  push: {
    /**
     * Contact laissé aux services de notification (Apple, Google) dans la signature VAPID : une adresse
     * https:// ou mailto:. Apple refuse les adresses locales.
     */
    subject: process.env.CODE_PUSH_CONTACT || (process.env.CODE_PUBLIC_URL ?? '') || 'mailto:assistant@example.com'
  }
}

export type CodeConfig = typeof codeConfig
