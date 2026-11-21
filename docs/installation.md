# Installation

CODE 2.0 se lance depuis les sources. Il y a deux parties : le **serveur**, qui garde vos données et parle aux services, et les **apps** qui s'y connectent (l'app de bureau, la web app du téléphone). Sur un ordinateur personnel, les deux tournent sur la même machine. Sur un mini-PC ou un VPS, le serveur tourne seul et vos appareils s'y connectent.

## Prérequis

- [Node.js 24](https://nodejs.org) ou plus récent. Le dépôt refuse les versions plus anciennes (`"engines": { "node": ">=24" }`).
- [git](https://git-scm.com), pour récupérer le code.
- Un moteur pour faire penser l'assistant : une clé API (voir [Clés API](cles-api.md)) ou un modèle local avec Ollama (voir [Modèle local](modele-local.md)).

Vérifiez les versions installées :

```bash
node --version
git --version
```

## Installer

Les commandes sont les mêmes sur macOS, Windows et Linux. Sous Windows, utilisez PowerShell ou le terminal de Git for Windows.

```bash
git clone https://github.com/TraoreIbrahim/CODE-2-0.git
cd CODE-2-0
npm install
```

`npm install` installe les dépendances de tous les espaces de travail (`apps/*`, `packages/*`). Il copie aussi les fichiers de détection de la parole dans les apps et télécharge le binaire Electron s'il manque.

### macOS

- git est fourni avec les outils en ligne de commande d'Apple. S'il manque, `xcode-select --install` les installe.
- Les clés et la clé maîtresse vont dans le trousseau de macOS (voir [Où vont les secrets](#où-vont-les-secrets)).
- Lancée depuis les sources, l'app de bureau hérite des autorisations du terminal qui la lance : c'est ce terminal que macOS demande d'autoriser pour le micro et pour le son de l'ordinateur.

### Windows

- Installez Node.js 24 et Git for Windows avec leurs installateurs.
- Il n'y a pas de trousseau : les clés du serveur passent par des variables d'environnement, et la clé maîtresse par `CODE_MASTER_KEY` ou un fichier du dossier de données.
- Dans PowerShell, une variable d'environnement se donne ainsi, avant la commande :

```powershell
$env:CODE_PORT = "8788"
npm run dev
```

### Linux

- Installez Node.js 24 (depuis nodejs.org ou le gestionnaire de paquets de votre distribution, si sa version est assez récente) et git.
- Comme sous Windows, pas de trousseau : variables d'environnement et `CODE_MASTER_KEY`.
- Une variable d'environnement se donne devant la commande :

```bash
CODE_PORT=8788 npm run dev
```

## Lancer sur votre ordinateur

```bash
npm run dev
```

Cette commande lance deux programmes côte à côte :

- le serveur, sur le port 8787 (`CODE_PORT` pour en changer), qui redémarre seul quand vous modifiez son code ;
- l'app de bureau, qui se connecte au serveur de la même machine.

Le journal du serveur commence par une série de lignes `[code]`. Elles disent l'adresse d'écoute, la voix utilisée, l'état de Google, des notifications et du modèle local, et les clés qui manquent. Par exemple :

```text
[code] Serveur prêt sur http://127.0.0.1:8787  (WebSocket : /ws)
[code] Clés du serveur manquantes : ANTHROPIC_API_KEY · DEEPGRAM_API_KEY ou GROQ_API_KEY · ELEVENLABS_API_KEY ou OPENAI_API_KEY  →  npm run secrets, ou Réglages › Clés API
```

Une clé manquante n'empêche pas le serveur de démarrer. Vous pouvez coller vos clés ensuite dans l'app.

## Premier lancement

Au premier démarrage, le serveur crée le compte du **propriétaire**. L'app de bureau de la même machine s'y relie toute seule : elle lit un jeton d'appareil dans le dossier de données (fichier `device-token`, lisible par vous seul).

L'app ouvre ensuite un assistant de premier lancement, une question à la fois :

1. Le nom de l'assistant (« Nova » par défaut) et votre profil d'usage.
2. Comment il vous appelle, et s'il vous vouvoie ou vous tutoie.
3. Votre ville et votre fuseau horaire.
4. Vos clés API. Vous pouvez passer cette étape et y revenir plus tard.
5. Le moteur de chaque usage.
6. La couleur et la forme de l'orbe.
7. La voix de l'assistant.
8. L'empreinte de votre voix. Étape facultative.
9. Un identifiant et un mot de passe, pour vous connecter depuis un autre appareil. Étape facultative.
10. Vos comptes (Google). Étape facultative.
11. Vos habitudes : l'heure du briefing, les heures de silence, les notifications.
12. Un récapitulatif, puis l'assistant se présente.

Tout se change ensuite dans les Réglages.

Les autres personnes de la maison ont leur propre compte. Le propriétaire les invite depuis Réglages › Comptes, avec un code ou un lien valable sept jours, une seule fois.

## Le serveur seul (mini-PC, VPS)

Sur une machine sans écran, lancez le serveur seul :

```bash
npm run build
npm run start:server
```

`npm run build` prépare la web app du téléphone, que le serveur sert lui-même. Sans elle, le serveur répond « PWA non compilée » à la place de l'app.

Quelques réglages comptent pour un serveur hébergé (détails dans [Configuration](configuration.md)) :

- `CODE_PUBLIC_URL` : l'adresse publique HTTPS du serveur, par exemple `https://nova.example.org`. Elle sert à associer les téléphones et à relier Google depuis n'importe quel appareil.
- `CODE_HOST` : le serveur écoute par défaut sur `127.0.0.1`, donc seulement sur la machine elle-même. Mettez `CODE_HOST=0.0.0.0` seulement si le programme qui fournit le HTTPS tourne sur une autre machine ou dans un conteneur.
- `CODE_MASTER_KEY` : la clé maîtresse, à garder en lieu sûr (voir plus bas).

Le serveur ne fait pas de HTTPS lui-même. Placez devant lui un proxy inverse qui fournit le certificat (Caddy, nginx…) et transmet aussi les WebSocket du chemin `/ws`. Lisez [Sécurité](securite.md) avant d'ouvrir un port sur internet.

Tant qu'aucun appareil ne s'est connecté, le journal affiche un code d'association pour le premier :

```text
[code] Premier appareil : code d'association XXXXXXXX (valable 10 minutes, nouveau code à chaque démarrage).
```

Ouvrez l'adresse publique dans le navigateur du téléphone, touchez « J'ai un code d'association » et saisissez ce code. L'assistant de premier lancement s'ouvre alors sur cet appareil. Voir [Téléphone](telephone.md).

Pour que le serveur redémarre avec la machine, lancez `npm run start:server` depuis le gestionnaire de services de votre système (systemd sous Linux, par exemple), dans le dossier du dépôt, avec les variables d'environnement voulues.

## Où vivent les données

Le serveur range ses données dans un dossier `code-2`, à l'endroit habituel de chaque système :

| Système | Dossier de données |
| --- | --- |
| macOS | `~/Library/Application Support/code-2` |
| Windows | `%APPDATA%\code-2` (sinon `C:\Users\<vous>\AppData\Roaming\code-2`) |
| Linux | `$XDG_DATA_HOME/code-2`, sinon `~/.local/share/code-2` |

`CODE_DATA_DIR` remplace ce dossier par celui de votre choix. Donnez la même valeur au serveur et à l'app de bureau s'ils tournent sur la même machine.

On y trouve, entre autres :

- `code.db` : la base (comptes, réglages, conversations, rappels, clés chiffrées, empreintes vocales) ;
- `device-token` : le jeton de l'app de bureau de cette machine ;
- `secrets.json` : sous Windows et Linux, les secrets que le serveur crée lui-même (clé maîtresse si `CODE_MASTER_KEY` n'est pas donnée, clé des notifications) ;
- `competences/`, `documents/`, `reunions/` : un sous-dossier par compte ;
- `memoire/` : les notes de mémoire des comptes autres que le propriétaire.

Les notes de mémoire du **propriétaire** sont rangées à part, dans le dossier `memory/` du dépôt. `CODE_MEMORY_DIR` les déplace ailleurs.

Pour sauvegarder une installation, gardez ensemble le dossier de données, le dossier `memory/` et la clé maîtresse. Une base copiée sans sa clé maîtresse ne révèle aucune clé, mais elle ne peut plus les relire.

## Où vont les secrets

Le serveur cherche chaque secret (clé API, identifiants Google, clé maîtresse) d'abord dans les **variables d'environnement**, puis :

- sur **macOS**, dans le trousseau, sous le service `code-2` ;
- sur **Windows et Linux**, dans le fichier `secrets.json` du dossier de données, lisible par le seul utilisateur du serveur.

La **clé maîtresse** chiffre les secrets gardés en base : les clés collées dans Réglages › Clés API, les accès Google et ceux des connecteurs. Au premier démarrage, le serveur la crée s'il ne la trouve pas :

- sur macOS, dans le trousseau ;
- ailleurs, dans `secrets.json`. Le journal le signale : « Clé maîtresse créée dans … secrets.json : sauvegardez ce fichier avec la base, ou passez la clé par CODE_MASTER_KEY. »

Sur un serveur hébergé, préférez `CODE_MASTER_KEY` : 32 octets encodés en base64. Pour en créer une :

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Choisissez-la avant le premier démarrage. Une clé maîtresse différente de celle qui a chiffré la base rend les secrets déjà rangés illisibles : il faudrait recoller les clés et reconnecter Google.

Les clés API du serveur se rangent avec `npm run secrets` sur macOS, ou par variables d'environnement ailleurs. Elles ne servent qu'au propriétaire. Voir [Configuration](configuration.md#npm-run-secrets) et [Clés API](cles-api.md).

## Le build

| Commande | Ce qu'elle fait |
| --- | --- |
| `npm run build` | Compile la web app du téléphone (`apps/mobile/dist`, servie par le serveur) et l'app de bureau (`apps/desktop/out`). |
| `npm run dist -w @code/desktop` | Compile l'app de bureau puis fabrique son installateur avec electron-builder. |
| `npm run dist:mac -w @code/desktop` | Installateur macOS : `.dmg` pour Apple Silicon et Intel. |
| `npm run dist:win -w @code/desktop` | Installateur Windows (NSIS). |
| `npm run dist:linux -w @code/desktop` | AppImage et paquet `.deb`. |

Les installateurs sont encore en chantier (voir la [feuille de route](FEUILLE-DE-ROUTE.md)). L'app de macOS a une signature ad hoc, sans certificat Apple : macOS demande d'autoriser son ouverture la première fois. L'app installée ne contient pas le serveur : elle se connecte à un serveur lancé à part, sur la même machine par défaut.

Pour vérifier le code avant une contribution :

```bash
npm test
npm run typecheck
npm run build
```

## Et ensuite

- Ajouter vos clés : [Clés API](cles-api.md), ou un modèle local : [Modèle local](modele-local.md).
- Relier Gmail, Agenda et Drive : [Google](google.md).
- Utiliser l'assistant sur votre téléphone : [Téléphone](telephone.md).
