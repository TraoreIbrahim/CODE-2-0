# Le téléphone

Sur le téléphone, CODE 2.0 est une **web app** : une page servie par votre serveur, que l'on installe sur l'écran d'accueil comme une app. Elle marche sur iPhone et sur Android, sans passer par un magasin d'applications.

## Préparer la web app

Le serveur sert la web app lui-même, à partir de sa version compilée. Compilez-la une fois, et après chaque mise à jour du code :

```bash
npm run build
```

Sans cette étape, le serveur répond « PWA non compilée » à la place de l'app.

## Le HTTPS est obligatoire

Le téléphone doit joindre le serveur en **HTTPS**. Sans HTTPS, le navigateur du téléphone refuse le micro et les notifications. Deux façons d'y arriver.

### Serveur hébergé : `CODE_PUBLIC_URL`

Si le serveur tourne sur un VPS ou un mini-PC derrière un proxy HTTPS, donnez son adresse publique :

```bash
CODE_PUBLIC_URL=https://nova.example.org npm run start:server
```

Le journal du serveur indique alors : « Téléphone : ouvrez https://nova.example.org, puis associez-le depuis le cockpit de l'ordinateur (QR). »

### Serveur sur votre ordinateur : Tailscale

Si le serveur tourne sur votre ordinateur, [Tailscale](https://tailscale.com) le rend joignable en HTTPS par vos seuls appareils, sans rien ouvrir sur internet.

1. Installez Tailscale sur l'ordinateur et sur le téléphone, et connectez-vous avec le même compte.
2. Dans la console Tailscale, onglet DNS : activez MagicDNS, puis HTTPS Certificates.
3. Sur l'ordinateur du serveur, publiez le serveur sur votre réseau Tailscale, une seule fois :

   ```bash
   tailscale serve --bg 8787
   ```

   Remplacez `8787` par votre port si vous avez changé `CODE_PORT`.

Vous n'avez pas à retenir ces étapes : la fenêtre d'association vérifie Tailscale et affiche celle qui manque (« Installer Tailscale », « Connecter Tailscale », « Activer HTTPS », « Publier le serveur »), avec la commande à copier.

## Associer le téléphone

### Depuis l'app de bureau

1. Dans l'app de bureau, ouvrez Réglages › Habitudes, puis « Associer un téléphone ». Le même bouton existe dans le menu du cockpit.
2. Ouvrez l'appareil photo du téléphone et visez le QR code.
3. Touchez le lien : l'assistant s'ouvre dans le navigateur et s'associe tout seul, à votre compte.

Sous le QR, la fenêtre affiche aussi un **code d'association**, avec des boutons pour copier le code ou le lien. Ce code ouvre votre assistant une seule fois, pendant dix minutes : ne le montrez qu'à vos propres appareils. Avec Tailscale, le téléphone doit être connecté à Tailscale.

### Sans app de bureau (serveur hébergé)

Tant qu'aucun appareil ne s'est connecté, le serveur affiche au démarrage un code pour le premier :

```text
[code] Premier appareil : code d'association XXXXXXXX (valable 10 minutes, nouveau code à chaque démarrage).
```

Ouvrez l'adresse du serveur dans le navigateur du téléphone, touchez « J'ai un code d'association » et saisissez ce code.

### Avec un identifiant et un mot de passe

Si vous avez choisi un identifiant et un mot de passe (au premier lancement, ou dans Réglages › Compte), vous pouvez aussi vous connecter avec eux depuis l'écran « Connexion ».

## Installer la web app sur l'écran d'accueil

### iPhone

1. Ouvrez l'assistant dans Safari.
2. Touchez Partager, puis « Sur l'écran d'accueil ».
3. Ouvrez l'app depuis l'écran d'accueil.

Sur iPhone, l'app de l'écran d'accueil ne voit pas ce que Safari a retenu. À sa première ouverture, connectez-vous, ou touchez « J'ai un code d'association » et saisissez un code. Associez de nouveau depuis l'app de bureau si le code a expiré.

### Android

Ouvrez l'assistant dans Chrome, puis, dans le menu du navigateur, choisissez l'option qui installe l'app ou l'ajoute à l'écran d'accueil. Le libellé varie selon la version de Chrome et du téléphone.

## Les notifications

Le téléphone peut recevoir les rappels, le briefing du matin, les résultats des tâches planifiées et les alertes.

1. Dans l'app du téléphone, touchez la **cloche** (« Activer les notifications »).
2. Acceptez la demande du téléphone.

Sur iPhone, la cloche n'apparaît qu'une fois l'app ajoutée à l'écran d'accueil : iOS n'envoie pas de notifications à une page ouverte dans Safari.

Si la cloche indique « Notifications bloquées », le téléphone les a refusées : autorisez-les dans les réglages du téléphone, pour le navigateur ou pour l'app.

Les notifications se coupent dans Réglages › Habitudes (« Notifications sur le téléphone »). Pendant vos heures de silence, le téléphone n'en reçoit pas, sauf alerte grave (voir [Voix](voix.md#les-heures-de-silence)).

Le journal du serveur indique combien de téléphones sont abonnés : « Notifications du téléphone : 1 abonné(s) ».

## Au quotidien

- Le **mode chat** permet d'écrire à l'assistant plutôt que de lui parler, dans un endroit bruyant. Il répond alors par écrit.
- Pendant l'enregistrement d'une réunion, l'écran du téléphone doit rester allumé.
- Dans Réglages › Appareils connectés, vous voyez chaque appareil associé. Retirer un appareil le déconnecte aussitôt : faites-le pour un téléphone perdu ou vendu. La fenêtre d'association liste aussi les appareils reliés, avec un bouton « Retirer ».

## En cas de problème

| Problème | Que faire |
| --- | --- |
| La page ne s'ouvre pas sur le téléphone | Vérifiez le HTTPS : `CODE_PUBLIC_URL` pour un serveur hébergé, Tailscale connecté sur les deux appareils pour un serveur sur l'ordinateur. |
| « PWA non compilée » | Lancez `npm run build`, puis rechargez la page. |
| Le QR n'apparaît pas, une étape Tailscale s'affiche | Faites l'étape indiquée, puis « Vérifier à nouveau » dans la fenêtre. |
| Le code est refusé | Il est à usage unique et valable dix minutes : demandez-en un nouveau. |
| Le micro ne marche pas | Le téléphone n'est pas en HTTPS, ou le navigateur n'a pas l'autorisation du micro. |
| Pas de cloche sur iPhone | Ajoutez d'abord l'app à l'écran d'accueil. |

Voir aussi [Dépannage](depannage.md).
