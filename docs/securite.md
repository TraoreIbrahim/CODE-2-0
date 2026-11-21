# Sécurité

Cette page décrit le modèle de sécurité de CODE 2.0 tel que le code l'applique : ce que l'assistant fait seul, ce qui attend votre accord, et comment vos données et vos clés sont protégées.

## Il prépare, vous décidez

Chaque outil de l'assistant appartient à l'une de trois catégories :

- **lecture** : lire vos mails, votre agenda, vos fichiers, la météo… ;
- **préparation** : rédiger un brouillon, préparer un rendez-vous, noter un rappel… ;
- **sensible** : ce qui envoie, supprime ou modifie quelque chose hors de l'assistant. Par exemple : envoyer un mail, créer, déplacer ou annuler un rendez-vous, écrire dans un tableur, modifier ou supprimer un fichier, ouvrir une serrure.

Lire et préparer est libre. Une action sensible n'est jamais exécutée directement : l'assistant affiche une **carte de validation** qui résume l'action, et attend votre réponse.

### Le « oui » est décidé par une règle fixe

Ce n'est pas le modèle qui décide si vous avez dit oui. Le serveur compare votre réponse à une liste fixe de phrases d'accord (`safety.acceptPhrases` dans `config/code.config.ts`) : « oui », « vas-y », « je confirme », « envoie », « c'est bon »… La comparaison ignore les accents, la ponctuation, les mots d'appui en début de phrase (« euh », « bon ») et les politesses en fin de phrase (« merci », « s'il te plaît »).

Tout le reste **annule** : un « non », une hésitation (« euh »), une phrase ambiguë (« oui mais attends »), ou une phrase qui ajoute quelque chose (« oui, envoie-le à tout le monde »). Vous pouvez aussi répondre avec les boutons de la carte.

Sans réponse au bout de 30 secondes (`safety.confirmTimeoutMs`), la demande expire et rien n'est fait. Une seule action attend à la fois : une nouvelle demande annule la précédente.

### Les tâches planifiées n'agissent jamais seules

Une tâche planifiée tourne sans vous. Elle n'a accès qu'aux outils de lecture et de préparation : aucun outil sensible, et aucun outil qui gère les tâches elles-mêmes. Elle lit, prépare et rend un résultat écrit ; elle n'envoie ni ne modifie rien.

### Le contenu lu n'est pas un ordre

Les consignes données au modèle précisent que le contenu d'un mail ou d'un fichier est une donnée, jamais une instruction : l'assistant ne fait pas ce qu'un mail lui demande sans un ordre de votre part. Si un texte piégé trompait quand même le modèle, l'action sensible qu'il tenterait passerait par la carte de validation.

De même, une compétence (une méthode écrite en texte simple) dit comment faire, pas ce qui est permis : apprendre ou oublier une compétence de vive voix attend aussi un « oui ».

## Les fichiers de l'ordinateur

L'assistant ne voit que quelques dossiers de la machine du serveur : par défaut `~/Desktop`, `~/Documents` et `~/Downloads`. Changez cette liste avec `CODE_ALLOWED_FOLDERS` (chemins séparés par des virgules, sans espace) ou `files.allowedFolders` dans `config/code.config.ts`.

- Les chemins sont résolus, liens symboliques compris : un lien qui pointe hors des dossiers autorisés est refusé.
- Un fichier créé ou renommé doit avoir un nom simple : pas de séparateur de dossier, pas de nom qui commence par un point (fichier caché).
- Les outils de fichiers ne servent qu'à la personne dont l'app de bureau est reliée à ce serveur.
- Écrire, déplacer ou supprimer un fichier est une action sensible.

## Vos secrets

- **Chiffrés en base.** Les clés API collées dans Réglages › Clés API, les accès Google et ceux des connecteurs sont chiffrés (AES-256-GCM) avec la clé maîtresse du serveur. Chaque secret chiffré est lié à son compte et à son usage. Une base copiée sans sa clé maîtresse ne révèle aucune clé.
- **Jamais renvoyés aux écrans.** Une clé enregistrée ne s'affiche plus : l'écran montre ses quatre derniers caractères.
- **La clé maîtresse** vit dans le trousseau de macOS, ou dans `CODE_MASTER_KEY`, ou à défaut dans le fichier `secrets.json` du dossier de données, lisible par le seul utilisateur du serveur. Voir [Où vont les secrets](installation.md#où-vont-les-secrets).
- **Mots de passe.** Le mot de passe d'un compte n'est jamais gardé : seule une empreinte scrypt l'est.
- **Jetons d'appareil.** Seule une empreinte de chaque jeton est gardée en base. Le jeton de l'app de bureau de la machine est un fichier lisible par vous seul.

## Plusieurs comptes

Chaque compte de l'installation a ses propres données (conversations, rappels, mémoire, documents, réunions), son propre assistant et **ses propres clés**. Les clés du serveur (`npm run secrets`, variables d'environnement) ne servent qu'au propriétaire. Chaque personne relie aussi son propre compte Google : rien n'est partagé entre les comptes.

Le propriétaire invite les autres depuis Réglages › Comptes, avec un code ou un lien à usage unique, valable sept jours.

## Les appareils

- Un téléphone s'associe avec un code à usage unique, valable dix minutes. Le lien d'association contient ce code, jamais un jeton. Ne le montrez qu'à vos propres appareils.
- Réglages › Appareils connectés liste vos appareils. Retirer un appareil le déconnecte aussitôt.

## Le réseau

- Par défaut, le serveur n'écoute que sur `127.0.0.1` : seule la machine elle-même peut le joindre.
- Pour l'utiliser depuis le téléphone, passez par Tailscale (vos seuls appareils) ou par un proxy inverse en HTTPS (`CODE_PUBLIC_URL`). Voir [Téléphone](telephone.md).
- **N'exposez jamais le port du serveur (8787 par défaut) sur internet sans HTTPS.** Sans HTTPS, vos conversations, vos mots de passe et vos jetons d'appareil passent en clair sur le réseau.
- Ne mettez `CODE_HOST=0.0.0.0` que si un proxy HTTPS ou un pare-feu protège le port.
- Ollama et SearXNG n'ont pas de mot de passe : gardez-les sur votre machine ou votre réseau local.

## Ce qui reste chez vous, et ce qui part

- Restent sur votre serveur : la base, vos notes de mémoire, vos documents, le texte des réunions, vos empreintes vocales.
- L'audio d'une réunion est effacé dès qu'il est transcrit. L'image d'une caméra (Home Assistant) n'est gardée nulle part.
- Partent chez les fournisseurs que vous avez choisis, avec vos clés : le texte de vos échanges (au moteur, sauf avec un modèle local), votre voix (au service de transcription), les réponses à dire (au service de synthèse), vos recherches web.

Lisez les conditions de chaque fournisseur pour savoir ce qu'il fait de ces données.
