# Feuille de route

Plan validé le 3 novembre 2026. CODE 2.0 reprend, module par module, le socle d'un assistant vocal existant, sans aucune donnée propre à une personne ou à une entreprise. Chaque module est relu, généralisé et testé en arrivant.

## Décisions

| Sujet | Décision |
|---|---|
| Hébergement | Chacun héberge son serveur. Personne ne paie pour les autres. |
| Moteurs (LLM) | Plusieurs par personne, avec ses propres clés API ; choix par usage (conversation, réponses rapides, tâches planifiées), changeable à tout moment. |
| Voix | Démarrage avec une clé LLM et un seul fournisseur de voix (OpenAI suffit pour les deux) ; les autres en option. |
| Clés | Propres à chaque utilisateur, jamais partagées entre comptes. |
| Plateformes | macOS, Windows, Linux (Electron) ; téléphone (PWA) ; Docker pour un serveur. |
| Langues | Français ; textes rangés pour accueillir l'anglais ensuite. |
| Utilisateurs | Plusieurs par installation : comptes locaux créés par le propriétaire, données cloisonnées. |
| Nom de l'assistant | Choisi par chaque personne au premier lancement (et mot d'activation qui suit). |
| Profils | Développeur, secrétariat, administration, foyer : outils, consignes, cartes et briefing adaptés. |
| Licence | AGPL-3.0 |
| Signature Apple | Plus tard. |

## Étapes

État : étapes 0 à 6 faites.

0. **Squelette** — dépôt, licence, monorepo, intégration continue, vérification avant publication.
1. **Socle** — protocole, interface partagée (orbe, micro, détection de parole), serveur (passerelle, validation, journal), voix, mémoire, rappels, tâches planifiées, fichiers. Un seul moteur à ce stade ; tests au vert.
2. **Comptes et secrets** — comptes locaux (propriétaire au premier lancement, invitations par code ou QR), coffre de secrets chiffré (clé maîtresse dans le trousseau du système ou une variable d'environnement), premier lancement (nom de l'assistant, appellation, tutoiement, profil, ville).
3. **Multi-moteurs** — une interface « moteur » : Claude en natif, et le format OpenAI (OpenAI, Gemini, Mistral, Groq, DeepSeek, OpenRouter, Ollama). Recherche d'outils, recherche web et compteur de dépenses pour tous les moteurs. Page « Moteurs » dans les Réglages. Banc d'essai : les mêmes scénarios vocaux sur chaque moteur, résultat affiché (« testé », « limité »).
4. **Voix multi-fournisseurs** — transcription (ElevenLabs Scribe, Deepgram, Groq Whisper, Mistral Voxtral, OpenAI) et synthèse (ElevenLabs, OpenAI, Deepgram Aura, Gemini) au choix de chacun, avec ses clés ; « automatique » par défaut, texte en direct par Deepgram quand sa clé existe.
5. **Connecteurs** — Google (Gmail, Agenda, Drive, Sheets, Contacts) avec un guide pas à pas et une alerte avant l'expiration des accès, boîtes IMAP, cartes et itinéraires, météo, serveurs MCP.
6. **Profils** — ensembles d'outils, de consignes, de cartes et de briefing ; écran simplifié pour un usage tout à la voix.
7. **Distribution** — installateurs macOS, Windows, Linux ; Docker Compose ; documentation (installation, sécurité, contribution).
8. **Publication** — vérification complète, dépôt GitHub `Code-2.0` d'abord privé et relu, puis public.

Plus tard : WhatsApp (désactivé par défaut ; lecture seulement possible par un numéro WhatsApp Business), anglais, signature Apple.

## Avant chaque publication

- `npm run verifier:publication` : secrets reconnaissables, adresses IP publiques, fichiers interdits et mots de la liste locale, dans **tout l'historique**.
- La liste locale `.publication-interdits.txt` (noms de personnes, de clients, domaines) n'est jamais versionnée.
- La même commande lance ensuite gitleaks sur l'historique (`brew install gitleaks`) ; il tourne aussi dans l'intégration continue.
- Les modèles vocaux sont téléchargés à l'installation, jamais versionnés.
- Premier push sur un dépôt privé ; passage en public seulement sur accord explicite.
