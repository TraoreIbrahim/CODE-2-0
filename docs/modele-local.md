# Modèle local avec Ollama

CODE 2.0 peut penser avec un modèle qui tourne sur votre propre machine, grâce à [Ollama](https://ollama.com). Vous n'avez alors besoin d'aucune clé payante pour le moteur, et le texte de vos conversations n'est envoyé à aucun fournisseur de modèles. La voix et la recherche web restent des services à part, décrits plus bas.

Cette page explique comment l'installer, comment le régler pour qu'il fonctionne bien avec l'assistant, et ce qu'il faut en attendre.

## Ce qu'il faut savoir avant

Un modèle local est **plus lent** et **moins fiable avec les outils** qu'un modèle en ligne. L'assistant s'appuie sans cesse sur des outils (rappels, météo, mémoire, agenda…), et un petit modèle les utilise moins bien. Comptez plusieurs dizaines de secondes pour une demande qui utilise des outils, et parfois un outil mal choisi.

C'est un bon choix pour essayer CODE 2.0 sans frais, pour un usage surtout écrit, ou si vous tenez à ce que rien ne parte chez un fournisseur de modèles. Pour un usage vocal fluide au quotidien, un modèle en ligne reste plus confortable. Vous pouvez changer de moteur à tout moment.

### Matériel conseillé

- un Mac Apple Silicon avec 16 Go de mémoire ;
- ou un PC avec une carte graphique de 8 Go de mémoire ou plus.

Sur une machine plus modeste, le modèle tourne, mais plus lentement.

## Installer Ollama et un modèle

1. Installez Ollama depuis [ollama.com](https://ollama.com), sur la machine du serveur CODE 2.0.
2. Téléchargez le modèle conseillé :

   ```bash
   ollama pull qwen3:8b
   ```

3. Vérifiez qu'il est bien installé :

   ```bash
   ollama list
   ```

qwen3 est le modèle préféré par CODE 2.0 : parmi les petits modèles essayés, c'est celui qui utilise le mieux les outils. Vous pouvez en installer un autre ; il doit savoir appeler des outils. Le [banc d'essai](#le-banc-dessai) vous dira s'il convient.

## Donner assez de mémoire au modèle

C'est le réglage le plus important.

Par défaut, Ollama ne donne au modèle que **4096 tokens** de contexte, sa mémoire de travail. Les consignes de l'assistant en font à elles seules environ 4 700. Ollama coupe alors le début du texte : l'assistant oublie une partie de ses consignes, répond mal ou ne trouve pas ses outils.

Lancez Ollama avec un contexte de 16 384 tokens, grâce à la variable `OLLAMA_CONTEXT_LENGTH`.

### En ligne de commande (macOS, Linux, Windows)

Si vous lancez Ollama vous-même dans un terminal :

```bash
OLLAMA_CONTEXT_LENGTH=16384 ollama serve
```

Sous Windows, dans PowerShell :

```powershell
$env:OLLAMA_CONTEXT_LENGTH = "16384"
ollama serve
```

### macOS, avec l'app Ollama

L'app Ollama ne lit pas les variables de votre terminal. Donnez-lui la variable avec `launchctl`, puis quittez et relancez l'app Ollama :

```bash
launchctl setenv OLLAMA_CONTEXT_LENGTH 16384
```

Ce réglage ne survit pas toujours à un redémarrage du Mac : refaites-le si l'avertissement revient.

### Linux, avec le service systemd

Si Ollama est installé comme service :

```bash
sudo systemctl edit ollama.service
```

Ajoutez sous `[Service]` :

```ini
[Service]
Environment="OLLAMA_CONTEXT_LENGTH=16384"
```

Puis :

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

### Windows, avec l'app Ollama

1. Quittez Ollama (icône de la barre des tâches).
2. Ouvrez l'éditeur des variables d'environnement : Paramètres sous Windows 11, Panneau de configuration sous Windows 10 (cherchez « variables d'environnement »).
3. Ajoutez la variable `OLLAMA_CONTEXT_LENGTH` avec la valeur `16384` pour votre compte utilisateur.
4. Validez, puis relancez Ollama depuis le menu Démarrer.

Ces méthodes suivent la [FAQ officielle d'Ollama](https://docs.ollama.com/faq). Consultez-la si votre version d'Ollama se comporte autrement.

### Vérifier

Réglages › Moteurs affiche un avertissement tant que le contexte est trop court : « Ollama ne donne au modèle que 4 096 tokens de mémoire de travail… ». Ollama ne donne cette information que lorsqu'un modèle est chargé en mémoire : posez d'abord une question à l'assistant, puis rouvrez la page. Quand l'avertissement a disparu, le réglage est pris.

Un contexte plus grand demande plus de mémoire à la machine.

## Démarrer CODE 2.0 avec Ollama

Lancez Ollama, puis le serveur CODE 2.0 (`npm run dev` ou `npm run start:server`).

Au démarrage, le serveur cherche Ollama sur la même machine, à l'adresse `http://127.0.0.1:11434`. S'il le trouve, le modèle local devient disponible dans Réglages › Moteurs, sans autre réglage.

S'il n'y a **pas de clé Anthropic** sur le serveur (ni dans l'environnement, ni dans le trousseau), le modèle local devient en plus le **moteur par défaut** des trois usages : conversation, réponses rapides et tâches planifiées. Une installation neuve répond ainsi tout de suite. Le serveur choisit qwen3 s'il est installé, sinon le premier modèle installé qui sait appeler des outils.

Le journal du serveur l'annonce :

```text
[code] Modèle local : Ollama relié (http://127.0.0.1:11434/v1), qwen3:8b répond par défaut (pas de clé Anthropic)
```

Avec une clé Anthropic, le journal dit seulement que le modèle local est relié et qu'il est « à choisir dans Réglages › Moteurs ».

Ollama doit tourner **avant** le serveur : la détection n'a lieu qu'au démarrage. Si vous lancez Ollama après, redémarrez le serveur.

### Choisir ou quitter le modèle local

Dans **Réglages › Moteurs**, chaque usage a son moteur. Choisissez « Ollama (sur votre machine) » et un modèle, ou revenez à un fournisseur en ligne. Le changement vaut pour votre compte, tout de suite. Vous pouvez par exemple garder le modèle local pour les tâches planifiées, où personne n'attend, et un modèle en ligne pour la conversation.

Le modèle local n'a pas de clé : il sert à tous les comptes de l'installation. Le compteur de Réglages › Consommation le compte à zéro.

### La réflexion est coupée

qwen3 sait « réfléchir » avant de répondre. Sur un ordinateur, cette réflexion coûte cher en temps : 7,5 secondes pour une réponse simple, contre 0,2 seconde sans. CODE 2.0 la coupe donc automatiquement pour les modèles d'Ollama. Vous n'avez rien à régler.

### Ollama sur une autre machine

Si Ollama tourne sur une autre machine de votre réseau (un PC avec une bonne carte graphique, par exemple), donnez son adresse au serveur CODE 2.0, au format OpenAI, avec `/v1` à la fin :

```bash
CODE_OLLAMA_URL=http://mini-pc.local:11434/v1 npm run start:server
```

Par défaut, Ollama n'écoute que sa propre machine. Sur la machine d'Ollama, réglez `OLLAMA_HOST=0.0.0.0:11434` de la même façon que `OLLAMA_CONTEXT_LENGTH`, puis relancez Ollama. N'exposez pas ce port sur internet : Ollama n'a pas de mot de passe.

### Couper la détection

Pour qu'Ollama ne soit jamais proposé, même s'il tourne sur la machine, donnez une valeur vide :

```bash
CODE_OLLAMA_URL= npm run dev
```

## Le banc d'essai

Le banc d'essai vérifie qu'un modèle tient la route avec l'assistant. Dans **Réglages › Moteurs**, choisissez le modèle, puis touchez « Tester ».

Il pose sept demandes types, l'une après l'autre : présentation, rappel, météo, mémoire, enchaînement de plusieurs outils, recherche d'outils, recherche web. Les outils sont simulés : rien n'est créé, rien n'est envoyé. Chaque scénario a 90 secondes au plus.

Le verdict :

- **TESTÉ** : tous les scénarios passent ;
- **LIMITÉ** : la moitié au moins passe ;
- **ÉCHEC** : moins de la moitié.

Le scénario « Web » est ignoré s'il n'y a pas de recherche web pour ce modèle (ni clé Brave, ni SearXNG). Les résultats restent affichés sous « Banc d'essai sur ce serveur », pour tous les comptes. Avec un modèle local, le banc ne coûte rien.

### Ce qu'il mesure avec qwen3:8b

Sur un Mac Apple Silicon, avec qwen3:8b, le banc a donné :

| Scénario | Durée |
| --- | --- |
| Présentation | 2,1 s |
| Rappel | 23 s |
| Météo | 24 s |
| Mémoire | 14 s |
| Enchaînement de plusieurs outils | 27 s |

La recherche d'outils échoue parfois. Verdict : **LIMITÉ**. Une réponse sans outil est rapide ; une demande qui en utilise prend de quinze à trente secondes. Ces durées dépendent de votre machine : lancez le banc chez vous pour connaître les vôtres.

## La voix reste en ligne

Le modèle local remplace le **moteur** seulement. La transcription de votre voix et la voix de l'assistant passent toujours par un service en ligne (ElevenLabs, Deepgram, Groq, Mistral, OpenAI ou Gemini), avec sa clé. CODE 2.0 n'a pas de transcription ni de synthèse vocale locale.

Sans clé de voix, utilisez l'assistant **par écrit** : le bouton « Mode chat » de l'app de bureau et du téléphone ouvre une zone de saisie, et l'assistant répond par écrit, sans voix.

La reconnaissance de **votre** voix (l'empreinte vocale, `npm run modele-voix`) tourne bien sur le serveur, sans service en ligne. Mais elle sert seulement à savoir qui parle ; elle ne transcrit pas. Voir [Voix](voix.md).

Si vous ajoutez une clé de voix, une clé Groq est l'option la moins chère pour la transcription. Voir [Clés API](cles-api.md).

## La recherche web sans clé

Claude a sa propre recherche web ; les autres moteurs, dont Ollama, cherchent avec une clé Brave Search ou avec un [SearXNG](https://docs.searxng.org) que vous hébergez vous-même. SearXNG ne demande aucune clé.

1. Installez SearXNG (sa documentation propose notamment une installation avec Docker).
2. Activez le format JSON dans son fichier `settings.yml` :

   ```yaml
   search:
     formats:
       - html
       - json
   ```

3. Donnez son adresse au serveur CODE 2.0 :

   ```bash
   CODE_SEARXNG_URL=http://127.0.0.1:8080 npm run dev
   ```

Le port dépend de votre installation de SearXNG. Si le format JSON n'est pas activé, la recherche échoue avec un message du type « SearXNG a répondu … (le format JSON doit être activé) ». Une personne qui a une clé Brave l'utilise en priorité.

## Une installation sans aucune clé payante

En réunissant ces éléments, CODE 2.0 fonctionne sans aucune clé payante :

- le moteur : Ollama ;
- la recherche web : SearXNG ;
- la météo et les itinéraires : déjà sans clé (OpenStreetMap, MET Norway) ;
- Gmail, Agenda et Drive : votre propre projet Google Cloud, gratuit (voir [Google](google.md)) ;
- l'échange : par écrit, en mode chat.

Seule la voix demande une clé de service en ligne.

## En cas de problème

- **Ollama n'apparaît pas dans Réglages › Moteurs** : Ollama ne tournait pas au démarrage du serveur, ou `CODE_OLLAMA_URL` est vide ou fausse. Lancez Ollama, puis redémarrez le serveur.
- **« Ollama n'est pas installé sur ce serveur. »** : même cause.
- **« Impossible de joindre le moteur. Vérifiez la connexion internet du serveur (ou l'adresse d'Ollama). »** : Ollama s'est arrêté, ou l'adresse donnée ne répond pas.
- **Réponses incohérentes, outils ignorés, réponses coupées** : le contexte est trop court. Voir [Donner assez de mémoire au modèle](#donner-assez-de-mémoire-au-modèle).
- **« Ce modèle n'existe pas chez ollama »** : le modèle choisi n'est plus installé. Faites `ollama list`, puis choisissez un modèle présent.

Voir aussi [Dépannage](depannage.md).
