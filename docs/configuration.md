# Configuration

CODE 2.0 se règle à trois niveaux :

- les **Réglages** de l'app, propres à chaque compte (nom de l'assistant, voix, moteurs, clés…) ;
- les **variables d'environnement** du serveur, pour l'installation entière ;
- le fichier **`config/code.config.ts`**, qui donne les valeurs par défaut et les réglages fins.

Les secrets (clés API, clé maîtresse) ne vont jamais dans `config/code.config.ts`. Ils vont dans le trousseau de macOS (`npm run secrets`), dans les variables d'environnement, ou dans Réglages › Clés API.

Après un changement de variable ou de configuration, redémarrez le serveur.

## Variables d'environnement

### Réseau et adresses

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `CODE_PORT` | `8787` | Port d'écoute du serveur. |
| `CODE_HOST` | `127.0.0.1` | Adresse d'écoute. Par défaut, seule la machine elle-même joint le serveur ; l'accès distant passe par un tunnel (Tailscale) ou un proxy inverse. `0.0.0.0` écoute sur toutes les interfaces : à réserver à un conteneur ou à un proxy sur une autre machine. |
| `CODE_PUBLIC_URL` | vide | Adresse publique HTTPS d'un serveur hébergé, par exemple `https://nova.example.org`. Elle sert à associer les téléphones et au retour de Google (`…/google/retour`). Vide : serveur sur votre ordinateur. |
| `CODE_SERVER_URL` | `ws://127.0.0.1:8787/ws` | Lue par l'app de bureau : l'adresse WebSocket du serveur. À changer avec `CODE_PORT`, ou pour joindre un serveur distant (`wss://…/ws`). |

### Données

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `CODE_DATA_DIR` | dossier `code-2` du système | Dossier des données : base, jeton d'appareil, documents, réunions. Voir [Où vivent les données](installation.md#où-vivent-les-données). |
| `CODE_MEMORY_DIR` | `memory/` du dépôt | Dossier des notes de mémoire du propriétaire. |
| `CODE_MASTER_KEY` | trousseau (macOS) ou `secrets.json` | Clé maîtresse qui chiffre les secrets en base : 32 octets en base64. Voir [Où vont les secrets](installation.md#où-vont-les-secrets). |

### Moteurs et recherche web

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `CODE_OLLAMA_URL` | détection automatique | Adresse d'Ollama au format OpenAI, par exemple `http://127.0.0.1:11434/v1`. Sans elle, le serveur cherche Ollama sur la même machine au démarrage. Vide (`CODE_OLLAMA_URL=`), la détection est coupée. Voir [Modèle local](modele-local.md). |
| `CODE_SEARXNG_URL` | aucune | Adresse d'un SearXNG (format JSON activé), pour la recherche web des moteurs autres que Claude, quand la personne n'a pas de clé Brave. |
| `CODE_CATALOGUE_TARIFS` | lu | `0` : le serveur ne lit pas le catalogue public de tarifs d'OpenRouter. Un modèle sans tarif connu est alors compté au prix du modèle le plus cher, par prudence. |

### Fichiers de l'ordinateur

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `CODE_ALLOWED_FOLDERS` | `~/Desktop,~/Documents,~/Downloads` | Les seuls dossiers que l'assistant peut lire et modifier, séparés par des virgules **sans espace**. `~/` désigne votre dossier personnel. Remplace la liste de `config/code.config.ts`. |

Exemple :

```bash
CODE_ALLOWED_FOLDERS=~/Documents,~/Projets npm run dev
```

### Valeurs par défaut des comptes

Ces variables donnent la valeur de départ ; chaque personne la change ensuite pour elle.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `CODE_NOM_ASSISTANT` | `Nova` | Nom de l'assistant, tant que la personne n'en a pas choisi un. |
| `CODE_VILLE` | `Paris` | Ville de départ (météo, itinéraires). |
| `TZ` | fuseau du système | Fuseau horaire de départ. |
| `CODE_PAYS` | partout | Pays où chercher d'abord une adresse, en codes ISO séparés par des virgules (`fr,be`). |

### Voix et notifications

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `CODE_SPEAKER_MODEL` | `models/voix-titanet.onnx` | Chemin du modèle de reconnaissance du locuteur (`npm run modele-voix`). |
| `CODE_PUSH_CONTACT` | `CODE_PUBLIC_URL`, sinon une adresse d'exemple | Contact laissé aux services de notification d'Apple et de Google : une adresse `https://` ou `mailto:`. Apple refuse les adresses locales. |

### Serveur de remplacement

| Variable | Rôle |
| --- | --- |
| `CODE_TACHES_DE_FOND=0` | Coupe les tâches de fond (rappels, briefing, alertes de projets). Utile pour un second serveur lancé avant une bascule, afin que rien ne sonne en double. |

### Clés et identifiants

Le serveur lit aussi ces secrets dans l'environnement. Ils passent avant le trousseau de macOS et le fichier `secrets.json`. Ce sont les clés du **propriétaire** ; les autres comptes rangent les leurs dans Réglages › Clés API.

| Variable | Service |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude |
| `OPENAI_API_KEY` | OpenAI (moteur, voix, transcription) |
| `GEMINI_API_KEY` | Google Gemini (moteur, voix) |
| `MISTRAL_API_KEY` | Mistral (moteur, transcription) |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `OPENROUTER_API_KEY` | OpenRouter |
| `GROQ_API_KEY` | Groq (moteur, transcription) |
| `ELEVENLABS_API_KEY` | ElevenLabs (voix, transcription) |
| `DEEPGRAM_API_KEY` | Deepgram (transcription en direct, voix) |
| `BRAVE_API_KEY` | Brave Search (recherche web des moteurs autres que Claude) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Client OAuth Google. Remplacent le guide de Réglages › Connecteurs. Voir [Google](google.md). |

Les variables système `APPDATA` (Windows) et `XDG_DATA_HOME` (Linux) sont aussi lues, pour trouver le dossier de données. Les autres variables du code servent aux tests et ne sont pas décrites ici.

## Le fichier `config/code.config.ts`

Ce fichier rassemble ce qui se règle sans toucher au reste du code. Il fait partie du dépôt : une mise à jour peut le modifier, et vos changements devront alors être reportés. Pour un réglage qui a sa variable d'environnement, préférez la variable.

Les réglages utiles à connaître :

| Réglage | Défaut | Rôle |
| --- | --- | --- |
| `server.host`, `server.port`, `server.publicUrl` | `127.0.0.1`, `8787`, vide | Lus dans `CODE_HOST`, `CODE_PORT`, `CODE_PUBLIC_URL`. |
| `desktop.wakeWord.enabled` | `false` | Mot d'activation (le nom de l'assistant) écouté en continu sur l'ordinateur. Coupé par défaut : l'assistant écoute au clic sur l'orbe, ou avec ⌘⇧Espace (Ctrl+Maj+Espace hors macOS). |
| `reglages.moteurs` | Claude pour les trois usages | Moteur de départ de chaque usage (conversation, réponses rapides, tâches planifiées). Remplacé par le modèle local si Ollama est là sans clé Anthropic. |
| `reglages.transcription`, `reglages.synthese` | `auto` | Service de transcription et de voix de départ ; `auto` prend le premier disponible. |
| `reglages.briefing` | `07:30` | Heure du briefing du matin. |
| `reglages.silence` | `null` | Heures de silence de départ ; `null` : jamais. |
| `reglages.plafondJour` | `3` | Dépense par jour, en dollars, au-delà de laquelle tout passe sur le modèle rapide jusqu'à minuit. `null` : sans plafond. |
| `reglages.tutoiement` | `false` | Vouvoiement par défaut. |
| `brain.historyLimit` | `30` | Nombre de messages gardés en contexte. |
| `brain.prices` | tarifs des modèles Claude | Tarifs (dollars par million de tokens) utilisés par le compteur de dépenses. |
| `brain.web.maxSearches`, `brain.web.maxFetches` | `3`, `2` | Recherches et pages lues au plus par réponse avec Claude ; bornent le coût d'une question. |
| `brain.web.maxLibres` | `4` | Recherches au plus par réponse pour les autres moteurs. |
| `brain.compat` | adresses des fournisseurs | Adresse de chaque fournisseur au format OpenAI ; `ollama` est lu dans `CODE_OLLAMA_URL`. |
| `brain.bancDelaiMs` | `90000` | Durée au plus de chaque scénario du banc d'essai (90 s). |
| `voice.reunions.tarifs` | prix relevés en novembre 2026 | Dollars par heure d'audio, par service de transcription. Servent à choisir le service le moins cher et à afficher une estimation. |
| `voice.stt.keyterms` | vide | Noms propres à mieux reconnaître, pour toute l'installation. |
| `safety.confirmTimeoutMs` | `30000` | Délai pour répondre à une demande de validation (30 s). Passé ce délai, l'action est abandonnée. |
| `safety.acceptPhrases` | « oui », « vas-y », « je confirme »… | Les seules phrases qui valent accord. Tout le reste annule. Voir [Sécurité](securite.md). |
| `speaker.enabled`, `speaker.threshold` | `true`, `0.35` | Écoute réservée à la voix enregistrée, et ressemblance minimale avec l'empreinte. Voir [Voix](voix.md). |
| `files.allowedFolders` | `~/Desktop`, `~/Documents`, `~/Downloads` | Dossiers visibles par l'assistant ; `CODE_ALLOWED_FOLDERS` les remplace. |
| `itineraire.voiture`, `itineraire.pied` | serveurs publics OpenStreetMap | Moteur d'itinéraires OSRM ; un serveur OSRM à vous peut les remplacer. |

## `npm run secrets`

```bash
npm run secrets
```

**Sur macOS**, la commande passe en revue les clés de l'installation et indique pour chacune si elle est « déjà enregistrée » ou « absente ». Répondez `o` pour en saisir une. La valeur est demandée par l'outil `security` de macOS, de façon masquée : elle n'apparaît ni à l'écran ni dans l'historique du terminal. Les clés vont dans le trousseau, sous le service `code-2`. Redémarrez ensuite le serveur.

Les clés proposées : `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `BRAVE_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`.

**Sur Windows et Linux**, il n'y a pas de trousseau : la commande affiche seulement la liste de ces variables, à définir dans l'environnement du serveur avant de le lancer.

Dans tous les cas, ces clés sont celles du propriétaire. Chaque compte peut aussi coller les siennes dans Réglages › Clés API, sans passer par le terminal. Voir [Clés API](cles-api.md).
