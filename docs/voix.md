# La voix

On parle à l'assistant, il répond à voix haute. Cette page explique comment il vous écoute, comment lui apprendre à reconnaître votre voix, comment choisir ses voix et ses services, et comment le faire taire à certaines heures.

La transcription et la synthèse passent par des services en ligne, avec vos clés (voir [Clés API](cles-api.md)). Sans clé de voix, utilisez le mode chat : l'assistant répond par écrit.

## Comment il écoute

- **Au clic sur l'orbe**, ou avec le raccourci ⌘⇧Espace sur macOS (Ctrl+Maj+Espace sous Windows et Linux). Après sa réponse, le micro se referme ; touchez de nouveau l'orbe pour reparler.
- **En mode conversation**, le micro reste ouvert entre les échanges. Activez-le avec le bouton, ou dites « passe en mode conversation » ; « arrête d'écouter » le coupe. Il se coupe aussi seul après cinq minutes sans votre voix, ou quand l'ordinateur se met en veille. Ce mode demande une empreinte vocale : sans elle, l'assistant répondrait à toutes les voix de la pièce.

Seule la parole détectée part au serveur. Le mot d'activation (dire le nom de l'assistant pour l'appeler) existe, mais il est coupé par défaut (`desktop.wakeWord` dans `config/code.config.ts`).

## L'empreinte vocale

Avec une empreinte, l'assistant n'obéit qu'à vous : les autres voix de la pièce, la télévision ou une vidéo sont ignorées. La reconnaissance tourne sur votre serveur (sherpa-onnx, modèle TitaNet), sans service en ligne. Elle sert seulement à reconnaître qui parle ; elle ne transcrit pas.

### 1. Installer le modèle

Une fois par installation, sur la machine du serveur :

```bash
npm run modele-voix
```

La commande télécharge le modèle depuis la publication officielle de sherpa-onnx, vérifie son empreinte SHA-256, et le range dans `models/voix-titanet.onnx` (`CODE_SPEAKER_MODEL` pour un autre chemin). Redémarrez ensuite le serveur.

Le journal du serveur indique l'état :

- « indisponible (modèle absent : node scripts/modele-voix.mjs) » : le modèle n'est pas installé ;
- « empreinte à enregistrer depuis l'app de bureau » : le modèle est là, il reste à enregistrer votre voix ;
- « active » : l'assistant n'écoute que vous.

### 2. Enregistrer votre voix

Dans **Réglages › Votre voix**, touchez « Enregistrer ma voix ». Lisez à voix haute le texte affiché, normalement, là où vous parlez d'habitude à l'assistant : le bruit de fond habituel aide. Une trentaine de secondes suffisent ; une barre montre la progression.

Le premier lancement propose la même étape. Vous pouvez la passer et y revenir plus tard.

Chaque appareil a sa propre empreinte, comparée à son propre micro. Pour en ajouter une sur un autre appareil, ouvrez Réglages › Votre voix sur cet appareil et touchez « Enregistrer sur cet appareil ». La page indique les appareils déjà enregistrés.

« Oublier ma voix », puis « Confirmer l'oubli », efface vos empreintes. L'assistant écoute alors de nouveau toutes les voix.

### Réglage fin

La ressemblance minimale avec l'empreinte se règle dans `config/code.config.ts` (`speaker.threshold`, 0,35 par défaut). Plus bas, l'assistant accepte plus facilement votre voix, mais aussi celle des autres. Le score de chaque phrase s'affiche dans le journal du serveur.

## Choisir la voix de l'assistant

Dans **Réglages › Sa voix** (la page s'intitule « Voix de Nova », du nom de votre assistant) :

- **La voix** : Daniel, Charlotte, Sarah, Liam, Lily, Max, Hugo, Justin, Jade ou Adrien. Touchez une voix pour l'entendre. Elle garde son caractère d'un service à l'autre : chaque service prend sa voix la plus proche.
- **La vitesse**, de ×0,8 à ×1,2.
- **Avec ElevenLabs** : les voix de votre compte ElevenLabs (clonées ou ajoutées) sont proposées en premier, et une bibliothèque de voix françaises se parcourt avec un extrait à écouter. Deux rendus : « Rapide », ou « Naturelle », plus humaine, qui démarre un peu plus tard.

## Choisir les services

Toujours dans Réglages › Sa voix, deux choix :

- **« Ce que vous dites »** : le service de transcription (ElevenLabs Scribe, Deepgram, Groq Whisper, Mistral Voxtral, OpenAI).
- **« Ce que dit Nova »** : le service de synthèse (ElevenLabs, OpenAI, Deepgram Aura, Google Gemini).

« Automatique », le choix par défaut, prend le premier service dont vous avez la clé. Un service choisi dont la clé manque reste choisi : l'automatique le remplace en attendant, et l'écran le dit. Avec une clé Deepgram, le texte s'écrit aussi en direct pendant que vous parlez, quel que soit le service qui écrit la phrase finale.

Le détail des services et de leurs clés est dans [Clés API](cles-api.md#la-voix).

## Les heures de silence

Dans **Réglages › Habitudes**, activez « Heures de silence » et choisissez le début et la fin (de 22 h 00 à 6 h 30 quand vous l'activez, à ajuster). Les heures suivent votre fuseau horaire.

Pendant ces heures :

- l'assistant ne prend pas la parole de lui-même : pas d'annonce de rappel, de réunion ou d'alerte à voix haute ;
- le téléphone ne reçoit pas de notification.

Seule exception : une mise en production en échec dans vos projets (développeur) passe quand même, en notification seulement. Vous pouvez toujours lui parler pendant le silence : il vous répond.

Au même endroit se règlent aussi l'heure du briefing du matin, le point fait à votre retour après une absence, et les notifications du téléphone.

## En cas de problème

| Message ou problème | Que faire |
| --- | --- |
| « Aucune clé de transcription (ElevenLabs, Deepgram, Groq, Mistral ou OpenAI) : ajoutez-en une dans Réglages › Clés API. » | Ajoutez une clé de transcription, ou utilisez le mode chat. |
| « Aucune voix sur le serveur : Nova répond par écrit. » | Ajoutez une clé de synthèse. |
| « La reconnaissance de voix n'est pas installée sur ce serveur (modèle absent). » | `npm run modele-voix`, puis redémarrez le serveur. |
| Votre voix est refusée | Enregistrez une empreinte sur cet appareil, à l'endroit où vous parlez d'habitude. |
| Le micro ne marche pas (macOS, depuis les sources) | Autorisez le micro pour le terminal qui lance `npm run dev`. |

Voir aussi [Dépannage](depannage.md).
