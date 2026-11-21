// Données d'exemple des interfaces d'outils (atelier desktop, mode ?lab= du mobile en développement).
// Tout est fictif : noms, numéros et lieux inventés.
import type { UiAppareil, UiCamera, UiMaison, UiReunion, UiListe, UiListeElement, UiPersonne, UiAgenda, UiAgendaEvent, UiEcheance, UiAgendaJour, UiItem, UiItineraire, UiMailFil, UiMailRow, UiPapier, UiPapierLigne, UiRappel, UiView } from '@code/protocol'

const folders = ['Assistant vocal', 'Site vitrine', 'Application mobile', 'Tableau de bord', 'Boutique en ligne', 'Archives 2025', 'Maquettes', 'Clients', 'Factures', 'Contrats', 'Formations', 'Photos chantier']
const files: [string, string, string][] = [
  ['Devis salon.pdf', 'pdf', '412 Ko'],
  ['Planning T4.xlsx', 'xlsx', '88 Ko'],
  ['Présentation partenaires.key', 'key', '14.2 Mo'],
  ['Note de cadrage.docx', 'docx', '36 Ko'],
  ['Logo final.png', 'png', '1.1 Mo']
]
const items: UiItem[] = [
  ...folders.map((nom, i) => ({ nom, chemin: `~/Desktop/Projets/${nom}`, type: 'dossier' as const, detail: `${(i * 7) % 23 + 2} éléments`, date: `2026-10-${String(28 - i).padStart(2, '0')}` })),
  ...files.map(([nom, ext, detail], i) => ({ nom, chemin: `~/Desktop/Projets/${nom}`, type: 'fichier' as const, ext, detail, date: `2026-09-${String(20 - i).padStart(2, '0')}` }))
]

export const SAMPLES: Record<string, UiView[]> = {
  dossier: [{ id: 'a', turnId: 't', kind: 'dossier', title: '~/Desktop/Projets', status: 'pret', at: 2, data: { kind: 'dossier', chemin: '~/Desktop/Projets', dossiers: 12, fichiers: 5, items, autres: 0 } }],
  recherche: [
    { id: 'a', turnId: 't', kind: 'dossier', title: '~/Desktop/Projets', status: 'pret', at: 1, data: { kind: 'dossier', chemin: '~/Desktop/Projets', dossiers: 12, fichiers: 5, items, autres: 0 } },
    { id: 'b', turnId: 't', kind: 'recherche', title: '« devis »', status: 'pret', at: 2, data: { kind: 'recherche', requete: 'devis', total: 4, items: items.filter((i) => i.type === 'fichier').slice(0, 4) } }
  ],
  infos: [
    {
      id: 'c', turnId: 't', kind: 'infos', title: '~/Desktop/Projets', status: 'pret', at: 3,
      data: { kind: 'infos', chemin: '~/Desktop/Projets', nom: 'Projets', type: 'dossier', lignes: [
        { label: 'Sous-dossiers', valeur: '12' }, { label: 'Fichiers', valeur: '5' }, { label: 'Éléments au total', valeur: '15 738' },
        { label: 'Taille totale', valeur: '5.91 Go' }, { label: 'Créé le', valeur: '2026-02-09' }, { label: 'Modifié le', valeur: '2026-10-28' }
      ] }
    }
  ],
  document: [
    { id: 'd', turnId: 't', kind: 'document', title: '~/Desktop/Note de cadrage.docx', status: 'pret', at: 4,
      data: { kind: 'document', chemin: '~/Desktop/Note de cadrage.docx', nom: 'Note de cadrage.docx', ext: 'docx', tronque: false, media: 'texte', taille: '36 Ko', date: '2026-10-28',
        texte: 'NOTE DE CADRAGE\n\nObjet : nouveau site de l’association.\n\nContexte. Les inscriptions se font aujourd’hui sur papier ; les relances partent à la main.\n\nObjectif. Inscrire en ligne, payer la cotisation et recevoir les rappels par mail.\n\nPérimètre. Trois activités, deux cents adhérents, une mise en ligne avant la rentrée.' } }
  ],
  meteo: [
    { id: 'mt', turnId: 't', kind: 'meteo', title: 'Lyon', status: 'pret', at: 4,
      data: { kind: 'meteo', lieu: 'Lyon', maj: '19:16', source: 'MET Norway',
        maintenant: { temp: 27, ressenti: 30, ciel: 'eclaircies', libelle: 'Partiellement nuageux', nuit: true, vent: 17, humidite: 82, pluie: 0 },
        heures: [['21:00', 27, 'pluie', 0.5], ['22:00', 26, 'nuages', 0], ['23:00', 26, 'nuages', 0], ['00:00', 26, 'eclaircies', 0], ['01:00', 26, 'eclaircies', 0], ['02:00', 25, 'eclaircies', 0], ['03:00', 25, 'nuages', 0], ['04:00', 25, 'nuages', 0], ['05:00', 25, 'brouillard', 0], ['06:00', 25, 'nuages', 0], ['07:00', 26, 'eclaircies', 0], ['08:00', 27, 'soleil', 0]].map(([heure, temp, ciel, pluie]) => ({ heure: heure as string, temp: temp as number, ciel: ciel as 'soleil', nuit: Number((heure as string).slice(0, 2)) >= 19 || Number((heure as string).slice(0, 2)) < 6, pluie: pluie as number })),
        jours: [
          { jour: 'Demain', min: 26, max: 28, ciel: 'pluie', libelle: 'Averses faibles', pluie: 2.1 },
          { jour: 'Dim. 1', min: 25, max: 30, ciel: 'eclaircies', libelle: 'Partiellement nuageux', pluie: 0 },
          { jour: 'Lun. 2', min: 25, max: 31, ciel: 'orage', libelle: 'Averses orageuses', pluie: 8.4 },
          { jour: 'Mar. 3', min: 24, max: 29, ciel: 'nuages', libelle: 'Couvert', pluie: 0.2 },
          { jour: 'Mer. 4', min: 25, max: 31, ciel: 'soleil', libelle: 'Ciel dégagé', pluie: 0 }
        ] } }
  ],
  web: [
    { id: 'wb', turnId: 't', kind: 'web', title: '« marché de Noël Lyon 2026 »', status: 'pret', at: 4,
      data: { kind: 'web', requete: 'marché de Noël Lyon 2026', resultats: [
        { titre: 'Marché de Noël : dates, horaires et plan des chalets', site: 'exemple-ville.fr', url: 'https://www.exemple-ville.fr/agenda/marche-de-noel', resume: 'Du 27 novembre au 24 décembre, tous les jours de 11 h à 21 h ; 140 chalets.', date: '24 oct. 2026' },
        { titre: 'Les dix meilleurs marchés de Noël de la région', site: 'exemple-guide.fr', url: 'https://www.exemple-guide.fr/noel/marches', resume: 'Notre sélection, avec les nocturnes et les animations pour enfants.', date: '18 oct. 2026' },
        { titre: 'Venir en transports en commun', site: 'exemple-transports.fr', url: 'https://www.exemple-transports.fr/evenements/noel', resume: 'Lignes renforcées les week-ends de décembre.' }
      ] } }
  ],
  // ?kind=itineraire : trajet d’exemple de la gare au parc ; ?kind=position : le lieu seul.
  itineraire: [
    { id: 'it', turnId: 't', kind: 'itineraire', title: '05-17', status: 'pret', at: 4,
      data: { kind: 'itineraire', destination: { nom: 'Résidence Palm Club', code: '05-17', adresse: 'Rue des Jardins, Lyon', lat: 45.7799, lng: 4.8723 },
        depart: { nom: 'Votre position', lat: 45.7436, lng: 4.8203, source: 'appareil', precision: 25 },
        trajet: { km: 9.9, minutes: 13, mode: 'voiture', trace: [[45.7436, 4.82029], [45.74408, 4.82041], [45.74425, 4.82041], [45.74563, 4.82041], [45.74677, 4.82041], [45.74706, 4.82041], [45.74743, 4.82041], [45.74781, 4.82041], [45.74811, 4.82042], [45.74884, 4.82042], [45.7496, 4.82044], [45.75155, 4.82045], [45.75176, 4.82037], [45.75189, 4.82026], [45.75199, 4.82004], [45.75203, 4.81964], [45.75203, 4.81885], [45.75204, 4.81868], [45.75212, 4.81851], [45.75223, 4.81841], [45.75305, 4.81832], [45.75439, 4.81832], [45.75453, 4.81855], [45.75479, 4.82024], [45.75485, 4.821], [45.75486, 4.82379], [45.75482, 4.82715], [45.75485, 4.82774], [45.75505, 4.82833], [45.75568, 4.83017], [45.7558, 4.83067], [45.75583, 4.8317], [45.75588, 4.83253], [45.75593, 4.83302], [45.75598, 4.83381], [45.75606, 4.83454], [45.75604, 4.83528], [45.75592, 4.8358], [45.7561, 4.83613], [45.75647, 4.83615], [45.75735, 4.83625], [45.75826, 4.83636], [45.75889, 4.83645], [45.75968, 4.83655], [45.76007, 4.83659], [45.76233, 4.83687], [45.76319, 4.83697], [45.76389, 4.8371], [45.7645, 4.83715], [45.76616, 4.83734], [45.76745, 4.83748], [45.76842, 4.83758], [45.76866, 4.83863], [45.76897, 4.84066], [45.76913, 4.84178], [45.76929, 4.84304], [45.76934, 4.84363], [45.76935, 4.84443], [45.76932, 4.84512], [45.76921, 4.84607], [45.76922, 4.84749], [45.76931, 4.84837], [45.76949, 4.84921], [45.76994, 4.85083], [45.7701, 4.85132], [45.77044, 4.85243], [45.7706, 4.85305], [45.77111, 4.85477], [45.77148, 4.85592], [45.77163, 4.85645], [45.77208, 4.85786], [45.77234, 4.85875], [45.77275, 4.86001], [45.77331, 4.86184], [45.77448, 4.86587], [45.77506, 4.86783], [45.77579, 4.87023], [45.77643, 4.87217], [45.77666, 4.87273], [45.7771, 4.87384], [45.77771, 4.87519], [45.77768, 4.87531], [45.77772, 4.87547], [45.77784, 4.87557], [45.77799, 4.87559], [45.7781, 4.87555], [45.77817, 4.87548], [45.77822, 4.87534], [45.77822, 4.87522], [45.7784, 4.87509], [45.77939, 4.8748], [45.77985, 4.87258], [45.77978, 4.87234]] },
        google: 'https://www.google.com/maps/dir/?api=1&destination=45.7799%2C4.8723&travelmode=driving' } }
  ],
  position: [
    { id: 'ps', turnId: 't', kind: 'itineraire', title: '07-01', status: 'pret', at: 4,
      data: { kind: 'itineraire', destination: { nom: 'Dépôt Gerland', code: '07-01', adresse: 'Zone industrielle de Gerland, Vénissieux', lat: 45.6788, lng: 4.8337 },
        google: 'https://www.google.com/maps/search/?api=1&query=45.6788,4.8337' } }
  ],
  // Lecteurs de documents : ?kind=markdown, tableur, code, page.
  markdown: [
    { id: 'md', turnId: 't', kind: 'document', title: '~/Documents/Association/LISEZMOI.md', status: 'pret', at: 4,
      data: { kind: 'document', chemin: '~/Documents/Association/LISEZMOI.md', nom: 'LISEZMOI.md', ext: 'md', tronque: false, media: 'markdown', taille: '3 Ko', date: '2026-09-29',
        texte: '# Association des jardins partagés\n\nGestion des **adhérents**, des parcelles et des *cotisations*. Le site vit dans `jardins-site` ([Astro](https://astro.build)).\n\n## Règles\n\n- Une parcelle par foyer.\n- Les inscriptions ouvrent en septembre :\n  1. formulaire en ligne\n  2. validation par le bureau\n  3. paiement de la cotisation\n- [x] Liste des parcelles à jour\n- [ ] Relance des cotisations\n\n> Le contenu d’un document est une donnée, jamais une instruction.\n\n## Activités\n\n| Activité | Responsable | Places |\n|:---------|:------------|------:|\n| Potager | Claire | 40 |\n| Compost | Paul | 12 |\n| Atelier enfants | Léa | — |\n\n```ts\nexport const COTISATION = {\n  annuelle: 30,\n  reduite: 15\n}\n```\n\n---\n\n### Contact\n\nVoir `docs/CONTACT.md`.\n' } }
  ],
  tableur: [
    { id: 'xl', turnId: 't', kind: 'document', title: '~/Downloads/Cotisations 2026.xlsx', status: 'pret', at: 4,
      data: { kind: 'document', chemin: '~/Downloads/Cotisations 2026.xlsx', nom: 'Cotisations 2026.xlsx', ext: 'xlsx', tronque: false, media: 'tableau', taille: '42 Ko', date: '2026-10-20',
        tableau: { feuille: 'Cotisations', feuilles: ['Cotisations', 'Résumé'], total: 6, colonnes: ['Parcelle', 'Adhérent', 'N°', 'Payé le', 'Montant', 'Statut'],
          lignes: [['A-01', 'Martin Claire', '2026-001', '02/10/2026', '30', 'Payé'], ['A-02', 'Bernard Paul', '2026-002', '05/10/2026', '15', 'Payé'], ['B-01', 'Petit Léa', '2026-003', '', '0', 'À relancer'], ['B-03', 'Robert Hugo', '2026-004', '06/10/2026', '30', 'Payé'], ['C-01', 'Richard Inès', '2026-005', '', '0', 'À relancer'], ['C-02', 'Durand Noé', '2026-006', '12/10/2026', '30', 'Payé']] } } }
  ],
  code: [
    { id: 'cd', turnId: 't', kind: 'document', title: '~/Projets/jardins-site/src/cotisation.ts', status: 'pret', at: 4,
      data: { kind: 'document', chemin: '~/Projets/jardins-site/src/cotisation.ts', nom: 'cotisation.ts', ext: 'ts', tronque: false, media: 'code', taille: '1 Ko', date: '2026-10-29',
        texte: "import type { Adherent } from './types'\n\n/** Montant dû selon la situation de l'adhérent. */\nexport function cotisation(a: Adherent): number {\n  if (a.etudiant || a.sansEmploi) return 15\n  return 30\n}\n" } }
  ],
  page: [
    { id: 'pg', turnId: 't', kind: 'document', title: '~/Desktop/Note de cadrage.docx', status: 'pret', at: 4,
      data: { kind: 'document', chemin: '~/Desktop/Note de cadrage.docx', nom: 'Note de cadrage.docx', ext: 'docx', tronque: false, media: 'page', taille: '36 Ko', date: '2026-10-28',
        html: '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>body{font:15px/1.6 Georgia,serif;margin:48px 64px;color:#222}h1{font:600 22px Helvetica;letter-spacing:.04em}td,th{border:1px solid #ccc;padding:6px 10px}table{border-collapse:collapse}</style><h1>NOTE DE CADRAGE</h1><p><b>Objet :</b> nouveau site de l’association.</p><p>Les inscriptions se font aujourd’hui sur papier ; les relances partent à la main.</p><table><tr><th>Activité</th><th>Places</th></tr><tr><td>Potager</td><td>40</td></tr><tr><td>Compost</td><td>12</td></tr></table>' } }
  ],
  donnees: [
    { id: 'f', turnId: 't', kind: 'donnees', title: 'Factures', status: 'pret', at: 7,
      data: { kind: 'donnees', source: 'Comptabilité', titre: 'Factures du mois', total: 4,
        chiffres: [{ label: 'Factures', valeur: '12' }, { label: 'En retard', valeur: '2' }, { label: 'Encaissé', valeur: '84 %' }],
        colonnes: ['Client', 'N°', 'Objet', 'Montant', 'Statut'],
        lignes: [['Boulangerie du Parc', 'F-101', 'Site vitrine', '1 200', 'payée'], ['Cabinet Lemoine', 'F-102', 'Maintenance', '300', 'payée'], ['Garage des Lilas', 'F-103', 'Application', '2 400', 'en retard'], ['Librairie Saint-Jean', 'F-104', 'Formation', '450', 'envoyée']] } }
  ],
  chargement: [{ id: 'e', turnId: 't', kind: 'dossier', title: 'Bureau/Projets', status: 'chargement', at: 5 }]
}

// Exemples Gmail et Agenda fictifs (personnes, adresses et rendez-vous inventés).
const mailRows: UiMailRow[] = [
  { id: 'f1', de: 'Paul Bernard', deEmail: 'paul.bernard@imprimerie.example', initiales: 'PB', objet: 'Devis brochures – salon de printemps', extrait: 'Bonjour Madame Martin, comme convenu voici le devis pour les 500 brochures et les kakémonos. Livraison possible dès lundi si…', quand: '09:42', nonLu: true, important: true, messages: 3, pieces: 1 },
  { id: 'f2', de: 'Léa Petit', deEmail: 'lea.petit@example.com', initiales: 'LP', objet: 'Dîner samedi ?', extrait: 'On a réservé à La Table Ronde à 20 h, tu confirmes pour toi et Hugo ?', quand: '08:15', nonLu: true, important: false, messages: 1, pieces: 0 },
  { id: 'f3', de: 'Banque Exemple', deEmail: 'alertes@banque.example', initiales: 'BE', objet: 'Votre relevé d’octobre est disponible', extrait: 'Votre relevé de compte du mois d’octobre 2026 est disponible dans votre espace client.', quand: 'hier', nonLu: false, important: true, messages: 1, pieces: 1 },
  { id: 'f4', de: 'Inès Richard', deEmail: 'ines.richard@cabinet.example', initiales: 'IR', objet: 'Re: Statuts de l’association – relecture', extrait: 'J’ai repris les articles 4 et 9 comme tu l’avais demandé. Il reste la question du quorum.', quand: 'lun. 26', nonLu: false, important: true, messages: 6, pieces: 2 },
  { id: 'f5', de: 'Compagnie Aérienne', deEmail: 'noreply@vols.example', initiales: 'CA', objet: 'Votre carte d’embarquement LYS → BCN', extrait: 'Vol EX 512 du 4 novembre, départ 07:35. Présentez-vous au comptoir au plus tard 2 h avant…', quand: 'lun. 26', nonLu: true, important: true, messages: 1, pieces: 1 },
  { id: 'f6', de: 'Hugo Robert', deEmail: 'hugo.robert@example.com', initiales: 'HR', objet: 'Photos des vacances', extrait: 'Je t’envoie les photos de la plage, il y en a des très belles des enfants.', quand: '24.10', nonLu: false, important: false, messages: 2, pieces: 12 }
]
SAMPLES.mails = [{ id: 'm', turnId: 't', kind: 'mails', title: 'Mails importants', status: 'pret', at: 20, data: { kind: 'mails', titre: 'Mails importants', compte: 'claire.martin@gmail.com', total: 23, nonLus: 7, lignes: mailRows, pager: { tool: 'gmail_importants', args: {}, page: 1, pages: 3, total: 23, parPage: 10 } } }]

const filDevis: UiMailFil = {
  kind: 'mail', id: 'f1', objet: 'Devis brochures – salon de printemps', compte: 'claire.martin@gmail.com',
  badges: [{ label: 'NON LU', tone: 'info' }, { label: 'IMPORTANT', tone: 'attention' }, { label: '3 MESSAGES' }],
  messages: [
    { id: 'a', de: 'Paul Bernard', deEmail: 'paul.bernard@imprimerie.example', initiales: 'PB', a: 'Vous', quand: 'lun. 26 oct. · 11:05', texte: 'Bonjour Madame Martin,\n\nSuite à notre échange, pouvez-vous me confirmer le nombre de brochures pour le salon ?', tronque: false, pieces: [], moi: false },
    { id: 'b', de: 'Claire Martin', deEmail: 'claire.martin@gmail.com', initiales: 'CM', a: 'Paul Bernard', quand: 'lun. 26 oct. · 14:20', texte: 'Bonjour Paul,\n\n500 brochures et deux kakémonos. Livraison avant le 5 novembre si possible.\n\nClaire', tronque: false, pieces: [], moi: true },
    { id: 'c', de: 'Paul Bernard', deEmail: 'paul.bernard@imprimerie.example', initiales: 'PB', a: 'Vous', cc: 'Service commercial', quand: 'mer. 29 oct. · 09:42', texte: 'Bonjour Madame Martin,\n\nComme convenu, voici le devis pour les 500 brochures et les 2 kakémonos : 1 240 € TTC.\n\nLivraison possible dès lundi 2 novembre si vous validez avant vendredi.\n\nBien cordialement,\nPaul Bernard\nImprimerie Exemple', tronque: false, pieces: [{ nom: 'Devis-2026-118.pdf', taille: '239 Ko' }], moi: false }
  ]
}
SAMPLES.mail = [{ id: 'n', turnId: 't', kind: 'mail', title: 'Fil', status: 'pret', at: 21, data: filDevis }]
SAMPLES.brouillon = [{ id: 'o', turnId: 't', kind: 'mail', title: 'Brouillon', status: 'pret', at: 22, data: {
  ...filDevis, badges: [{ label: 'IMPORTANT', tone: 'attention' }, { label: '3 MESSAGES' }],
  brouillon: { id: 'r-8812', a: 'Paul Bernard <paul.bernard@imprimerie.example>', objet: 'Re: Devis brochures – salon de printemps', texte: 'Bonjour Paul,\n\nC’est validé pour les 500 brochures et les 2 kakémonos. Livraison lundi 2 novembre au bureau, merci de prévenir l’accueil la veille.\n\nBien à vous,\nClaire', statut: { label: 'BROUILLON · NON ENVOYÉ', tone: 'attention' }, enAttente: false }
} }]

const day = (date: string, label: string, aujourdhui: boolean, evenements: UiAgendaEvent[], libres?: UiAgendaJour['libres']): UiAgendaJour => ({ date, label, aujourdhui, evenements, ...(libres ? { libres } : {}) })
const evt = (id: string, titre: string, debut: string, fin: string, etat: UiAgendaEvent['etat'], extra: Partial<UiAgendaEvent> = {}): UiAgendaEvent => {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
  return { id, titre, debut, fin, de: m(debut), a: m(fin), journee: false, visio: false, participants: 0, etat, ...extra }
}
const today: UiAgendaEvent[] = [
  evt('e1', 'Point équipe technique', '08:30', '09:15', 'passe', { visio: true, participants: 5 }),
  evt('e2', 'Comité de pilotage', '10:00', '11:30', 'en_cours', { lieu: 'Salle Rhône, 3e étage', participants: 3 }),
  evt('e3', 'Déjeuner Paul Bernard', '12:30', '14:00', 'a_venir', { lieu: 'Café des Arts' }),
  evt('e4', 'Visio partenaires Barcelone', '15:00', '16:00', 'a_venir', { visio: true, participants: 4, reponse: { label: 'À RÉPONDRE', tone: 'attention' } }),
  evt('e5', 'Appel fournisseur traiteur', '15:30', '16:00', 'a_venir', { participants: 1 }),
  evt('e6', 'Sport · Footing au parc', '18:30', '19:30', 'a_venir')
]
const agendaJour: UiAgenda = {
  kind: 'agenda', titre: 'Aujourd’hui', sousTitre: 'JEUDI 29 OCTOBRE · 6 ÉVÉNEMENTS', compte: 'claire.martin@gmail.com',
  kpis: [{ label: 'Événements', valeur: '06', tone: 'info' }, { label: 'Temps occupé', valeur: '5 h 45', jauge: 48, tone: 'info' }, { label: 'Restants aujourd’hui', valeur: '04', tone: 'attention' }],
  prochain: { id: 'e3', titre: 'Déjeuner Paul Bernard', quand: 'Aujourd’hui · 12:30 → 14:00', dans: 'dans 1 h 25', lieu: 'Café des Arts', visio: false },
  plage: { de: 480, a: 1200 }, maintenant: 665,
  jours: [day('2026-10-29', 'JEU 29', true, [{ ...evt('t', 'Vacances scolaires', '', '', 'en_cours'), de: 0, a: 1440, journee: true }, ...today])]
}
SAMPLES.agenda = [{ id: 'p', turnId: 't', kind: 'agenda', title: 'Agenda', status: 'pret', at: 23, data: agendaJour }]
SAMPLES.semaine = [{ id: 'q', turnId: 't', kind: 'agenda', title: 'Agenda', status: 'pret', at: 24, data: {
  ...agendaJour, titre: 'Cette semaine', sousTitre: 'DU 26.10 AU 01.11 · 17 ÉVÉNEMENTS',
  kpis: [{ label: 'Événements · semaine', valeur: '17', tone: 'info' }, { label: 'Temps occupé', valeur: '19 h 30', tone: 'info' }, { label: 'Restants aujourd’hui', valeur: '04', tone: 'attention' }],
  jours: [
    day('2026-10-26', 'LUN 26', false, [evt('w1', 'Comité de direction', '09:00', '11:00', 'passe', { participants: 6 }), evt('w2', 'Visite du salon', '14:00', '16:30', 'passe', { lieu: 'Parc des expositions' })]),
    day('2026-10-27', 'MAR 27', false, [evt('w3', 'Recrutement · 3 entretiens', '10:00', '12:30', 'passe'), evt('w4', 'Dentiste', '17:00', '17:45', 'passe')]),
    day('2026-10-28', 'MER 28', false, [evt('w5', 'Point banque', '09:30', '10:30', 'passe'), evt('w6', 'Atelier site web', '14:00', '18:00', 'passe')]),
    day('2026-10-29', 'JEU 29', true, today),
    day('2026-10-30', 'VEN 30', false, [evt('w7', 'Réunion des bénévoles', '08:00', '10:00', 'a_venir', { lieu: 'Maison des associations' }), evt('w8', 'Déjeuner Léa', '13:00', '14:30', 'a_venir')]),
    day('2026-10-31', 'SAM 31', false, [evt('w9', 'Dîner La Table Ronde', '20:00', '22:30', 'a_venir')]),
    day('2026-11-01', 'DIM 1', false, [])
  ]
} }]
SAMPLES.disponibilites = [{ id: 's', turnId: 't', kind: 'agenda', title: 'Disponibilités', status: 'pret', at: 25, data: {
  ...agendaJour, titre: 'Disponibilités', sousTitre: 'JEUDI 29 OCTOBRE · 6 ÉVÉNEMENTS · CRÉNEAUX DE 1 H · 08:00 → 18:00', duree: 60, plage: { de: 480, a: 1080 },
  kpis: [...agendaJour.kpis.slice(0, 2), { label: 'Créneaux ≥ 1 h', valeur: '01', detail: '1 H LIBRE', tone: 'ok' }],
  jours: [day('2026-10-29', 'JEU 29', true, today.slice(0, 5), [{ de: 960, a: 1080, debut: '16:00', fin: '18:00' }])]
} }]
SAMPLES.rendezvous = [{ id: 'u', turnId: 't', kind: 'agenda', title: 'Nouveau rendez-vous', status: 'pret', at: 26, data: {
  ...agendaJour, titre: 'Nouveau rendez-vous',
  jours: [day('2026-10-29', 'JEU 29', true, [...today.slice(0, 4), evt('propose', 'Validation du devis brochures', '16:30', '17:30', 'propose', { lieu: 'Imprimerie Exemple', reponse: { label: 'EN ATTENTE DE VOTRE OUI', tone: 'attention' } }), today[5]!])]
} }]

// Rappels fictifs : échéances calculées à partir de maintenant, pour voir le compte à rebours tourner.
const rap = (id: number, texte: string, minutes: number, extra: Partial<UiRappel> = {}): UiRappel => {
  const echeance = Date.now() + minutes * 60_000
  const d = new Date(echeance)
  return { id, texte, echeance, heure: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`, jour: minutes < 600 ? 'aujourd’hui' : 'demain', etat: 'a_venir', ...extra }
}
SAMPLES.rappels = [{ id: 'r', turnId: 't', kind: 'rappels', title: 'Rappels', status: 'pret', at: 30, data: {
  kind: 'rappels', titre: 'Rappels', sousTitre: '6 RAPPELS ACTIFS · 2 RÉCURRENTS', focus: 3,
  kpis: [{ label: 'Qui sonnent', valeur: '01', tone: 'attention' }, { label: 'Aujourd’hui', valeur: '02', tone: 'info' }, { label: 'Prochain', valeur: rap(0, '', 38).heure, detail: 'AUJOURD’HUI', tone: 'info' }, { label: 'Faits aujourd’hui', valeur: '02', tone: 'ok' }],
  groupes: [
    { label: 'Qui sonnent', rappels: [rap(1, 'Rappeler Paul Bernard pour le devis', -2, { etat: 'sonne' })] },
    { label: 'Aujourd’hui', rappels: [rap(2, 'Envoyer le planning de novembre à l’équipe', 38), rap(3, 'Passer prendre Hugo à l’école', 214, { de: 'Camille' })] },
    { label: 'Demain', rappels: [rap(4, 'Réunion Atlas : préparer la démo', 1260)] },
    { label: 'Récurrents', rappels: [rap(5, 'Point hebdo avec l’équipe technique', 2900, { recurrence: 'tous les lundis à 08:00', jour: 'lun. 2 nov.' }), rap(6, 'Payer le loyer', 9000, { recurrence: 'le 25 de chaque mois à 09:00', jour: 'mer. 25 nov.' })] },
    { label: 'Faits aujourd’hui', rappels: [rap(7, 'Valider les congés de Léa', -180, { etat: 'fait' }), rap(8, 'Renouveler l’assurance du véhicule', -95, { etat: 'fait' })] }
  ]
} }]

// ── Tâches planifiées ──
const soon = (minutes: number) => Date.now() + minutes * 60_000
const resumeText = `## Les nouvelles du jour

**À retenir** : la mairie ouvre les inscriptions au marché de Noël lundi ; le bus 12 change d’horaires en novembre.

**Agenda**
1. 10 h : comité de pilotage (salle Rhône).
2. 12 h 30 : déjeuner avec Paul Bernard.
3. 15 h : visio partenaires.

**Mails**
- Le devis des brochures attend votre réponse avant vendredi.
- Votre relevé bancaire d’octobre est disponible.

> Astuce : dites « prépare la réponse au devis » pour un brouillon.

**Météo** : 14 °C, averses en fin d’après-midi : prenez un parapluie.`
SAMPLES.taches = [{ id: 'tk', turnId: 't', kind: 'taches', title: 'Tâches planifiées', status: 'pret', at: 31, data: {
  kind: 'taches', titre: 'Tâches planifiées', sousTitre: '2 TÂCHES ACTIVES · PROCHAINE AUJOURD’HUI · 17:00', focus: 1,
  taches: [
    { id: 1, titre: 'Résumé du jour', consigne: 'Chaque jour à 17 h, résume ma journée : rendez-vous, mails importants, ce qui reste à faire demain. En français simple, en dix lignes au plus.', quand: 'tous les jours à 17:00', prochaine: soon(95), prochaineLabel: 'aujourd’hui · 17:00', etat: 'active', enCours: false, derniere: { id: 12, fin: soon(-1345), quand: 'hier à 17:01', statut: 'ok', resume: 'Trois rendez-vous, deux mails à traiter, le devis des brochures à valider.' } },
    { id: 2, titre: 'Bilan de la semaine', consigne: 'Chaque vendredi à 18 h, fais le bilan de la semaine : rendez-vous passés, mails restés sans réponse, ce qu’il faut décider lundi.', quand: 'tous les vendredis à 18:00', prochaine: soon(155), prochaineLabel: 'aujourd’hui · 18:00', etat: 'active', enCours: true },
    { id: 3, titre: 'Relance devis imprimerie', consigne: 'Regarde si l’imprimerie a répondu au devis ; sinon prépare un brouillon de relance.', quand: 'mar. 3 nov. à 09:00', prochaine: null, prochaineLabel: 'en pause', etat: 'pause', enCours: false }
  ]
} }]
SAMPLES.tache = [{ id: 'tr', turnId: 't', kind: 'tache', title: 'Résultat', status: 'pret', at: 32, data: {
  kind: 'tache', executionId: 12, tacheId: 1, titre: 'Résumé du jour', quand: 'hier à 17:01', statut: 'ok', retard: false,
  resume: 'Trois rendez-vous, deux mails à traiter, le devis des brochures à valider.', texte: resumeText,
  precedentes: [{ id: 11, quand: 'mer. 28 oct. à 17:01', statut: 'ok' }, { id: 10, quand: 'mar. 27 oct. à 17:02', statut: 'erreur' }]
} }]

const driveLink = (id: string) => `https://drive.google.com/file/d/${id}/view`
SAMPLES.drive = [{ id: 'dv', turnId: 't', kind: 'drive', title: 'Google Drive', status: 'pret', at: 33, data: {
  kind: 'drive', titre: 'Recherche Drive', requete: 'devis', compte: 'claire.martin@gmail.com', plus: false,
  items: [
    { id: 'f-asso', nom: 'Association des jardins partagés', type: 'dossier', format: 'Dossier', modifie: 'hier', lien: 'https://drive.google.com/drive/folders/f-asso' },
    { id: 'd-plan', nom: 'Plan du salon de printemps', type: 'document', format: 'Google Docs', modifie: '09:42', lien: driveLink('d-plan') },
    { id: 's-budget', nom: 'Budget salon 2026', type: 'tableur', format: 'Google Sheets', modifie: 'lun. 26', lien: driveLink('s-budget') },
    { id: 'p-devis', nom: 'Devis-2026-118.pdf', type: 'pdf', format: 'PDF', modifie: 'hier', taille: '239 Ko', proprietaire: 'Paul Bernard', lien: driveLink('p-devis') },
    { id: 'pr-pitch', nom: 'Présentation partenaires', type: 'presentation', format: 'Google Slides', modifie: '12.09', lien: driveLink('pr-pitch') },
    { id: 'x-factures', nom: 'Factures octobre (export).xlsx', type: 'tableur', format: 'Excel', modifie: '02.10', taille: '1,2 Mo', lien: driveLink('x-factures') },
    { id: 'i-stand', nom: 'Photo du stand.jpg', type: 'image', format: 'Image JPEG', modifie: '28.09', taille: '3,4 Mo', lien: driveLink('i-stand') }
  ]
} }]
SAMPLES.drive_fichier = [{ id: 'dd', turnId: 't', kind: 'drive_fichier', title: 'Fichier Drive', status: 'pret', at: 34, data: {
  kind: 'drive_fichier', id: 'd-resume', nom: 'Résumés — semaine 44', type: 'document', format: 'Google Docs', modifie: '17:02', lien: driveLink('d-resume'), tronque: false, cree: true,
  texte: '# Résumés — semaine 44\n\n| Jour | Sujet | Statut |\n|---|---|---|\n| Lundi | Préparation du salon | fait |\n| Mardi | Relance des cotisations | à faire |\n\n## Lundi\n\n**À retenir** : le stand est confirmé, les brochures arrivent lundi.\n\n- Réserver le traiteur.\n- Envoyer le planning aux bénévoles.'
} }, { id: 'df', turnId: 't', kind: 'drive_fichier', title: 'Fichier Drive', status: 'pret', at: 35, data: {
  kind: 'drive_fichier', id: 's-budget', nom: 'Budget salon 2026', type: 'tableur', format: 'Google Sheets', modifie: 'lun. 26', lien: driveLink('s-budget'), tronque: false,
  feuilles: [
    { nom: 'Dépenses', totalLignes: 6, totalColonnes: 4, lignes: [
      ['Poste', 'Quantité', 'Prix unitaire', 'Total'],
      ['Brochures', '500', '1,80 €', '900 €'],
      ['Kakémonos', '2', '170 €', '340 €'],
      ['Location du stand', '1', '600 €', '600 €'],
      ['Traiteur', '1', '450 €', '450 €'],
      ['Total', '', '', '2 290 €']
    ] },
    { nom: 'Bénévoles', totalLignes: 3, totalColonnes: 3, lignes: [['Créneau', 'Date', 'Bénévole'], ['Montage', '12.11.2026', 'Hugo'], ['Accueil', '13.11.2026', 'Léa']] }
  ]
} }]
// ?kind=mails_boites : Gmail et une boîte pro mêlés, avec le filtre par boîte.
SAMPLES.mails_boites = [{ id: 'mb', turnId: 't', kind: 'mails', title: 'Mails importants', status: 'pret', at: 20, data: { kind: 'mails', titre: 'Mails importants', total: 20, nonLus: 2618, boites: [{ nom: 'Gmail', nonLus: 1309, gmail: true }, { nom: 'Pro', nonLus: 1309 }], lignes: mailRows.map((m, i) => ({ ...m, id: `${m.id}-${i}`, boite: i % 3 === 2 ? 'Pro' : 'Gmail' })) } }]


// Connecteurs : réponses fictives de GitHub, Vercel et Expo mises en blocs par le serveur (connecteurs/rendu.ts).
SAMPLES.connecteur = [{"id": "cx1", "turnId": "t", "kind": "connecteur", "title": "GitHub · Pull requests", "status": "pret", "at": 1, "data": {"kind": "connecteur", "service": "github", "source": "GitHub", "titre": "Pull requests", "disposition": "cartes", "resume": [{"label": "pull requests", "valeur": "5"}, {"label": "ouvertes", "valeur": "2", "ton": "ouvert"}, {"label": "fusionnée", "valeur": "1", "ton": "fusionne"}, {"label": "brouillon", "valeur": "1", "ton": "brouillon"}, {"label": "dépôts", "valeur": "2"}], "cartes": [{"icone": "pr", "titre": "feat(stores): pages publiques de confidentialité et de suppression du compte", "numero": "#5", "statut": {"label": "Fusionnée", "ton": "fusionne"}, "contexte": "octocat/code", "puces": ["stores"], "auteur": "octocat", "date": "2026-11-01T06:00:00.000Z", "extrait": "Ajoute /confidentialite et /suppression-compte, exigées par l’App Store et Google Play.", "lien": "https://github.com/octocat/code/pull/5"}, {"icone": "pr", "titre": "Mode sombre : contraste des cartes", "numero": "#1", "statut": {"label": "Ouverte", "ton": "ouvert"}, "contexte": "octocat/code", "puces": ["télé"], "auteur": "octocat", "date": "2026-10-27T16:00:00.000Z", "extrait": "En attente de relecture.", "lien": "https://github.com/octocat/code/pull/1"}, {"icone": "pr", "titre": "Paiement mobile : confirmation par webhook", "numero": "#12", "statut": {"label": "Ouverte", "ton": "ouvert"}, "contexte": "octocat/orbit", "puces": ["paiement", "urgent"], "auteur": "octocat", "date": "2026-11-02T09:00:00.000Z", "extrait": "Le statut de la commande passe à « payée » à la réception du webhook du prestataire.", "lien": "https://github.com/octocat/orbit/pull/12"}, {"icone": "pr", "titre": "Catalogue : filtres par catégorie", "numero": "#11", "statut": {"label": "Brouillon", "ton": "brouillon"}, "contexte": "octocat/orbit", "auteur": "octocat", "date": "2026-10-31T08:00:00.000Z", "lien": "https://github.com/octocat/orbit/pull/11"}, {"icone": "pr", "titre": "Corrige le calcul des frais de livraison", "numero": "#9", "statut": {"label": "Fermée", "ton": "ferme"}, "contexte": "octocat/orbit", "auteur": "octocat", "date": "2026-10-25T04:00:00.000Z", "lien": "https://github.com/octocat/orbit/pull/9"}], "total": 5}}]
SAMPLES.connecteur_vercel = [{"id": "cx2", "turnId": "t", "kind": "connecteur", "title": "Vercel · Déploiements", "status": "pret", "at": 2, "data": {"kind": "connecteur", "service": "vercel", "source": "Vercel", "titre": "Déploiements", "disposition": "frise", "resume": [{"label": "déploiements", "valeur": "4"}, {"label": "réussis", "valeur": "2", "ton": "ok"}, {"label": "en cours", "valeur": "1", "ton": "encours"}, {"label": "en échec", "valeur": "1", "ton": "echec"}, {"label": "projets", "valeur": "3"}], "cartes": [{"icone": "deploiement", "titre": "Refonte du bandeau d’accueil", "statut": {"ton": "encours", "label": "Construction"}, "contexte": "atlas-landing", "puces": ["Aperçu", "refonte-hero"], "auteur": "octocat", "date": "2026-11-02T11:54:00.000Z", "lien": "https://atlas-landing-git-refonte.vercel.app"}, {"icone": "deploiement", "titre": "feat(voix): fin de phrase jugée au sens", "statut": {"ton": "ok", "label": "En ligne"}, "contexte": "assistant-web", "puces": ["Production", "main"], "auteur": "octocat", "date": "2026-11-01T16:00:00.000Z", "lien": "https://assistant-web.vercel.app"}, {"icone": "deploiement", "titre": "Tableau des commandes : pagination", "statut": {"ton": "echec", "label": "Échec"}, "contexte": "atlas-admin", "puces": ["Production", "main"], "auteur": "octocat", "date": "2026-11-01T08:00:00.000Z", "lien": "https://atlas-admin-x.vercel.app"}, {"icone": "deploiement", "titre": "pages publiques de confidentialité", "statut": {"ton": "ok", "label": "En ligne"}, "contexte": "assistant-web", "puces": ["Aperçu", "claude/pages-confidentialite"], "auteur": "octocat", "date": "2026-10-28T02:00:00.000Z", "lien": "https://assistant-web-git-pages.vercel.app"}], "total": 4}}]
SAMPLES.connecteur_expo = [{"id": "cx3", "turnId": "t", "kind": "connecteur", "title": "Expo · Builds", "status": "pret", "at": 3, "data": {"kind": "connecteur", "service": "expo", "source": "Expo", "titre": "Builds", "disposition": "frise", "resume": [{"label": "builds", "valeur": "3"}, {"label": "en cours", "valeur": "1", "ton": "encours"}, {"label": "en échec", "valeur": "1", "ton": "echec"}], "cartes": [{"icone": "android", "titre": "Android 1.3.0 (22)", "statut": {"ton": "encours", "label": "En cours"}, "puces": ["production"], "auteur": "octocat", "date": "2026-11-02T11:42:00.000Z", "extrait": "Paiement mobile dans l’app"}, {"icone": "ios", "titre": "iOS 1.2.4 (21)", "statut": {"ton": "ok", "label": "Réussi"}, "puces": ["production"], "auteur": "octocat", "date": "2026-11-01T10:00:00.000Z"}, {"icone": "ios", "titre": "iOS 1.2.4 (20)", "statut": {"ton": "echec", "label": "Échec"}, "puces": ["preview"], "auteur": "octocat", "date": "2026-11-01T09:00:00.000Z", "extrait": "Pod install : version de Firebase"}], "total": 3}}]
SAMPLES.connecteur_depots = [{"id": "cx4", "turnId": "t", "kind": "connecteur", "title": "GitHub · Dépôts", "status": "pret", "at": 4, "data": {"kind": "connecteur", "service": "github", "source": "GitHub", "titre": "Dépôts", "disposition": "grille", "resume": [{"label": "dépôts", "valeur": "3"}], "cartes": [{"icone": "depot", "titre": "code", "statut": {"label": "Privé", "ton": "neutre"}, "puces": ["TypeScript"], "extrait": "CODE, assistant vocal personnel", "date": "2026-11-02T10:00:00.000Z", "lien": "https://github.com/octocat/code", "faits": [{"label": "Étoiles", "valeur": "0"}, {"label": "Issues ouvertes", "valeur": "2"}]}, {"icone": "depot", "titre": "atlas-app", "statut": {"label": "Privé", "ton": "neutre"}, "puces": ["TypeScript"], "extrait": "Atlas — application mobile client (Expo / React Native)", "date": "2026-11-01T06:00:00.000Z", "lien": "https://github.com/octocat/atlas-app", "faits": [{"label": "Étoiles", "valeur": "1"}, {"label": "Issues ouvertes", "valeur": "0"}]}, {"icone": "depot", "titre": "orbit", "statut": {"label": "Public", "ton": "neutre"}, "puces": ["Dart"], "extrait": "Boutique en ligne", "date": "2026-10-29T18:00:00.000Z", "lien": "https://github.com/octocat/orbit", "faits": [{"label": "Étoiles", "valeur": "3"}, {"label": "Issues ouvertes", "valeur": "5"}]}], "total": 3}}]
SAMPLES.schema = [{"id": "sc", "turnId": "t", "kind": "schema", "title": "Excalidraw · Schéma", "status": "pret", "at": 5, "data": {"kind": "schema", "source": "Excalidraw", "titre": "Comment l’assistant vous répond", "id": "exemple", "elements": [{"type": "text", "id": "ti", "x": 180, "y": 14, "text": "Comment l’assistant vous répond", "fontSize": 28}, {"type": "rectangle", "id": "z", "x": 20, "y": 70, "width": 760, "height": 300, "backgroundColor": "#dbe4ff", "fillStyle": "solid", "roundness": {"type": 3}, "strokeColor": "#4a9eed", "strokeWidth": 1, "opacity": 35}, {"type": "ellipse", "id": "u", "x": 40, "y": 160, "width": 150, "height": 90, "backgroundColor": "#a5d8ff", "fillStyle": "solid", "strokeColor": "#4a9eed", "label": {"text": "Vous", "fontSize": 20}}, {"type": "arrow", "id": "a1", "x": 190, "y": 205, "width": 110, "height": 0, "points": [[0, 0], [110, 0]], "endArrowhead": "arrow", "label": {"text": "voix", "fontSize": 16}}, {"type": "rectangle", "id": "m", "x": 300, "y": 160, "width": 180, "height": 90, "backgroundColor": "#d0bfff", "fillStyle": "solid", "roundness": {"type": 3}, "strokeColor": "#8b5cf6", "label": {"text": "Serveur CODE 2.0", "fontSize": 20}}, {"type": "arrow", "id": "a2", "x": 480, "y": 205, "width": 110, "height": 0, "points": [[0, 0], [110, 0]], "endArrowhead": "arrow", "strokeStyle": "dashed", "label": {"text": "outils", "fontSize": 16}}, {"type": "diamond", "id": "c", "x": 590, "y": 140, "width": 170, "height": 130, "backgroundColor": "#b2f2bb", "fillStyle": "solid", "strokeColor": "#22c55e", "label": {"text": "Claude", "fontSize": 20}}, {"type": "rectangle", "id": "g", "x": 300, "y": 300, "width": 180, "height": 50, "backgroundColor": "#fff3bf", "fillStyle": "hachure", "roundness": {"type": 3}, "strokeColor": "#f59e0b", "label": {"text": "GitHub · Vercel · Expo", "fontSize": 16}}, {"type": "arrow", "id": "a3", "x": 390, "y": 250, "width": 0, "height": 50, "points": [[0, 0], [0, 50]], "endArrowhead": "triangle", "strokeColor": "#f59e0b"}], "camera": {"x": 0, "y": 0, "width": 800, "height": 600}}}]

SAMPLES.projet = [{"id": "pj1", "turnId": "t", "kind": "projet", "title": "Projet · atlas", "status": "pret", "at": 6, "data": {"kind": "projet", "nom": "atlas", "sante": "echec", "phrase": "2 échecs : le dernier déploiement de atlas-admin (feat/kyc), le build Android de Atlas.", "depots": [{"nom": "octocat/atlas-api", "lien": "https://github.com/octocat/atlas-api", "branche": "main", "prive": true, "pousse": "2026-11-02T10:05:00Z", "commits": [{"sha": "01167ee", "message": "feat(establishments): include partner KYC status in the admin list", "auteur": "octocat", "date": "2026-11-02T10:05:00Z", "lien": "https://github.com/octocat/atlas-api/commit/01167ee"}, {"sha": "9ac31b2", "message": "fix(auth): refresh tokens survive a server restart", "auteur": "octocat", "date": "2026-11-01T21:40:00Z", "lien": "https://github.com/octocat/atlas-api/commit/9ac31b2"}, {"sha": "4b8e0d1", "message": "chore: bump prisma to 6.2", "auteur": "octocat", "date": "2026-11-01T16:02:00Z", "lien": "https://github.com/octocat/atlas-api/commit/4b8e0d1"}], "prs": [{"numero": 41, "titre": "Paiement mobile : webhooks signés", "auteur": "octocat", "date": "2026-11-01T18:00:00Z", "lien": "https://github.com/octocat/atlas-api/pull/41", "brouillon": false}, {"numero": 39, "titre": "Brouillon : export comptable", "auteur": "octocat", "date": "2026-11-01T18:00:00Z", "lien": "https://github.com/octocat/atlas-api/pull/39", "brouillon": true}], "prsPlus": false, "ci": {"titre": "CI", "statut": {"label": "Réussi", "ton": "ok"}, "date": "2026-11-02T10:12:00Z", "lien": "https://github.com/octocat/atlas-api/actions/runs/1"}}, {"nom": "octocat/atlas-admin", "lien": "https://github.com/octocat/atlas-admin", "branche": "main", "prive": true, "pousse": "2026-11-02T11:18:00Z", "commits": [{"sha": "c992982", "message": "feat(kyc): review establishments from the KYC page", "auteur": "octocat", "date": "2026-11-02T11:18:00Z", "lien": "https://github.com/octocat/atlas-admin/commit/c992982"}, {"sha": "71d0aa4", "message": "fix(table): sticky header on Safari", "auteur": "octocat", "date": "2026-11-01T15:00:00Z", "lien": "https://github.com/octocat/atlas-admin/commit/71d0aa4"}], "prs": [], "prsPlus": false, "ci": {"titre": "Tests", "statut": {"label": "En cours", "ton": "encours"}, "date": "2026-11-02T11:20:00Z", "lien": "https://github.com/octocat/atlas-admin/actions/runs/1"}}, {"nom": "octocat/atlas-app", "lien": "https://github.com/octocat/atlas-app", "branche": "main", "prive": true, "pousse": "2026-10-25T21:40:19Z", "commits": [{"sha": "4d62deb", "message": "chore(profil): retirer la note sur DELETE /me, désormais disponible", "auteur": "octocat", "date": "2026-10-25T21:40:19Z", "lien": "https://github.com/octocat/atlas-app/commit/4d62deb"}], "prs": [], "prsPlus": false}], "sites": [{"nom": "atlas-admin", "lien": "https://admin.atlas.example", "framework": "nextjs", "production": {"statut": {"label": "En ligne", "ton": "ok"}, "cible": "production", "date": "2026-11-01T15:04:00Z", "branche": "main", "commit": "fix(table): sticky header on Safari", "lien": "https://vercel.com/octocat/atlas-admin/1"}, "dernier": {"statut": {"label": "Échec", "ton": "echec"}, "cible": "preview", "date": "2026-11-02T11:19:00Z", "branche": "feat/kyc", "commit": "feat(kyc): review establishments from the KYC page", "lien": "https://vercel.com/octocat/atlas-admin/2"}}, {"nom": "atlas-landing", "lien": "https://atlas.example", "framework": "vite", "production": {"statut": {"label": "En ligne", "ton": "ok"}, "cible": "production", "date": "2026-08-16T17:58:57Z", "branche": "main", "commit": "Nouvelle page Partenaires", "lien": "https://vercel.com/octocat/atlas-landing/1"}}], "applis": [{"nom": "Atlas", "id": "@octocat/atlas", "lien": "https://expo.dev/accounts/octocat/projects/atlas", "builds": [{"plateforme": "ios", "statut": {"label": "Réussi", "ton": "ok"}, "version": "1.2.4 (21)", "profil": "production", "date": "2026-11-01T10:00:00Z", "lien": "https://expo.dev/b/1"}, {"plateforme": "android", "statut": {"label": "Échec", "ton": "echec"}, "version": "1.3.0 (22)", "profil": "production", "date": "2026-11-02T09:30:00Z", "erreur": "Gradle build failed with unknown error. See logs for the \"Run gradlew\" phase for more information.", "lien": "https://expo.dev/b/2"}]}, {"nom": "Atlas Plus", "id": "@octocat/atlas-plus", "lien": "https://expo.dev/accounts/octocat/projects/atlas-plus", "builds": [{"plateforme": "ios", "statut": {"label": "En file", "ton": "attente"}, "version": "0.9.0 (5)", "profil": "preview", "date": "2026-11-02T11:25:00Z", "lien": "https://expo.dev/b/3"}]}], "manques": [], "verifieLe": 1793619900000}}]
SAMPLES.projet_ok = [{"id": "pj2", "turnId": "t", "kind": "projet", "title": "Projet · orbit", "status": "pret", "at": 7, "data": {"kind": "projet", "nom": "orbit", "sante": "ok", "phrase": "Tout est au vert.", "depots": [{"nom": "octocat/orbit", "lien": "https://github.com/octocat/orbit", "branche": "main", "prive": true, "pousse": "2026-11-01T19:00:00Z", "commits": [{"sha": "e1f2a3b", "message": "feat(panier): codes promo", "auteur": "octocat", "date": "2026-11-01T19:00:00Z", "lien": "https://github.com/octocat/orbit/commit/e1f2a3b"}, {"sha": "a9b8c7d", "message": "fix(checkout): arrondi des montants en centimes", "auteur": "octocat", "date": "2026-10-31T12:00:00Z", "lien": "https://github.com/octocat/orbit/commit/a9b8c7d"}], "prs": [], "prsPlus": false, "ci": {"titre": "CI", "statut": {"label": "Réussi", "ton": "ok"}, "date": "2026-11-01T19:02:00Z", "lien": "https://github.com/octocat/orbit/actions/runs/1"}}], "sites": [{"nom": "orbit", "lien": "https://orbit.example", "framework": "nextjs", "production": {"statut": {"label": "En ligne", "ton": "ok"}, "cible": "production", "date": "2026-11-01T19:05:00Z", "branche": "main", "commit": "feat(panier): codes promo", "lien": "https://vercel.com/x/orbit/1"}}], "applis": [], "manques": ["Expo : ajoutez un jeton d’accès (Réglages › Connecteurs › Expo) pour voir les builds"], "verifieLe": 1793619900000}}]

// ?kind=lieux : une recherche Google Maps (résumé à renvois, lieux numérotés) ; ?kind=trajet_google : un trajet de Google.
SAMPLES.lieux = [
  { id: 'lx', turnId: 't', kind: 'lieux', title: 'Google Maps · Recherche de lieux', status: 'pret', at: 4,
    data: { kind: 'lieux', requete: 'pharmacie de garde près de chez moi',
      resume: 'Plusieurs pharmacies sont ouvertes ce soir près de chez vous :\n* **Pharmacie des Deux-Rives** [0] est de garde jusqu’à 8 h, près de la place du Marché.\n* **Pharmacie Sainte-Cécile** [1], rue des Tilleuls, est bien notée pour son accueil.\n* **Pharmacie du Golf** [2] et **Pharmacie Saint-Jacques** [3] sont un peu plus loin, vers le parc.\nPensez à appeler avant de vous déplacer [0, 1].',
      lieux: [
        { n: 0, nom: 'Pharmacie des Deux-Rives', lat: 45.7828, lng: 4.8416, lien: 'https://maps.google.com/?cid=1', trajet: 'https://www.google.com/maps/dir/?api=1&destination=45.7828,4.8416', avis: 'https://maps.google.com/?cid=1&reviews' },
        { n: 1, nom: 'Pharmacie Sainte-Cécile', lat: 45.7761, lng: 4.8498, lien: 'https://maps.google.com/?cid=2', trajet: 'https://www.google.com/maps/dir/?api=1&destination=45.7761,4.8498', avis: 'https://maps.google.com/?cid=2&reviews', photos: 'https://maps.google.com/?cid=2&photos' },
        { n: 2, nom: 'Pharmacie du Golf', lat: 45.7632, lng: 4.8813, lien: 'https://maps.google.com/?cid=3', trajet: 'https://www.google.com/maps/dir/?api=1&destination=45.7632,4.8813' },
        { n: 3, nom: 'Pharmacie Saint-Jacques', lat: 45.7705, lng: 4.8699, lien: 'https://maps.google.com/?cid=4', trajet: 'https://www.google.com/maps/dir/?api=1&destination=45.7705,4.8699' }
      ],
      attribution: { titre: 'Google Maps', lien: 'https://maps.google.com' } } }
]
SAMPLES.trajet_google = SAMPLES.itineraire!.map((v) => ({
  ...v,
  id: 'itg',
  title: 'Google Maps · Itinéraire',
  data: { ...(v.data as UiItineraire), destination: { nom: 'Parc de la Tête d’Or, Lyon', lat: 45.77978, lng: 4.87234 }, depart: { nom: 'Gare Part-Dieu, Lyon', lat: 45.7436, lng: 4.82029, source: 'lieu' as const }, fournisseur: 'google' as const, trajet: { ...(v.data as UiItineraire).trajet!, minutes: 24 } }
}))

SAMPLES.contact = [{ id: 'ct', turnId: 't', kind: 'contacts', title: 'Contacts', status: 'pret', at: 36, data: {
  kind: 'contacts', requete: 'Paul Bernard',
  contacts: [{ nom: 'Paul Bernard', initiales: 'PB', fonction: 'Chargé d’affaires', organisation: 'Imprimerie Exemple', emails: ['paul.bernard@imprimerie.example'], telephones: [{ numero: '01 23 45 67 89', type: 'Bureau' }, { numero: '06 12 34 56 78', type: 'Mobile' }], adresse: '12 rue des Presses, 75011 Paris', anniversaire: '12 mars' }],
  mails: [{ id: 'f1', objet: 'Devis brochures – salon de printemps', quand: '09:12', nonLu: true }, { id: 'f2', objet: 'Bon à tirer kakémonos', quand: 'lun. 26', nonLu: false }],
  rendezVous: [{ titre: 'Déjeuner Paul Bernard', quand: 'Aujourd’hui · 12:30' }, { titre: 'Validation du devis brochures', quand: 'jeu. 5 nov. · 16:30' }]
} }]
SAMPLES.contacts = [{ id: 'cs', turnId: 't', kind: 'contacts', title: 'Contacts', status: 'pret', at: 37, data: {
  kind: 'contacts', requete: 'imprimerie',
  contacts: [
    { nom: 'Paul Bernard', initiales: 'PB', fonction: 'Chargé d’affaires', organisation: 'Imprimerie Exemple', emails: ['paul.bernard@imprimerie.example'], telephones: [{ numero: '06 12 34 56 78', type: 'Mobile' }] },
    { nom: 'Lucie Moreau', initiales: 'LM', organisation: 'Imprimerie Exemple', emails: ['compta@imprimerie.example'], telephones: [] },
    { nom: 'atelier@imprimerie.example', initiales: 'A', emails: ['atelier@imprimerie.example'], telephones: [], echange: true }
  ]
} }]

SAMPLES.piece_jointe = [{ id: 'pj', turnId: 't', kind: 'drive_fichier', title: 'Pièce jointe', status: 'pret', at: 38, data: {
  kind: 'drive_fichier', source: 'gmail', id: 'm1/budget-salon.csv', nom: 'budget-salon.csv', type: 'tableur', format: 'CSV', modifie: '', taille: '2 Ko', lien: 'https://mail.google.com/mail/#all/f1', tronque: false,
  feuilles: [{ nom: 'budget-salon', totalLignes: 4, totalColonnes: 3, lignes: [['Poste', 'Montant', 'Statut'], ['Brochures', '1 240', 'devis reçu'], ['Kakémonos', '380', 'à valider'], ['Traiteur', '2 100', 'réservé']] }]
} }]
SAMPLES.brouillon_pieces = [{ id: 'bp', turnId: 't', kind: 'mail', title: 'Brouillon', status: 'pret', at: 39, data: {
  ...filDevis,
  brouillon: { id: 'r-8813', a: 'Paul Bernard <paul.bernard@imprimerie.example>', objet: 'Re: Devis brochures – salon de printemps', texte: 'Bonjour Paul,\n\nVoici le bon de commande signé et le plan du stand.\n\nBien à vous,\nClaire', pieces: [{ nom: 'Bon de commande.pdf', taille: '182 Ko' }, { nom: 'Plan du stand.png', taille: '1,2 Mo' }], statut: { label: 'BROUILLON · NON ENVOYÉ', tone: 'attention' }, enAttente: false }
} }]

const ech = (id: number, titre: string, categorie: UiEcheance['categorie'], date: string, quand: string, jours: number, dans: string, extra: Partial<UiEcheance> = {}): UiEcheance => ({ id, titre, categorie, date, quand, jours, dans, etat: 'a_regler', ...extra })
SAMPLES.echeancier = [{ id: 'ec', turnId: 't', kind: 'echeancier', title: 'Échéancier', status: 'pret', at: 40, data: {
  kind: 'echeancier', titre: 'Échéancier', sousTitre: '9 ÉCHÉANCES À RÉGLER · 4 RÉCURRENTES', aujourdhui: '2026-11-04', horizon: 60, focus: 4,
  kpis: [{ label: 'En retard', valeur: '02', tone: 'alerte' }, { label: '7 prochains jours', valeur: '03', tone: 'attention' }, { label: 'À régler sous 30 jours', valeur: '1 562,80 €', tone: 'info' }, { label: 'Prochaine', valeur: '1 j', detail: 'ÉLECTRICITÉ', tone: 'attention' }],
  groupes: [
    { label: 'En retard', tone: 'alerte', echeances: [ech(1, 'Cantine de novembre', 'facture', '2026-10-31', 'sam. 31 oct.', -4, 'en retard de 4 jours', { montant: '96,40 €' }), ech(2, 'Contrôle technique', 'document', '2026-11-02', 'lun. 2 nov.', -2, 'en retard de 2 jours', { note: 'garage Martin, sur rendez-vous' })] },
    { label: 'Cette semaine', tone: 'attention', echeances: [ech(3, 'Électricité', 'facture', '2026-11-05', 'jeu. 5 nov.', 1, 'demain', { montant: '84,90 €', recurrence: 'tous les mois', note: 'prélèvement' }), ech(4, 'Loyer', 'loyer', '2026-11-05', 'jeu. 5 nov.', 1, 'demain', { montant: '1 150 €', recurrence: 'tous les mois' }), ech(5, 'Box internet', 'abonnement', '2026-11-10', 'mar. 10 nov.', 6, 'dans 6 jours', { montant: '29,99 €', recurrence: 'tous les mois' })] },
    { label: 'Ce mois-ci', tone: 'info', echeances: [ech(6, 'Assurance habitation', 'assurance', '2026-11-20', 'ven. 20 nov.', 16, 'dans 16 jours', { montant: '201,51 €', recurrence: 'tous les ans', note: 'contrat 88-2041' })] },
    { label: 'Plus tard', tone: 'neutre', echeances: [ech(7, 'Taxe d’habitation', 'impot', '2026-12-15', 'mar. 15 déc.', 41, 'dans 41 jours', { montant: '642 €' }), ech(8, 'Frais de scolarité', 'facture', '2026-12-18', 'ven. 18 déc.', 44, 'dans 44 jours', { montant: '250 000 F CFA' }), ech(9, 'Passeport de Léa', 'document', '2027-03-02', 'mar. 2 mars 2027', 118, 'dans 118 jours')] }
  ],
  reglees: [{ ...ech(10, 'Téléphone', 'abonnement', '2026-11-01', 'dim. 1 nov.', -3, 'il y a 3 jours', { montant: '19,99 €' }), etat: 'regle', regleLe: 'réglée le lun. 2 nov.' }]
} }]

/** Une fausse feuille photographiée (SVG), pour l'atelier : en-tête de l'émetteur, lignes, total. */
function feuille(emetteur: string, titre: string, total: string, teinte: string): string {
  const lignes = Array.from({ length: 9 }, (_, i) => `<rect x="34" y="${238 + i * 22}" width="${150 + ((i * 53) % 120)}" height="7" rx="2" fill="#c9ced6"/><rect x="${300 + ((i * 17) % 30)}" y="${238 + i * 22}" width="56" height="7" rx="2" fill="#c9ced6"/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 560"><rect width="420" height="560" fill="#f3f1ec"/><rect x="34" y="34" width="44" height="44" rx="8" fill="${teinte}"/><text x="92" y="54" font-family="Helvetica" font-size="17" font-weight="700" fill="#1d2430">${emetteur}</text><text x="92" y="74" font-family="Helvetica" font-size="11" fill="#6b7280">12 avenue des Tilleuls · Service clients</text><text x="34" y="132" font-family="Helvetica" font-size="24" font-weight="700" fill="#1d2430">${titre}</text><text x="34" y="158" font-family="Helvetica" font-size="12" fill="#6b7280">Référence FA-2026-11-0412 · Client 7730 1184</text><rect x="34" y="186" width="352" height="1" fill="#1d2430"/><text x="34" y="214" font-family="Helvetica" font-size="11" font-weight="700" fill="#1d2430">DÉTAIL</text>${lignes}<rect x="34" y="452" width="352" height="1" fill="#1d2430"/><text x="34" y="484" font-family="Helvetica" font-size="13" fill="#1d2430">Total à payer avant le 14/11/2026</text><text x="386" y="484" text-anchor="end" font-family="Helvetica" font-size="20" font-weight="700" fill="#1d2430">${total}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const factureElec = feuille('Énergie du Val', 'Facture', '84,90 €', '#2f7de1')
const papierRange: UiPapier = {
  kind: 'papier', id: 12, nom: 'IMG_2231.jpg', media: 'image', apercu: factureElec, recu: 'aujourd’hui à 10:42', taille: '412 Ko', etat: 'range',
  titre: 'Facture d’électricité — novembre 2026', categorie: 'facture', emetteur: 'Énergie du Val', resume: 'Consommation d’octobre ; prélèvement automatique le 14 novembre.',
  champs: [{ label: 'Montant', valeur: '84,90 €' }, { label: 'Date limite', valeur: '14 novembre 2026' }, { label: 'Référence', valeur: 'FA-2026-11-0412' }, { label: 'N° client', valeur: '7730 1184' }],
  rangement: { ou: 'drive', chemin: 'CODE 2.0 › Papiers › Factures', lien: 'https://drive.google.com/file/d/exemple/view' },
  echeance: { id: 3, titre: 'Électricité', quand: 'sam. 14 nov.', montant: '84,90 €' }
}
SAMPLES.papier = [{ id: 'pa', turnId: 't', kind: 'papier', title: '« Facture d’électricité — novembre 2026 »', status: 'pret', at: 41, data: papierRange }]
SAMPLES.papier_lecture = [{ id: 'pl', turnId: 't', kind: 'papier', title: 'Lecture du document', status: 'pret', at: 42, data: { kind: 'papier', id: 12, nom: 'IMG_2231.jpg', media: 'image', apercu: factureElec, recu: 'aujourd’hui à 10:42', taille: '412 Ko', etat: 'recu', champs: [] } }]
const ligne = (p: UiPapierLigne) => p
SAMPLES.papiers = [{ id: 'ps', turnId: 't', kind: 'papiers', title: 'Papiers', status: 'pret', at: 43, data: {
  kind: 'papiers', titre: 'Papiers', sousTitre: '5 PAPIERS', papiers: [
    ligne({ id: 12, nom: 'IMG_2231.jpg', media: 'image', apercu: factureElec, recu: 'aujourd’hui à 10:42', titre: 'Facture d’électricité — novembre 2026', categorie: 'facture', emetteur: 'Énergie du Val', echeance: 'sam. 14 nov.' }),
    ligne({ id: 11, nom: 'avis.pdf', media: 'pdf', recu: 'hier à 18:05', titre: 'Avis de taxe foncière 2026', categorie: 'impot', emetteur: 'Finances publiques', echeance: 'mar. 15 déc.' }),
    ligne({ id: 9, nom: 'IMG_2190.jpg', media: 'image', apercu: feuille('Mutuelle Soleil', 'Attestation', '—', '#18a46a'), recu: 'lun. 2 nov.', titre: 'Attestation de mutuelle 2026', categorie: 'sante', emetteur: 'Mutuelle Soleil' }),
    ligne({ id: 8, nom: 'IMG_2170.jpg', media: 'image', apercu: feuille('Agence des Quais', 'Quittance', '1 150,00 €', '#8b5cf6'), recu: 'sam. 31 oct.', titre: 'Quittance de loyer — octobre', categorie: 'logement', emetteur: 'Agence des Quais' }),
    ligne({ id: 7, nom: 'scan.jpg', media: 'image', apercu: feuille('Assurances du Port', 'Échéancier', '201,51 €', '#e0a019'), recu: 'jeu. 29 oct.' })
  ]
} }]

// ── Listes partagées ──
const qui = (prenom: string, teinte: number): UiPersonne => ({ prenom, teinte })
const claire = qui('Claire', 327)
const hugo = qui('Hugo', 104)
const camille = qui('Camille', 241)
const el = (id: number, texte: string, par: UiPersonne, extra: Partial<UiListeElement> = {}): UiListeElement => ({ id, texte, coche: false, par, ...extra })
const courses: UiListe = {
  kind: 'liste', id: 4, nom: 'Courses', mienne: true, restants: 6, focus: [9],
  partage: { mode: 'tous', libelle: 'Toute la maison', personnes: [claire, hugo, camille] },
  elements: [
    el(1, 'Lait demi-écrémé', claire, { quantite: '2' }),
    el(2, 'Œufs', claire, { quantite: '12' }),
    el(3, 'Pain de campagne', camille),
    el(5, 'Céréales au chocolat', hugo),
    el(6, 'Tomates', camille, { quantite: '1 kg' }),
    el(9, 'Lessive', claire),
    el(7, 'Beurre doux', claire, { coche: true, cochePar: camille }),
    el(8, 'Pommes', hugo, { coche: true, cochePar: hugo, quantite: '6' })
  ]
}
SAMPLES.liste = [{ id: 'li', turnId: 't', kind: 'liste', title: 'Liste', status: 'pret', at: 44, data: courses }]
SAMPLES.liste_privee = [{ id: 'lp', turnId: 't', kind: 'liste', title: 'Liste', status: 'pret', at: 45, data: {
  kind: 'liste', id: 5, nom: 'Choses à faire', mienne: true, restants: 3,
  partage: { mode: 'prive', libelle: 'Privée', personnes: [] },
  elements: [
    { id: 1, texte: 'Appeler le garage pour la révision', coche: false },
    { id: 2, texte: 'Renvoyer le colis', coche: false },
    { id: 3, texte: 'Prendre rendez-vous chez le dentiste', coche: false },
    { id: 4, texte: 'Changer l’ampoule du couloir', coche: true }
  ]
} }]
SAMPLES.listes = [{ id: 'ls', turnId: 't', kind: 'listes', title: 'Listes', status: 'pret', at: 46, data: {
  kind: 'listes', titre: 'Listes', sousTitre: '4 LISTES · 2 PARTAGÉES', listes: [
    { id: 4, nom: 'Courses', partage: courses.partage, restants: 6, total: 8, apercu: ['Lait demi-écrémé', 'Œufs', 'Pain de campagne', 'Céréales au chocolat'], modifie: 'il y a 5 min' },
    { id: 5, nom: 'Choses à faire', partage: { mode: 'prive', libelle: 'Privée', personnes: [] }, restants: 3, total: 4, apercu: ['Appeler le garage pour la révision', 'Renvoyer le colis', 'Prendre rendez-vous chez le dentiste'], modifie: 'hier' },
    { id: 6, nom: 'Vacances à la mer', partage: { mode: 'personnes', libelle: 'Avec Camille', personnes: [claire, camille] }, restants: 9, total: 11, apercu: ['Crème solaire', 'Maillots', 'Chargeurs', 'Jeux de cartes'], modifie: 'il y a 3 j' },
    { id: 7, nom: 'Cadeaux de Noël', partage: { mode: 'prive', libelle: 'Privée', personnes: [] }, restants: 0, total: 5, apercu: [], modifie: 'il y a 6 j' }
  ]
} }]

// ── Maison (Home Assistant) : une maison inventée ──
const app = (id: string, nom: string, type: UiAppareil['type'], etat: string, o: Partial<UiAppareil> = {}): UiAppareil => ({
  id, nom, type, etat, actif: false, basculable: !['serrure', 'alarme', 'portail', 'camera', 'capteur', 'detecteur'].includes(type), sensible: ['serrure', 'alarme', 'portail', 'camera'].includes(type), ...o
})
const maison: UiMaison = {
  kind: 'maison', titre: 'Maison', sousTitre: '4 PIÈCES · 15 APPAREILS · 4 EN MARCHE · 1 À VOIR', heure: '21:04', focus: ['light.plafonnier'],
  pieces: [
    { nom: 'Chambre', appareils: [
      app('sensor.t_chambre', 'Température', 'capteur', '24,8\u00a0°C'),
      app('sensor.h_chambre', 'Humidité', 'capteur', '58\u00a0%'),
      app('climate.clim_chambre', 'Clim', 'clim', '24,8\u00a0°C · froid', { actif: true, detail: 'consigne 22\u00a0°C' }),
      app('light.chevet', 'Chevet', 'lumiere', 'éteinte'),
      app('fan.plafond', 'Ventilateur', 'ventilateur', 'éteint')
    ] },
    { nom: 'Entrée', appareils: [
      app('binary_sensor.porte', 'Porte', 'detecteur', 'fermée'),
      app('lock.porte', 'Serrure', 'serrure', 'déverrouillée', { actif: true, alerte: true }),
      app('alarm_control_panel.maison', 'Alarme', 'alarme', 'désarmée'),
      app('camera.entree', 'Caméra entrée', 'camera', 'en direct')
    ] },
    { nom: 'Salon', appareils: [
      app('sensor.t_salon', 'Température', 'capteur', '22,1\u00a0°C'),
      app('binary_sensor.fenetre', 'Fenêtre', 'detecteur', 'ouverte', { actif: true }),
      app('light.plafonnier', 'Plafonnier', 'lumiere', 'allumée', { actif: true, detail: '70\u00a0%' }),
      app('light.lampe', 'Lampe de lecture', 'lumiere', 'allumée', { actif: true, detail: '35\u00a0%' }),
      app('media_player.tele', 'Télé', 'media', 'en lecture', { actif: true, detail: 'Netflix · volume 30\u00a0%' }),
      app('cover.volet', 'Volet', 'volet', 'fermé'),
      app('scene.cinema', 'Cinéma', 'scene', 'prêt')
    ] },
    { nom: 'Garage', appareils: [
      app('cover.garage', 'Porte du garage', 'portail', 'fermé'),
      app('switch.prise_atelier', 'Prise atelier', 'prise', 'hors ligne', { indisponible: true, basculable: false })
    ] }
  ]
}
SAMPLES.maison = [{ id: 'mai', turnId: 't', kind: 'maison', title: 'Maison', status: 'pret', at: 47, data: maison }]

/** Une fausse vue de caméra (SVG) : un perron la nuit, un colis devant la porte. */
const perron = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><defs><radialGradient id="l" cx="0.5" cy="0.15" r="0.7"><stop offset="0" stop-color="#6b6a5c"/><stop offset="1" stop-color="#151716"/></radialGradient></defs><rect width="960" height="540" fill="url(#l)"/><rect x="380" y="90" width="200" height="330" fill="#2a2620" stroke="#3a352d" stroke-width="6"/><circle cx="555" cy="270" r="7" fill="#8d8571"/><rect x="0" y="420" width="960" height="120" fill="#232421"/><rect x="300" y="410" width="360" height="14" fill="#3b3c37"/><rect x="430" y="372" width="96" height="58" fill="#7a5a36"/><rect x="430" y="392" width="96" height="6" fill="#9a7a50"/><circle cx="480" cy="60" r="16" fill="#f3e9b8" opacity="0.85"/></svg>')}`
const camera: UiCamera = { kind: 'camera', id: 'camera.entree', nom: 'Caméra entrée', piece: 'Entrée', image: perron, heure: '21:04:12' }
SAMPLES.camera = [{ id: 'cam', turnId: 't', kind: 'camera', title: 'Caméra', status: 'pret', at: 48, data: camera }]

// ── Réunions : une réunion inventée ──
const passagesReunion = [
  { a: '0:00', s: 0, texte: 'Bon, on commence. Le point du jour, c’est la page d’accueil du site. Camille, tu nous dis où on en est ? Alors, la maquette est validée depuis mardi, il reste les textes de la section tarifs et les captures d’écran du téléphone.' },
  { a: '2:04', s: 124, texte: 'Pour le budget, on reste sur ce qu’on avait dit : deux mille euros pour l’hébergement et le nom de domaine sur l’année, pas plus. Si on dépasse, on en reparle avant de signer quoi que ce soit.' },
  { a: '4:11', s: 251, texte: 'Sur la date, je propose qu’on vise vendredi pour la mise en ligne. Ça laisse jeudi pour relire. Claire, tu peux relire les textes avant jeudi midi ? Oui, je m’en occupe.' },
  { a: '6:20', s: 380, texte: 'Il reste la question de l’hébergement. On hésite entre deux offres, et on n’a pas tous les éléments. Camille se renseigne sur les délais de mise en service et on tranche lundi.' },
  { a: '8:02', s: 482, texte: 'Dernier point : les captures du téléphone. Il en faut trois, en mode clair et en mode sombre. Camille les envoie d’ici mercredi. Très bien, merci à tous, on s’arrête là.' }
]
const reunion: UiReunion = {
  kind: 'reunion', id: 12, titre: 'Point page d’accueil', quand: 'aujourd’hui à 10:02', duree: '9 min', dureeS: 560, etat: 'prete', source: 'micro',
  transcritPar: 'Groq Whisper · moins d’un centime',
  resume: 'La maquette de la page d’accueil est validée. La mise en ligne est visée vendredi, après une relecture des textes jeudi. Le budget de l’année est confirmé ; seul le choix de l’hébergeur reste à faire.',
  decisions: ['Mise en ligne vendredi', 'Budget de deux mille euros pour l’hébergement et le nom de domaine, sur l’année', 'Trois captures du téléphone, en mode clair et en mode sombre'],
  points: ['Quel hébergeur ? Deux offres en balance, à trancher lundi', 'Aucun dépassement du budget sans en reparler avant de signer'],
  mots: 214,
  actions: [
    { quoi: 'Relire les textes de la section tarifs', qui: 'Claire', quand: 'avant jeudi midi' },
    { quoi: 'Envoyer trois captures du téléphone, clair et sombre', qui: 'Camille', quand: 'd’ici mercredi' },
    { quoi: 'Se renseigner sur les délais de mise en service des deux hébergeurs', qui: 'Camille', quand: 'avant lundi' },
    { quoi: 'Prévenir l’équipe de la date de mise en ligne' }
  ],
  participants: ['Claire', 'Camille'],
  passages: passagesReunion
}
SAMPLES.reunion = [{ id: 're', turnId: 't', kind: 'reunion', title: 'Réunion', status: 'pret', at: 47, data: reunion }]
SAMPLES['reunion-recherche'] = [{ id: 'rr', turnId: 't', kind: 'reunion', title: 'Réunion', status: 'pret', at: 48, data: { ...reunion, recherche: 'hébergement', passages: [passagesReunion[1]!, passagesReunion[3]!].map((p) => ({ ...p, trouve: true })) } }]
SAMPLES['reunion-brute'] = [{ id: 'rb', turnId: 't', kind: 'reunion', title: 'Réunion', status: 'pret', at: 49, data: { ...reunion, titre: 'Réunion du 11 novembre, 10:02', resume: undefined, actions: [], decisions: [], points: [], participants: [] } }]
SAMPLES.reunions = [{ id: 'rs', turnId: 't', kind: 'reunions', title: 'Réunions', status: 'pret', at: 50, data: {
  kind: 'reunions', titre: 'Réunions', sousTitre: '5 réunions', reunions: [
    { id: 15, titre: 'Point hebdo avec Camille', quand: 'aujourd’hui à 16:00', duree: '12 min', etat: 'enregistrement', source: 'micro', debut: Date.now() - 12 * 60_000 - 40_000, progression: { transcrits: 5, recus: 6 } },
    { id: 14, titre: 'Réunion du 11 novembre, 14:30', quand: 'aujourd’hui à 14:30', duree: '47 min', etat: 'transcription', source: 'micro', progression: { transcrits: 9, recus: 24 } },
    { id: 12, titre: 'Point page d’accueil', quand: 'aujourd’hui à 10:02', duree: '9 min', etat: 'prete', source: 'micro', rangee: true, resume: 'La maquette est validée. Mise en ligne visée vendredi, après une relecture des textes jeudi. Budget confirmé à deux mille euros.' },
    { id: 9, titre: 'Entretien fournisseur', quand: 'hier à 16:15', duree: '1 h 12', etat: 'prete', source: 'fichier' },
    { id: 7, titre: 'Enregistrement importé le 6 novembre', quand: 'jeu. 6 nov. à 09:40', duree: '3 min', etat: 'erreur', source: 'fichier', erreur: 'Groq Whisper a refusé (401) : clé invalide.' }
  ]
} }]

// ── Mémoire et compétences : des notes et des méthodes inventées ──
SAMPLES.memoire = [{ id: 'me', turnId: 't', kind: 'memoire', title: 'Mémoire', status: 'pret', at: 51, data: {
  kind: 'memoire', titre: 'Ce que je sais de vous', sousTitre: '9 notes · 3 mots appris', focus: 'Préfère les réunions le matin, jamais après 17 h',
  rubriques: [
    { id: 'profil', nom: 'Vous', notes: [{ texte: 'Dirige une petite agence de design, à Lyon', date: '3 nov. 2026' }, { texte: 'Travaille surtout le matin ; le vendredi après-midi est réservé à la famille', date: '5 nov. 2026' }] },
    { id: 'projets', nom: 'Projets', notes: [{ texte: 'La page d’accueil du site doit sortir avant la fin du mois', date: '9 nov. 2026' }, { texte: 'Atlas est le projet de l’application mobile', date: '2 nov. 2026' }] },
    { id: 'contacts', nom: 'Personnes', notes: [{ texte: 'Camille est la graphiste de l’agence', date: '4 nov. 2026' }, { texte: 'M. Bernard est le comptable, à Villeurbanne', date: '4 nov. 2026' }, { texte: 'Claire relit tous les textes avant publication' }] },
    { id: 'preferences', nom: 'Préférences', notes: [{ texte: 'Préfère les réunions le matin, jamais après 17 h', date: '11 nov. 2026' }, { texte: 'Veut des réponses courtes, sans formule de politesse', date: '6 nov. 2026' }] }
  ],
  lexique: ['Villeurbanne', 'Lefebvre', 'Atlas']
} }]
SAMPLES.competence = [{ id: 'co', turnId: 't', kind: 'competence', title: 'Compétence', status: 'pret', at: 52, data: {
  kind: 'competence', id: 'relance-de-facture', nom: 'Relance de facture', description: 'Quand il faut relancer un client ou un fournisseur pour une facture impayée ou un paiement en retard.', modifie: 'modifiée le 2 nov. 2026', suivie: true,
  corps: '1. Retrouve le fil d’origine pour reprendre le bon interlocuteur, la référence, le montant et l’échéance.\n2. Prépare la relance, en réponse au fil d’origine :\n   - première relance : cordiale, elle suppose un oubli ;\n   - deuxième relance : plus ferme, demande une date de paiement précise ;\n   - jamais de menace ni de pénalité qu’il n’a pas demandée.\n3. Signe avec son nom seul.\n4. Propose un rappel dans sept jours pour vérifier le paiement.\n5. Le brouillon attend son accord : **ne l’envoie pas**.'
} }]
SAMPLES.competences = [{ id: 'cs', turnId: 't', kind: 'competences', title: 'Compétences', status: 'pret', at: 53, data: {
  kind: 'competences', titre: 'Compétences', sousTitre: '3 méthodes', competences: [
    { id: 'compte-rendu-de-reunion', nom: 'Compte rendu de réunion', description: 'Quand on me demande un compte rendu, un résumé ou les notes d’une réunion, d’un appel ou d’un rendez-vous.', etapes: 6 },
    { id: 'preparer-un-deplacement', nom: 'Préparer un déplacement', description: 'Quand il part en rendez-vous, en déplacement ou en voyage et demande de préparer le trajet ou la journée.', etapes: 5 },
    { id: 'relance-de-facture', nom: 'Relance de facture', description: 'Quand il faut relancer un client ou un fournisseur pour une facture impayée ou un paiement en retard.', etapes: 5 }
  ]
} }]
