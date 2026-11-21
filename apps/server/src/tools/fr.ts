/**
 * Libellés français pour l'affichage des données brutes (résultats des connecteurs) : les services renvoient
 * des noms de champs (`createdAt`) et des valeurs d'énumération (`in_progress`) ; l'interface les montre en
 * français.
 */

/** Noms de champs connus → intitulé. */
const KEYS: Record<string, string> = {
  total: 'Total',
  name: 'Nom',
  firstName: 'Prénom',
  lastName: 'Nom',
  fullName: 'Nom complet',
  code: 'Code',
  label: 'Libellé',
  description: 'Description',
  status: 'Statut',
  state: 'État',
  type: 'Type',
  category: 'Catégorie',
  priority: 'Priorité',
  date: 'Date',
  createdAt: 'Créé le',
  updatedAt: 'Mis à jour le',
  created_at: 'Créé le',
  updated_at: 'Mis à jour le',
  reason: 'Motif',
  message: 'Message',
  address: 'Adresse',
  phone: 'Téléphone',
  email: 'E-mail',
  active: 'Actif',
  enabled: 'Activé',
  color: 'Couleur',
  size: 'Taille',
  url: 'Adresse',
  branch: 'Branche',
  version: 'Version',
  author: 'Auteur',
  owner: 'Propriétaire',
  subject: 'Objet',
  event: 'Événement'
}

/** Valeurs d'énumération courantes → libellé. */
const VALUES: Record<string, string> = {
  active: 'Actif',
  inactive: 'Inactif',
  pending: 'En attente',
  queued: 'En file',
  in_progress: 'En cours',
  open: 'Ouvert',
  closed: 'Fermé',
  merged: 'Fusionné',
  completed: 'Terminé',
  cancelled: 'Annulé',
  canceled: 'Annulé',
  approved: 'Approuvé',
  rejected: 'Rejeté',
  success: 'Réussi',
  failure: 'Échec',
  failed: 'Échec',
  error: 'Erreur',
  skipped: 'Ignoré',
  draft: 'Brouillon',
  scheduled: 'Planifié',
  ready: 'Prêt',
  building: 'En construction',
  sent: 'Envoyé',
  resolved: 'Résolu',
  confirmed: 'Confirmé',
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
  push: 'Envoi',
  pull_request: 'Demande de fusion',
  workflow_dispatch: 'Lancement manuel',
  schedule: 'Planifié',
  other: 'Autre'
}

/** Mots isolés, pour les champs qui ne sont pas dans KEYS. */
const WORDS: Record<string, string> = {
  count: 'nombre',
  total: 'total',
  date: 'date',
  time: 'heure',
  status: 'statut',
  type: 'type',
  name: 'nom',
  phone: 'téléphone',
  number: 'numéro',
  open: 'ouverts',
  active: 'actifs',
  last: 'dernier',
  next: 'prochain',
  start: 'début',
  end: 'fin',
  rate: 'taux',
  report: 'rapport',
  request: 'demande',
  requests: 'demandes',
  level: 'niveau',
  id: 'identifiant'
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Intitulé français d'un nom de champ (ou d'une valeur comme « pending »). */
export function frLabel(key: string): string {
  if (KEYS[key]) return KEYS[key]
  if (VALUES[key]) return VALUES[key]
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  return capitalize(words.map((w) => WORDS[w] ?? w).join(' '))
}

/** Date ISO → « 31/10/2026 14:05 » (ou la date seule à minuit UTC). */
export function frDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
  return /T00:00:00(\.0+)?Z?$/.test(iso) ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}`
}
