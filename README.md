# CODE 2.0

Un assistant vocal personnel, libre et auto-hébergé. On lui parle, il répond à voix haute, et il agit : mails, agenda, rappels, échéances, fichiers, itinéraires, recherches. Vous lui donnez le nom que vous voulez : il s'appelle Nova tant que vous n'en avez pas choisi un autre, et c'est ce nom que montrent les écrans. CODE 2.0 est le nom de l'app.

> **En construction.** Les étapes 0 à 6 de la [feuille de route](docs/FEUILLE-DE-ROUTE.md) tournent : serveur, app de bureau et app téléphone, plusieurs comptes par installation, le moteur et la voix de votre choix, les connecteurs et les profils. Restent les installateurs et Docker ; d'ici là, CODE 2.0 se lance depuis les sources (voir [Démarrer](#démarrer) et la [documentation](docs/README.md)).

## Principes

- **La voix d'abord.** L'écran montre ce que l'assistant fait ; on ne tape presque jamais.
- **Il prépare, vous décidez.** Lire et préparer est libre ; envoyer, supprimer ou modifier attend un « oui » clair, décidé par une règle fixe et jamais par le modèle.
- **Chez vous.** Chacun héberge son serveur (Mac, PC, mini-PC, VPS, Docker). Vos données et vos clés restent sur votre machine.
- **Le modèle de votre choix.** Claude, OpenAI, Gemini, Mistral, un modèle local… Ajoutez vos propres clés API, autant que vous voulez, et changez de moteur quand vous le souhaitez. Même chose pour la voix.
- **Pour tous les quotidiens.** Au premier lancement, un profil (développeur, secrétariat, administration, foyer) règle les outils, le briefing et l'écran.

## Plateformes

- Serveur : Node.js 24, sur macOS, Windows, Linux ou Docker.
- App de bureau : macOS, Windows, Linux (Electron).
- Téléphone : web app installable (iPhone et Android).

## Clés API, pas abonnements

Un abonnement grand public (ChatGPT Plus, Claude Pro…) ne donne pas accès à l'API pour une application tierce. CODE 2.0 a besoin de **clés API**, facturées à l'usage par chaque fournisseur, ou d'un modèle local (gratuit, moins performant).

**Sans aucune clé**, CODE 2.0 tourne avec un modèle local : installez [Ollama](https://ollama.com) et un modèle (`ollama pull qwen3:8b`), le serveur le trouve au démarrage et s'en sert par défaut. L'assistant répond alors par écrit (la voix reste un service en ligne). Voir [Modèle local](docs/modele-local.md).

## Démarrer

Il faut [Node.js 24](https://nodejs.org) et une clé API au moins (voir ci-dessus).

```bash
npm install
npm run dev
```

`npm run dev` lance le serveur (port 8787, `CODE_PORT` pour en changer) et l'app de bureau. Au premier lancement, l'app crée le compte du propriétaire et pose quelques questions : le nom de l'assistant, comment il vous appelle, votre profil, votre ville. Les clés API se rangent ensuite dans Réglages › Clés API.

- Le téléphone : `npm run build` prépare la web app, que le serveur sert lui-même. Dans l'app de bureau, Réglages › Habitudes › « Associer un téléphone » affiche un QR code à scanner. Le téléphone doit joindre le serveur en HTTPS : par l'adresse publique d'un serveur hébergé (`CODE_PUBLIC_URL`), ou par [Tailscale](https://tailscale.com) quand le serveur tourne sur votre ordinateur ; l'écran d'association indique l'étape qui manque.
- Le serveur seul (mini-PC, VPS) : `npm run start:server`.
- L'écoute réservée à votre voix : `npm run modele-voix` télécharge le modèle de reconnaissance du locuteur.
- Les vérifications : `npm test`, `npm run typecheck`, `npm run build`.

## Moteurs

Dans Réglages › Moteurs, chacun choisit un fournisseur et un modèle pour trois usages : la conversation, les réponses rapides (et la fin des phrases, les notes, le briefing), les tâches planifiées.

- **Claude** (Anthropic) en natif : recherche web intégrée, recherche d'outils côté API.
- **Format OpenAI** : OpenAI, Google Gemini, Mistral, DeepSeek, Groq, OpenRouter, et Ollama sur votre machine. La recherche d'outils se fait sur le serveur ; la recherche web passe par une clé [Brave Search](https://api-dashboard.search.brave.com) de la personne ou par un SearXNG de l'installation.
- La liste des modèles se lit chez le fournisseur, avec votre clé ; le compteur de dépenses prend les tarifs de la configuration, sinon ceux du catalogue public d'OpenRouter (relu chaque jour), sinon le tarif du modèle le plus cher, par prudence.
- **Banc d'essai** : « Tester » pose sept demandes types (rappel, météo, mémoire, enchaînement, recherche d'outils, web…) avec des outils simulés, rien n'est créé. Verdict : « testé » (tout passe), « limité » (au moins la moitié), « échec ». Il coûte quelques centimes, sur la clé de la personne.

## Voix

Dans Réglages › Sa voix, chacun choisit qui transcrit ce qu'il dit et qui parle pour l'assistant, avec ses propres clés. « Automatique » (par défaut) prend le premier service disponible.

- **Transcription** : ElevenLabs Scribe (le plus juste en français), Deepgram (le plus rapide), Groq Whisper, Mistral Voxtral, OpenAI. Avec une clé Deepgram, le texte s'écrit aussi en direct pendant que vous parlez, quel que soit le service qui écrit la phrase finale.
- **Synthèse** : ElevenLabs, OpenAI, Deepgram Aura, Google Gemini. La voix choisie (Daniel, Jade…) garde son caractère d'un service à l'autre : chacun prend sa voix la plus proche.
- Avec une clé ElevenLabs : les voix de votre compte (clonées ou ajoutées) sont proposées en premier, et une bibliothèque de voix françaises se parcourt avec un extrait à écouter. Deux rendus : « Rapide » ou « Naturelle ».
- Un service choisi sans sa clé reste choisi ; l'automatique le remplace en attendant, et l'écran le dit. Sans aucune clé de voix, l'assistant répond par écrit.

Réglages de l'installation (variables d'environnement) :

| Variable | Rôle |
| --- | --- |
| `CODE_OLLAMA_URL` | Adresse d'Ollama au format OpenAI (`http://…:11434/v1`). Sans elle, un Ollama de la même machine est détecté au démarrage ; vide (`CODE_OLLAMA_URL=`), Ollama n'est pas proposé. |
| `CODE_SEARXNG_URL` | Un SearXNG (format JSON activé) pour la recherche web des moteurs autres que Claude, à défaut d'une clé Brave. |
| `CODE_CATALOGUE_TARIFS=0` | Ne lit pas le catalogue de tarifs d'OpenRouter. |

## Connecteurs

Dans Réglages › Connecteurs, chacun relie ses propres comptes ; rien n'est partagé entre les comptes de l'installation.

- **Google** (Gmail, Agenda, Drive, Sheets, Contacts) : le propriétaire relie l'installation une fois, avec un client OAuth de son propre projet Google Cloud (gratuit). Un guide en cinq étapes, avec les liens directs vers la console, se termine par le collage de l'ID client et du code secret, vérifiés auprès de Google. Ensuite, chacun connecte son compte Google. Tant que le projet reste en mode test, Google coupe l'accès au bout de 7 jours : l'assistant prévient la veille. Les personnes de l'installation doivent figurer parmi les utilisateurs test du projet.
  - Serveur sur l'ordinateur : client « Application de bureau », connexion depuis l'app de bureau.
  - Serveur hébergé (`CODE_PUBLIC_URL`) : client « Application Web », avec l'adresse de retour affichée par le guide (`…/google/retour`), connexion depuis n'importe quel appareil.
  - `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans l'environnement du serveur remplacent le guide.
  - Au-delà de la lecture : lire une pièce jointe (PDF, image, tableur, Word) et en joindre une depuis le Drive, l'ordinateur ou un autre mail ; chercher un contact ; annuler un rendez-vous ; écrire dans un tableur existant. Tout ce qui envoie ou modifie attend un « oui ».
- **Boîtes mail** IMAP (adresse pro, Yahoo, iCloud, OVHcloud…) : adresse et mot de passe (d'application si le fournisseur l'exige), serveurs devinés. Outlook et Hotmail demandent une connexion Microsoft, pas encore prise en charge.
- **Météo et itinéraires** : sans clé (OpenStreetMap, MET Norway).
- **Serveurs MCP** : GitHub, Notion, Linear, Sentry, Supabase… ou n'importe quel serveur par son adresse, avec un jeton ou une connexion OAuth (qui revient sur le serveur lui-même, hébergé ou non).
- **La maison** (Home Assistant) : l'adresse de l'installation et un jeton d'accès longue durée (profil › Sécurité). L'assistant allume, éteint et règle lumières, clim, ventilateurs, volets et télé, et lit l'état de chaque pièce. Il affiche aussi l'image d'une caméra, qui n'est gardée nulle part. Serrures, alarme, portails, vannes, sirènes et scripts attendent un « oui ». Sur l'écran « Maison », un toucher allume ou éteint un appareil. Les appareils à télécommande infrarouge passent par un émetteur (Broadlink, SwitchBot), les plus simples par une prise connectée. Un serveur hébergé hors de chez soi atteint Home Assistant par son adresse publique (Nabu Casa, par exemple).

## Au quotidien

- **Rappels et tâches planifiées.** Un rappel sonne à l'heure dite, sur les écrans et le téléphone. Une tâche planifiée fait un travail seule, à heure fixe (« chaque vendredi soir, fais le bilan de la semaine »), et rend un résultat écrit. Elle lit et prépare ; elle n'envoie ni ne modifie jamais rien seule.
- **Papiers.** Photographiez un document depuis le téléphone, ou joignez un PDF : l'assistant le lit, le range (titre, classement, émetteur) et note son échéance s'il en a une. « Retrouve ma facture d'électricité » le ressort. Avec Google relié, le fichier va dans votre Drive ; sinon il reste sur votre serveur.
- **Listes.** Courses, choses à faire : remplies et cochées à la voix ou d'un toucher. Une liste est privée, pour toute la maison ou pour quelques personnes, et se met à jour en direct chez chacun.
- **Rappels pour les autres.** « Rappelle à Léa de… » : le rappel sonne chez elle, de votre part. Il faut que la personne ait un compte sur l'installation.
- **Mémoire.** Ce que vous demandez de retenir, et ce que l'assistant apprend de vos conversations, tient dans des notes en texte simple, relues à chaque échange.

## Réunions

L'assistant n'assiste pas aux réunions : un appareil les enregistre, le serveur les transcrit, et l'assistant travaille ensuite sur le texte.

- **Enregistrer.** Le bouton « Réunion » de l'app (ordinateur ou téléphone), ou « enregistre la réunion ». Un bandeau rouge reste à l'écran tant que le micro tourne ; « Terminer » l'arrête. Prévenez les personnes présentes qu'elles sont enregistrées.
- **Toujours visible.** Sur l'ordinateur, la miniature passe en état « en réunion » (liseré rouge, chrono, bouton pour terminer) tant que l'enregistrement dure, même fenêtre de l'app fermée.
- **En visio.** L'app de bureau capte aussi le son de l'ordinateur (ce que jouent Zoom, Meet, Teams), mêlé au micro : les personnes à distance sont transcrites même avec un casque. macOS demande une autorisation, dans Réglages Système › Confidentialité et sécurité › Enregistrement de l'écran et de l'audio système ; sans elle, le bandeau indique « micro seul ». Le téléphone n'enregistre que son micro.
- **Proposé par l'agenda.** Quand une réunion en visio de votre Google Agenda commence, l'assistant propose de l'enregistrer (une carte, et de vive voix s'il est disponible). Rien ne s'enregistre sans votre réponse ; l'option se coupe dans Réglages › Habitudes. Un appel improvisé, hors agenda, n'est pas détecté.
- **Importer.** Un fichier audio (MP3, M4A, WAV…) se joint avec le trombone : il est transcrit de la même façon.
- **Le rapport.** « Fais le rapport » : l'assistant lit la réunion et remplit sa fiche, avec l'essentiel, les décisions, les actions regroupées par personne et les points restés ouverts. Depuis la fiche : un rappel par action, un document sur le Drive, un mail aux participants. L'onglet « Transcription » garde le texte horodaté, avec une recherche qui montre à quels moments un sujet a été abordé. Avec la compétence « Compte rendu de réunion », il suit votre méthode.
- **Pendant l'enregistrement.** L'assistant se tait : l'écoute continue se coupe, il ne répond que si vous touchez l'orbe, et sa voix n'entre pas dans la transcription. « Pause » suspend la capture (bandeau, miniature, ou « mets en pause »).
- **Le coût.** L'audio part par morceaux de deux minutes au service de transcription le moins cher dont vous avez la clé. Prix publics relevés en novembre 2026, par heure d'audio : Groq Whisper environ 0,04 $, OpenAI et Mistral 0,18 $, ElevenLabs 0,22 $, Deepgram 0,26 $ (`config/code.config.ts` pour les ajuster). Les silences ne sont pas envoyés. L'estimation s'affiche sur la fiche de la réunion. Le compte rendu, lui, coûte un échange avec votre moteur.
- **Ce qui est gardé.** Le texte, sur votre serveur. L'audio est effacé dès qu'il est transcrit.
- **Limites.** La transcription ne dit pas qui parle et peut déformer un nom propre. Quatre heures au plus par réunion. Sur un téléphone, l'écran doit rester allumé pendant l'enregistrement, et un fichier importé ne doit pas dépasser 80 Mo (500 Mo sur l'ordinateur). Lancée depuis les sources (`npm run dev`), l'app de bureau hérite des autorisations du terminal qui la lance : c'est lui qu'il faut autoriser pour le son de l'ordinateur.

## Compétences

Une compétence est une méthode écrite en texte simple : « comment je veux mes comptes rendus », « relancer une facture », « préparer un déplacement ». C'est un fichier Markdown, avec un nom et une phrase qui dit quand s'en servir, puis la méthode.

- L'assistant ne lit que la liste (nom et description) ; il ouvre la méthode quand une demande y correspond. Cent compétences coûtent une ligne chacune par échange.
- On les écrit dans Réglages › Compétences, on part d'un modèle livré (`config/competences/`), on importe un fichier `.md` ou `.txt`, ou on les dicte : « apprends à préparer mes comptes rendus : … ». Une compétence apprise ou oubliée de vive voix attend un « oui ».
- Le format reprend celui des skills de Claude (`name` et `description` en tête d'un `SKILL.md`) : un fichier écrit pour l'un s'importe dans l'autre.
- Chaque compte a son dossier, `competences/<numéro du compte>/` dans le dossier de données du serveur. On peut aussi y déposer ou modifier les fichiers avec n'importe quel éditeur de texte.
- Une compétence dit comment faire, pas ce qui est permis : envoyer, supprimer ou modifier attend toujours votre accord.

## Profils

Choisi au premier lancement, changeable dans Réglages › Assistant. Chaque profil règle :

- les **consignes** de l'assistant (ton, rigueur, ce qu'il signale) ;
- les **outils sous la main**, décrits au moteur à chaque échange ; les autres restent trouvables par la recherche d'outils ;
- les **cartes** de l'écran, tant que la personne ne les a pas rangées elle-même ;
- le **briefing du matin**.

| Profil | Sous la main | Briefing |
|---|---|---|
| Usage général | mails, agenda, rappels, tâches, fichiers | agenda, mails, rappels |
| Développeur | état des projets (GitHub, Vercel, Expo), fichiers, tâches | agenda, projets, mails, tâches |
| Secrétariat | brouillons, disponibilités, rendez-vous, relances, Drive | agenda, demain, mails, rappels |
| Administration | Drive et tableaux de suivi, échéances, tâches | échéances, agenda, mails, tâches |
| Foyer | rappels, agenda, factures et papiers à renouveler, météo, trajets | météo, agenda, échéances, rappels |

L'**échéancier** (administration et foyer) note ce qui tombe à date fixe : factures, loyer, impôts, assurances, abonnements, papiers à renouveler. Chaque échéance a son rappel, quelques jours avant à 9 h ; une échéance qui revient (loyer, abonnement) se recrée d'elle-même une fois cochée « réglée ». L'assistant ne paie jamais rien : il note, prévient et coche sur votre parole.

L'**écran simplifié** (même endroit) sert un usage tout à la voix, sur l'ordinateur comme sur le téléphone. Il montre l'heure en grand, l'orbe à toucher et le dernier échange en sous-titres. Les actions à valider et les rappels s'y répondent avec de grands boutons.

## Comptes

- Le premier compte, le **propriétaire**, est créé au premier démarrage ; il invite les autres depuis Réglages › Comptes (un code ou un lien, valable sept jours, une seule fois).
- Chaque compte a ses données, son assistant (nom, profil, voix) et **ses propres clés API**, rangées dans Réglages › Clés API. Les clés du serveur (`npm run secrets` ou variables d'environnement) ne servent qu'au propriétaire.
- Les clés et les accès sont chiffrés en base avec une clé maîtresse : le trousseau sur macOS, sinon `CODE_MASTER_KEY` (32 octets en base64) ou, à défaut, un fichier `secrets.json` du dossier de données (à sauvegarder avec la base).

## Contribuer

Les contributions sont les bienvenues, par pull request, relue et validée par le mainteneur : voir [CONTRIBUTING.md](CONTRIBUTING.md). Une faille se signale en privé : voir [SECURITY.md](SECURITY.md).

Avant chaque push, la vérification de publication refuse les secrets, les adresses IP publiques et les fichiers personnels, dans tout l'historique :

```bash
npm run verifier
```

L'icône de l'app est l'orbe « Onde » de l'assistant, avec son regard. Elle se régénère, en SVG et en PNG pour le téléphone et le bureau, avec :

```bash
npm run icones
```

## Licence

Copyright © 2026 [Ibra Code](https://ibracode.com).

[GNU AGPL-3.0](LICENSE). Si vous proposez une version modifiée de CODE 2.0 comme service en ligne, vous devez en publier le code source.
