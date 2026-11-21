# Contribuer à CODE 2.0

Merci de votre intérêt. CODE 2.0 est un projet libre (AGPL-3.0), maintenu par une seule personne. Chaque changement est relu et validé par le mainteneur avant d'entrer dans le code.

## Comment ça se passe

- La branche `main` est protégée : personne n'y pousse directement. Tout passe par une **pull request**.
- Une pull request n'est fusionnée qu'avec l'**approbation du mainteneur** et une **CI verte** (tests, vérification de publication, Gitleaks).
- Pour un changement important (nouvel outil, nouveau connecteur, changement d'architecture), ouvrez d'abord une **issue** pour en discuter. Cela évite de coder quelque chose qui ne sera pas retenu.
- Les corrections de fautes, de documentation ou de petits bugs peuvent venir directement en pull request.

## Préparer son poste

Il faut [Node.js 24](https://nodejs.org).

```bash
npm ci
npm run dev
```

Aucune clé n'est nécessaire pour développer : avec [Ollama](https://ollama.com) installé, le serveur se sert du modèle local. Voir [docs/modele-local.md](docs/modele-local.md).

## Avant d'ouvrir une pull request

```bash
npm run typecheck
npm test
npm run build
npm run verifier
```

- `npm run verifier` refuse les secrets, les adresses IP publiques et les fichiers personnels, dans tout l'historique de votre branche.
- Ajoutez ou adaptez les tests qui couvrent votre changement (`node --test`, à côté du fichier testé).
- Une pull request = un sujet. Gardez-la petite : elle sera relue plus vite.

## Règles du code

- **Français** pour les noms, les commentaires, les messages et l'interface, comme le reste du code.
- **Sécurité d'abord** : lire et préparer est libre ; envoyer, supprimer ou modifier attend un « oui » de la personne, décidé par une règle fixe dans le code, jamais par le modèle. Une contribution qui contourne cette règle sera refusée.
- **Aucune donnée réelle** dans le code ni dans les tests : pas de vrais noms, adresses, numéros ou clés. Prenez des exemples fictifs (Camille, Léo, `exemple.fr`).
- **Aucun secret** : les clés se rangent dans Réglages › Clés API ou dans les variables d'environnement, jamais dans un fichier du dépôt.
- Pas de nouvelle dépendance sans en discuter : chaque dépendance est du code de plus à surveiller.

## Messages de commit

Le style [Conventional Commits](https://www.conventionalcommits.org/fr/), en français : `feat(moteurs): …`, `fix(mobile): …`, `docs: …`, `chore: …`.

## Signaler une faille

Ne l'ouvrez pas en issue publique : suivez [SECURITY.md](SECURITY.md).

## Licence

En proposant une contribution, vous acceptez qu'elle soit publiée sous la licence du projet, [GNU AGPL-3.0](LICENSE).
