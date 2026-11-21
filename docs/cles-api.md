# Clés API

CODE 2.0 ne fournit ni modèle ni voix : il utilise les services de votre choix, avec vos propres clés. Cette page explique quelles clés existent, où les coller et ce qu'elles coûtent.

## Abonnement ou clé API

Un **abonnement** grand public (ChatGPT Plus, Claude Pro…) donne accès à l'application du fournisseur. Il ne donne pas accès à son API pour une application tierce comme CODE 2.0.

Une **clé API** se crée dans la console développeur du fournisseur. Elle est facturée à l'usage : vous payez ce que vous consommez, en général par million de tokens pour un modèle, à la minute ou au caractère pour la voix. La plupart des fournisseurs demandent d'ajouter un moyen de paiement ou un crédit avant que la clé fonctionne.

Sans aucune clé de moteur, vous pouvez utiliser un modèle local, gratuit mais moins performant. Voir [Modèle local](modele-local.md).

## Ce qu'il faut au minimum

- **Un moteur**, pour que l'assistant réponde : une clé d'un des fournisseurs ci-dessous, ou Ollama.
- **Une clé de transcription**, pour lui parler à voix haute.
- **Une clé de synthèse**, pour qu'il réponde à voix haute.

Sans clé de voix, l'assistant fonctionne par écrit, avec le mode chat. Une même clé couvre parfois plusieurs usages : une clé OpenAI sert de moteur, de voix et de transcription.

## Les moteurs

Dans Réglages › Moteurs, vous choisissez un fournisseur et un modèle pour trois usages : la conversation, les réponses rapides, les tâches planifiées.

| Fournisseur | Clé | Où la créer | Modèles proposés pour commencer |
| --- | --- | --- | --- |
| Claude (Anthropic) | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/settings/keys) | `claude-opus-5-5`, `claude-haiku-5-5` |
| OpenAI | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) | `gpt-5.5`, `gpt-5.4-mini` |
| Google Gemini | `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com/apikey) | `gemini-pro-latest`, `gemini-flash-latest` |
| Mistral | `MISTRAL_API_KEY` | [console.mistral.ai](https://console.mistral.ai/api-keys) | `mistral-medium-latest`, `mistral-small-latest` |
| DeepSeek | `DEEPSEEK_API_KEY` | [platform.deepseek.com](https://platform.deepseek.com/api_keys) | `deepseek-v4-flash` |
| OpenRouter | `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai/settings/keys) | `openrouter/auto` (des centaines de modèles avec une seule clé) |
| Groq | `GROQ_API_KEY` | [console.groq.com](https://console.groq.com/keys) | `openai/gpt-oss-120b`, `llama-3.3-70b-versatile` |
| Ollama (sur votre machine) | aucune | [ollama.com](https://ollama.com) | `qwen3` |

La liste complète des modèles se lit chez le fournisseur, avec votre clé, au moment du choix. Les catalogues changent souvent : le banc d'essai de Réglages › Moteurs dit si un modèle tient la route avec l'assistant (voir [Modèle local](modele-local.md#le-banc-dessai)).

Claude a une recherche web intégrée. Les autres moteurs cherchent sur le web avec une clé **Brave Search** (`BRAVE_API_KEY`, à créer sur [api-dashboard.search.brave.com](https://api-dashboard.search.brave.com/app/keys)), ou avec un SearXNG de l'installation (`CODE_SEARXNG_URL`, voir [Configuration](configuration.md)).

## La voix

Dans Réglages › Sa voix (la page « Voix de Nova »), chacun choisit qui transcrit ce qu'il dit et qui parle pour l'assistant. Voir aussi [Voix](voix.md).

### Transcription (ce que vous dites)

| Service | Clé | Particularité |
| --- | --- | --- |
| ElevenLabs Scribe | `ELEVENLABS_API_KEY` | Le plus juste en français et sur les noms propres. |
| Deepgram | `DEEPGRAM_API_KEY` | Le plus rapide : le texte s'écrit pendant que vous parlez. |
| Groq Whisper | `GROQ_API_KEY` | Très rapide et peu cher. |
| Mistral Voxtral | `MISTRAL_API_KEY` | Européen, bon en français. |
| OpenAI | `OPENAI_API_KEY` | Juste, un peu plus lent. |

Avec une clé Deepgram, le texte s'affiche aussi en direct, quel que soit le service qui écrit la phrase finale.

### Synthèse (la voix de l'assistant)

| Service | Clé | Particularité |
| --- | --- | --- |
| ElevenLabs | `ELEVENLABS_API_KEY` | Les voix les plus naturelles. Où créer la clé : [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys). |
| OpenAI | `OPENAI_API_KEY` | Naturelle, avec la même clé que les moteurs GPT. |
| Deepgram Aura | `DEEPGRAM_API_KEY` | Très rapide ; deux voix françaises. Où créer la clé : [console.deepgram.com](https://console.deepgram.com). |
| Google Gemini | `GEMINI_API_KEY` | Avec la même clé que les moteurs Gemini ; démarre moins vite. |

En mode « Automatique » (par défaut), l'assistant prend le premier service dont vous avez la clé, dans l'ordre des tableaux.

## Où coller les clés

Dans l'app : **Réglages › Clés API**. Chaque service y a sa ligne, avec le lien vers la page où créer la clé. Collez la clé, puis « Enregistrer ». Le premier lancement propose la même étape.

- La clé est chiffrée sur le serveur. Elle ne s'affiche plus ensuite : l'écran montre seulement ses quatre derniers caractères (`•••• abcd`).
- « Retirer » l'efface.
- Une clé rangée sur le serveur par le propriétaire (`npm run secrets` ou variable d'environnement) apparaît chez lui comme « CLÉ DU SERVEUR ».

## Chaque compte a ses clés

Une installation peut avoir plusieurs comptes (Réglages › Comptes). Chacun range ses propres clés dans son coffre : ses échanges sont facturés sur ses comptes, jamais sur ceux d'un autre.

Les clés du serveur (`npm run secrets`, variables d'environnement) ne servent qu'au propriétaire. Une autre personne de la maison doit coller les siennes, ou utiliser le modèle local, qui n'a pas de clé et sert à toute l'installation.

## Ce que cela coûte

Les prix changent souvent et diffèrent beaucoup d'un modèle à l'autre. Consultez la page tarifs de chaque fournisseur avant de choisir :

- [Anthropic](https://www.anthropic.com/pricing), [OpenAI](https://openai.com/api/pricing), [Google Gemini](https://ai.google.dev/pricing), [Mistral](https://mistral.ai/pricing), [DeepSeek](https://api-docs.deepseek.com/quick_start/pricing), [OpenRouter](https://openrouter.ai/models), [Groq](https://groq.com/pricing) ;
- [ElevenLabs](https://elevenlabs.io/pricing), [Deepgram](https://deepgram.com/pricing), [Brave Search](https://brave.com/search/api/).

En pratique :

- un modèle « rapide » coûte beaucoup moins cher qu'un modèle « puissant » ; c'est lui qui répond aux questions simples ;
- une recherche web ajoute un coût à la question ;
- la voix est facturée en plus du modèle, par le service de voix.

### Suivre et plafonner la dépense

**Réglages › Consommation** montre ce que coûtent vos échanges avec le modèle : aujourd'hui, ce mois, et la répartition par usage, avec le nombre d'appels et de tokens. Le compteur prend les tarifs de la configuration, sinon ceux du catalogue public d'OpenRouter (relu chaque jour), sinon le tarif du modèle le plus cher, par prudence. Un modèle local compte zéro.

Au même endroit, le **plafond par jour** (1, 2, 3, 5 ou 10 dollars, ou sans plafond ; 3 par défaut) limite la dépense : au-delà, l'assistant répond avec le modèle rapide jusqu'à minuit. Une notification prévient à 80 %, puis à 100 %.

Le compteur suit les échanges avec le modèle. Pour la voix, consultez le tableau de bord de votre fournisseur. Pour les réunions, la fiche de chaque réunion affiche une estimation du coût de la transcription.

Le banc d'essai de Réglages › Moteurs coûte quelques centimes par modèle testé, sur votre clé.
