# Dépannage

Les problèmes les plus fréquents, et ce qu'il faut faire. Le premier réflexe : lire le **journal du serveur**, dans le terminal où il tourne. Ses lignes `[code]` au démarrage disent ce qui est prêt et ce qui manque. Les messages techniques envoyés par les appareils (micro du téléphone…) sont dans le fichier `appareils.log` du [dossier de données](installation.md#où-vivent-les-données).

## Installation et démarrage

### `concurrently: command not found`

Les dépendances ne sont pas installées, ou pas complètement. Depuis la racine du dépôt :

```bash
npm ci
```

`npm ci` réinstalle exactement les versions du fichier `package-lock.json`. Relancez ensuite `npm run dev`.

### Version de Node.js trop ancienne

CODE 2.0 demande Node.js 24 ou plus récent. Vérifiez avec `node --version`, puis installez la bonne version depuis [nodejs.org](https://nodejs.org).

### L'app de bureau ne s'ouvre pas (Electron absent)

L'installation télécharge le binaire Electron s'il manque. Si ce téléchargement a échoué (réseau coupé), relancez `npm install`.

### Le port est déjà pris

Le serveur s'arrête avec une erreur `EADDRINUSE` : un autre programme utilise déjà le port 8787, souvent un serveur CODE 2.0 déjà lancé dans un autre terminal. Arrêtez-le, ou choisissez un autre port :

```bash
CODE_PORT=8788 CODE_SERVER_URL=ws://127.0.0.1:8788/ws npm run dev
```

`CODE_SERVER_URL` dit à l'app de bureau où trouver le serveur. Avec Tailscale, publiez aussi le nouveau port : `tailscale serve --bg 8788`.

### « Serveur injoignable » dans l'app

L'app de bureau ne trouve pas le serveur. Vérifiez qu'il tourne, et que `CODE_SERVER_URL` correspond à son adresse et à son port. Les réglages faits pendant la coupure s'enregistrent au retour de la connexion.

### « CODE_MASTER_KEY doit faire 32 octets (base64). »

La clé maîtresse donnée n'a pas le bon format. Créez-en une avec la commande de [Où vont les secrets](installation.md#où-vont-les-secrets). Attention : si la base contient déjà des secrets, il faut reprendre **la même** clé qu'avant, sinon ils deviennent illisibles.

## Clés et moteurs

### « Clés du serveur manquantes » dans le journal

```text
[code] Clés du serveur manquantes : ANTHROPIC_API_KEY · DEEPGRAM_API_KEY ou GROQ_API_KEY · ELEVENLABS_API_KEY ou OPENAI_API_KEY  →  npm run secrets, ou Réglages › Clés API
```

Cette ligne ne regarde que les clés **du serveur** : variables d'environnement, trousseau de macOS, `npm run secrets`. Les clés collées dans Réglages › Clés API sont rangées dans le coffre de chaque compte et n'y figurent pas. Si vous avez collé vos clés dans l'app, vous pouvez ignorer ce message.

`ANTHROPIC_API_KEY` n'y figure plus quand un modèle local répond par défaut (voir [Modèle local](modele-local.md)).

### Messages des moteurs

| Message | Cause et solution |
| --- | --- |
| « Aucune clé … pour votre compte : ajoutez la vôtre dans Réglages › Clés API, ou choisissez un autre moteur dans Réglages › Moteurs. » | Le moteur choisi n'a pas de clé pour ce compte. Les clés du serveur ne servent qu'au propriétaire : les autres comptes collent les leurs. |
| « Clé … refusée : vérifiez-la dans Réglages › Clés API. » | Clé fausse, révoquée, ou compte du fournisseur sans moyen de paiement. |
| « Ce modèle n'existe pas chez … (ou plus) : choisissez-en un autre dans Réglages › Moteurs. » | Le modèle a été retiré ou renommé chez le fournisseur. Pour Ollama : le modèle n'est plus installé. |
| « Trop de demandes à … pour le moment (ou crédit épuisé). Réessayez dans un instant. » | Limite du fournisseur atteinte, ou crédit épuisé : vérifiez votre compte chez lui. |
| « … a refusé la demande : … » | Le fournisseur a rejeté la requête ; le message donne sa raison. Essayez un autre modèle, et passez-le au banc d'essai. |
| « Impossible de joindre le moteur. Vérifiez la connexion internet du serveur (ou l'adresse d'Ollama). » | Pas de réseau sur le serveur, ou Ollama arrêté. |
| « Impossible de joindre Claude. Vérifiez la connexion internet du serveur. » | Pas de réseau sur le serveur. |
| « Claude n'est pas configuré : ajoutez une clé Anthropic dans Réglages › Clés API. » | Claude est choisi sans clé Anthropic. |

### L'assistant répond moins bien en fin de journée

Le plafond de dépense du jour est peut-être atteint : l'assistant passe alors au modèle rapide jusqu'à minuit. Vérifiez dans Réglages › Consommation, et relevez le plafond si besoin.

### Ollama lent, qui coupe ses réponses ou ignore ses outils

Par défaut, Ollama ne donne que 4096 tokens de contexte au modèle, et les consignes de l'assistant n'y tiennent pas. Relancez Ollama avec `OLLAMA_CONTEXT_LENGTH=16384`. Réglages › Moteurs affiche un avertissement tant que le contexte est trop court. Les commandes pour chaque système sont dans [Modèle local](modele-local.md#donner-assez-de-mémoire-au-modèle).

Un modèle local reste plus lent qu'un modèle en ligne : quinze à trente secondes pour une demande avec outils, c'est normal sur un ordinateur personnel.

### Ollama n'apparaît pas dans Réglages › Moteurs

Ollama doit tourner **avant** le démarrage du serveur, qui ne le cherche qu'à ce moment-là. Lancez Ollama, puis redémarrez le serveur. Vérifiez aussi que `CODE_OLLAMA_URL` n'est pas vide (cela coupe la détection) et qu'elle finit par `/v1` si vous la donnez.

### La recherche web ne marche pas

- « Clé Brave Search refusée : vérifiez-la dans Réglages › Clés API. » : la clé Brave est fausse.
- « SearXNG a répondu … (le format JSON doit être activé). » : activez le format `json` dans le `settings.yml` de SearXNG.
- Avec un moteur autre que Claude, sans clé Brave ni `CODE_SEARXNG_URL`, il n'y a pas de recherche web.

## Voix

| Problème | Que faire |
| --- | --- |
| « Aucune clé de transcription… » | Ajoutez une clé de transcription dans Réglages › Clés API, ou utilisez le mode chat. |
| « Aucune voix sur le serveur : Nova répond par écrit. » | Ajoutez une clé de synthèse (ElevenLabs, OpenAI, Deepgram ou Gemini). |
| Reconnaissance de la voix « indisponible (modèle absent…) » | `npm run modele-voix`, puis redémarrez le serveur. |
| L'assistant n'entend pas votre voix | Une empreinte existe peut-être pour un autre appareil seulement : enregistrez-la sur celui-ci (Réglages › Votre voix). |
| Le micro ne marche pas sur macOS, app lancée depuis les sources | L'app hérite des autorisations du terminal : autorisez le micro pour ce terminal dans Réglages Système › Confidentialité et sécurité. |
| Réunion en « micro seul » sur macOS | Autorisez le terminal (ou l'app) dans Réglages Système › Confidentialité et sécurité › Enregistrement de l'écran et de l'audio système. |

Plus de détails dans [Voix](voix.md).

## Téléphone

| Problème | Que faire |
| --- | --- |
| « PWA non compilée » | `npm run build`, puis rechargez la page. |
| Le téléphone ne s'associe pas | Il faut du HTTPS : `CODE_PUBLIC_URL` pour un serveur hébergé, ou Tailscale pour un serveur sur l'ordinateur. La fenêtre « Associer un téléphone » indique l'étape qui manque. |
| « Activez MagicDNS et HTTPS Certificates dans la console Tailscale (onglet DNS). » | Faites ce réglage dans la console Tailscale, puis « Vérifier à nouveau ». |
| « Le serveur n'est pas encore publié sur votre réseau Tailscale. » | Lancez `tailscale serve --bg 8787` sur l'ordinateur du serveur. |
| Code d'association refusé | Il ne sert qu'une fois et dure dix minutes. Demandez-en un nouveau. |
| Après l'ajout à l'écran d'accueil de l'iPhone, l'app demande de se connecter | Normal : elle ne voit pas ce que Safari a retenu. Connectez-vous, ou saisissez un nouveau code d'association. |
| Pas de notifications | Touchez la cloche ; sur iPhone, ajoutez d'abord l'app à l'écran d'accueil. Vérifiez aussi les heures de silence. |

Plus de détails dans [Téléphone](telephone.md).

## Google

| Message | Que faire |
| --- | --- |
| « Google n'est pas encore relié à cette installation… » | Le propriétaire suit le guide de Réglages › Connecteurs. Voir [Google](google.md). |
| « Google ne reconnaît pas ces identifiants… » | Recopiez l'ID client et le code secret du même client, sans espace. |
| « L'accès Google a expiré (7 jours en mode test). » | Reconnectez Google dans Réglages › Connecteurs. |
| « Autorisation Google insuffisante… » | Reconnectez Google en acceptant tous les accès demandés. |
| « Drive n'est pas encore autorisé… » | Reconnectez Google et acceptez l'accès à Google Drive. |
| Google refuse votre compte | Ajoutez votre adresse aux utilisateurs test du projet Google Cloud. |
| « Identifiants du client illisibles (clé maîtresse changée ?)… » | La clé maîtresse a changé : recollez les identifiants dans Réglages › Connecteurs, et chacun reconnecte son compte. |
| Pas de bouton « Connecter » sur le téléphone | Avec un serveur sur l'ordinateur, Google se connecte depuis l'app de bureau. |

## Encore bloqué

Notez le message exact du journal du serveur et ce que vous faisiez. Retirez toute clé ou adresse personnelle du texte avant de le partager pour demander de l'aide.
