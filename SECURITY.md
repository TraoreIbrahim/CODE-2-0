# Sécurité

CODE 2.0 lit vos mails, votre agenda et vos fichiers, et range vos clés API. Une faille compte donc beaucoup : merci de la signaler avec soin.

## Signaler une faille

- **N'ouvrez pas d'issue publique.**
- Utilisez le signalement privé de GitHub : onglet **Security** du dépôt, puis **Report a vulnerability**. Seul le mainteneur le voit.
- Décrivez la faille, comment la reproduire, et ce qu'elle permet. Une preuve de concept minimale aide beaucoup.
- Vous recevez une première réponse sous sept jours. Une fois la faille corrigée, elle est publiée avec votre nom si vous le souhaitez.

## Versions suivies

Seule la dernière version de la branche `main` reçoit les corrections de sécurité.

## Ce qui est dans le périmètre

- Une action qui envoie, supprime ou modifie sans le « oui » de la personne.
- Un compte qui accède aux données, aux clés ou aux connecteurs d'un autre compte de la même installation.
- Une clé ou un accès lisible en clair hors de la machine du serveur.
- Une injection (mail, document, page web) qui fait agir l'assistant contre la personne.
- Un appareil qui s'associe sans le code ou le QR du propriétaire.

## Hors périmètre

- Un serveur exposé sur internet sans HTTPS, ou avec un port ouvert à tous : la documentation demande HTTPS ([docs/securite.md](docs/securite.md)).
- Les failles des services tiers (fournisseurs de modèles, de voix, Google).
