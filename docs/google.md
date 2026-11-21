# Relier Google (Gmail, Agenda, Drive)

Avec Google relié, l'assistant lit vos mails, prépare des brouillons, consulte et organise votre agenda, cherche dans votre Drive, écrit dans vos tableurs et retrouve vos contacts. Tout ce qui envoie ou modifie attend votre « oui ».

CODE 2.0 n'a pas de compte Google à lui. Chaque installation crée **son propre projet Google Cloud**, gratuit, avec son propre client OAuth. Vos mails, votre agenda et vos fichiers passent donc directement de Google à votre serveur : personne d'autre ne les voit.

Le travail se fait en deux temps :

- le **propriétaire** relie l'installation à Google, une seule fois (une dizaine de minutes) ;
- ensuite, **chaque personne** connecte son propre compte Google.

## Avant de commencer

Choisissez le type de client selon l'endroit où tourne le serveur :

| Serveur | Type de client | D'où se connecter |
| --- | --- | --- |
| Sur votre ordinateur | « Application de bureau » | Depuis l'app de bureau de cet ordinateur. |
| Hébergé, avec `CODE_PUBLIC_URL` | « Application Web » | Depuis n'importe quel appareil. |

Avec un serveur sur l'ordinateur, la page de Google s'ouvre dans le navigateur de cet ordinateur, et le serveur attend la réponse sur une adresse locale temporaire (`http://127.0.0.1:<port>`). Il n'y a pas d'adresse de retour à déclarer.

Avec un serveur hébergé, Google revient sur l'adresse publique du serveur, suivie de `/google/retour`. Par exemple, avec `CODE_PUBLIC_URL=https://nova.example.org` :

```text
https://nova.example.org/google/retour
```

## Relier l'installation (propriétaire)

Ouvrez **Réglages › Connecteurs** dans l'app. Le guide « Relier Google » reprend les étapes ci-dessous, avec un lien direct vers chaque page de la [console Google Cloud](https://console.cloud.google.com).

1. **Créer un projet.** Dans la console Google Cloud, créez un projet à vous. Le nom est libre : « Assistant », par exemple.
2. **Activer les cinq API.** Gmail, Agenda (Calendar), Drive, Sheets et Contacts (People API). Le lien du guide les propose d'un coup : vérifiez que le bon projet est choisi en haut de la page, puis « Activer ».
3. **Présenter l'application.** Dans Google Auth Platform › Commencer : un nom, votre adresse, audience « Externe ». Puis, dans Audience › Utilisateurs test, ajoutez votre adresse Gmail et celle de chaque personne de l'installation.
4. **Créer le client.** Dans Clients › Créer un client, choisissez le type :
   - « Application de bureau » si le serveur tourne sur votre ordinateur ;
   - « Application Web » si le serveur est hébergé. Dans « URI de redirection autorisés », ajoutez l'adresse de retour affichée par le guide, telle quelle (un bouton la copie).

   Google affiche alors l'**ID client** et le **code secret du client**.
5. **Coller les identifiants.** Revenez dans Réglages › Connecteurs, collez l'ID client (il se termine par `.apps.googleusercontent.com`) et le code secret, puis « Relier Google ».

Le serveur vérifie les identifiants auprès de Google. Il répond « Identifiants reconnus par Google. Vous pouvez connecter votre compte. », ou indique ce qui ne va pas. Le code secret est chiffré sur le serveur et ne s'affiche plus ensuite.

### Par les variables d'environnement

Vous pouvez aussi donner les identifiants au serveur avec `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` (variables d'environnement, ou `npm run secrets` sur macOS). Ils remplacent alors le guide : pour les changer, il faut changer ces variables.

## Connecter son compte (chaque personne)

Dans **Réglages › Connecteurs**, touchez « Connecter », puis acceptez les accès dans la page de Google.

- Serveur sur l'ordinateur : la connexion se fait depuis l'app de bureau ; la page de Google s'ouvre dans le navigateur de l'ordinateur.
- Serveur hébergé : la connexion se fait depuis n'importe quel appareil.

Acceptez **tous** les accès demandés. S'il en manque un, l'assistant le dit : « Autorisation Google insuffisante : reconnectez Google en acceptant tous les accès demandés. »

Chaque personne connecte son propre compte. Rien n'est partagé entre les comptes de l'installation.

### L'écran « application non validée »

Votre projet n'est pas validé par Google : c'est normal pour un projet personnel. Au moment de la connexion, Google affiche un écran d'avertissement qui le signale. Comme c'est votre propre application, vous pouvez continuer : passez par le lien des paramètres avancés, puis par celui qui donne accès à l'application. Le libellé exact dépend de Google et de votre langue.

Si Google refuse l'accès à un compte, c'est en général qu'il ne figure pas parmi les **utilisateurs test** du projet (étape 3). Ajoutez-le, puis recommencez.

## Les accès demandés

| Accès | Pour quoi faire |
| --- | --- |
| Gmail, lecture (`gmail.readonly`) | Lire et chercher vos mails, lire une pièce jointe. |
| Gmail, rédaction (`gmail.compose`) | Préparer des brouillons et envoyer, après votre « oui ». |
| Agenda (`calendar.events`) | Lire vos rendez-vous ; en créer, en déplacer ou en annuler, après votre « oui ». |
| Drive, lecture (`drive.readonly`) | Chercher et lire vos fichiers (Docs, Sheets, PDF…). |
| Drive, fichiers créés (`drive.file`) | Créer des fichiers, rangés dans un dossier « CODE 2.0 ». |
| Sheets (`spreadsheets`) | Écrire dans un tableur existant, après votre « oui ». |
| Contacts, lecture (`contacts.readonly`, `contacts.other.readonly`) | Retrouver un contact, y compris les personnes avec qui vous avez échangé des mails sans les enregistrer. |

## Le mode test et les 7 jours

Tant que le projet reste en mode test, Google coupe l'accès **7 jours** après chaque connexion. L'assistant prévient la veille, par une notification : « Votre accès Google se coupe demain vers … ». Le jour venu, Réglages › Connecteurs affiche « L'accès Google a expiré (7 jours en mode test). Reconnectez Google. » : touchez « Reconnecter ».

L'état de la connexion s'affiche dans Réglages › Connecteurs, par exemple « Connecté · expire dans 5 jours ».

## Changer ou retirer

- **Déconnecter** son compte : Réglages › Connecteurs, « Déconnecter ».
- **Changer les identifiants** de l'installation : « Changer le client Google », dans Réglages › Connecteurs (propriétaire). Les anciens identifiants sont oubliés et le guide se rouvre.
- Si la clé maîtresse du serveur a changé, les identifiants deviennent illisibles. Le journal l'indique : « Identifiants du client illisibles (clé maîtresse changée ?) : à recoller dans Réglages › Connecteurs. »

## En cas de problème

| Message | Que faire |
| --- | --- |
| « Google n'est pas encore relié à cette installation… » | Le propriétaire doit faire les étapes ci-dessus. |
| « Google ne reconnaît pas ces identifiants… » | Recopiez l'ID client et le code secret du même client, sans espace. |
| « Les identifiants Google viennent de la configuration du serveur (GOOGLE_CLIENT_ID) : changez-les là. » | Les variables d'environnement remplacent le guide : changez-les, puis redémarrez le serveur. |
| « L'accès Google a expiré (7 jours en mode test). » | Reconnectez Google dans Réglages › Connecteurs. |
| Google refuse le compte | Ajoutez-le aux utilisateurs test du projet. |
| Erreur d'adresse de retour (serveur hébergé) | L'URI de redirection du client doit être exactement `<CODE_PUBLIC_URL>/google/retour`. |
| Pas de bouton « Connecter » sur le téléphone | Avec un serveur sur l'ordinateur, la connexion se fait depuis l'app de bureau. Le téléphone l'indique : « La connexion à Google se fait depuis l'ordinateur qui fait tourner le serveur ». |

Voir aussi [Dépannage](depannage.md).
