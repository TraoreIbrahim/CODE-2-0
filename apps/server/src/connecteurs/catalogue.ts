import type { ServiceConnecteur } from '@code/protocol'

/**
 * Les services proposés dans Réglages › Connecteurs, relevés sur leur documentation et leurs serveurs le
 * 1er novembre 2026. Chacun a son serveur MCP distant, sauf Figma et Vercel : leurs serveurs MCP
 * n'acceptent que des applications approuvées, CODE passe donc par leur API avec un jeton (`natif`).
 */
export type Service = ServiceConnecteur & {
  /** Serveur MCP (ou API pour un connecteur natif). */
  url: string
  /** L'adresse dépend de l'installation (Coolify) : l'écran la demande. */
  urlLibre?: boolean
  /** En-têtes portant le jeton ; par défaut `Authorization: Bearer`. */
  entete?: (jeton: string) => Record<string, string>
  /** Ce que Claude doit savoir pour bien s'en servir, ajouté à la description de chaque outil. */
  consigne?: string
  /** Outils du serveur que CODE n'expose pas (CODE fait déjà mieux, ou gratuitement). */
  masques?: string[]
  /** Outils écrits par CODE sur l'API du service, au lieu d'un serveur MCP. */
  natif?: 'vercel' | 'figma' | 'homeassistant'
}

export const CATALOGUE: Service[] = [
  {
    id: 'github',
    nom: 'GitHub',
    description: 'Dépôts, pull requests, issues, tests (Actions), commits.',
    url: 'https://api.githubcopilot.com/mcp/',
    acces: 'jeton',
    aide: 'Jeton personnel : GitHub › Settings › Developer settings › Personal access tokens. Pour la lecture : repo, read:org, read:user (et workflow pour les Actions).',
    lien: 'https://github.com/settings/tokens'
  },
  {
    id: 'vercel',
    nom: 'Vercel',
    description: 'Projets, déploiements et leur état, journal de construction.',
    url: 'https://api.vercel.com',
    acces: 'jeton',
    natif: 'vercel',
    aide: 'Jeton : Vercel › Account Settings › Tokens (portée : votre compte ou l’équipe).',
    lien: 'https://vercel.com/account/tokens'
  },
  {
    id: 'figma',
    nom: 'Figma',
    description: 'Fichiers, pages et cadres, commentaires, projets d’équipe.',
    url: 'https://api.figma.com',
    acces: 'jeton',
    natif: 'figma',
    aide: 'Jeton personnel : Figma › Settings › Security › Personal access tokens, avec file_content:read, file_comments:read et projects:read.',
    lien: 'https://www.figma.com/settings'
  },
  {
    id: 'expo',
    nom: 'Expo',
    description: 'Builds et soumissions EAS, mises à jour, projets.',
    url: 'https://mcp.expo.dev/mcp',
    acces: 'oauth',
    complement: {
      libelle: 'Jeton d’accès Expo (facultatif)',
      aide: 'La connexion donne les builds, mises à jour et soumissions d’un projet ; le jeton permet en plus à l’assistant de lister tous vos projets. Expo › Account settings › Access tokens.',
      lien: 'https://expo.dev/settings/access-tokens'
    }
  },
  {
    id: 'trello',
    nom: 'Trello',
    description: 'Tableaux, listes et cartes.',
    url: 'https://mcp.trello.com/v1',
    acces: 'oauth'
  },
  {
    id: 'cloudinary',
    nom: 'Cloudinary',
    description: 'Médias : recherche, dossiers, transformations.',
    url: 'https://asset-management.mcp.cloudinary.com/mcp',
    acces: 'les_deux',
    entete: (jeton) => ({ 'cloudinary-url': jeton }),
    aide: 'Collez l’« API environment variable » : cloudinary://clé:secret@nom (Console › Settings › API Keys). Ou connectez-vous sans jeton.',
    lien: 'https://console.cloudinary.com/settings/api-keys'
  },
  {
    id: 'excalidraw',
    nom: 'Excalidraw',
    description: 'Schémas et diagrammes, dessinés à l’écran et ouvrables dans Excalidraw.',
    url: 'https://mcp.excalidraw.com/mcp',
    acces: 'aucun'
  },
  {
    // Relevé le 2 novembre 2026 : cinq outils, tous en lecture ; sans clé, la liste répond mais pas les appels.
    id: 'maps',
    nom: 'Google Maps',
    description: 'Lieux et adresses sur une carte, trajets et durées (voiture, à pied, transports).',
    url: 'https://mapstools.googleapis.com/mcp',
    acces: 'jeton',
    entete: (jeton) => ({ 'X-Goog-Api-Key': jeton }),
    // La météo de Google est payante et CODE a la sienne (outil meteo) : on ne l'expose pas.
    masques: ['lookup_weather'],
    consigne: 'sans lieu précisé, cherche autour de la ville de l’utilisateur, jamais ailleurs ; cite Google Maps comme source ; les liens sont à l’écran, ne les invente ni ne les lis',
    aide: 'Clé d’API Google Maps Platform : activez la facturation du projet, puis l’API « Maps Experience agent tools » (Bibliothèque d’API), et créez une clé limitée à cette API (Identifiants). 10 000 requêtes gratuites par mois, ensuite payant.',
    lien: 'https://console.cloud.google.com/apis/library/mapstools.googleapis.com'
  },
  {
    // La maison : Home Assistant parle à des milliers de marques ; CODE passe par son API REST (adresse + jeton).
    id: 'homeassistant',
    nom: 'Home Assistant',
    description: 'La maison : lumières, clim et chauffage, volets, télé, prises, serrures, alarme, caméras, de toutes marques.',
    url: 'http://homeassistant.local:8123',
    urlLibre: true,
    acces: 'jeton',
    natif: 'homeassistant',
    aide: 'Jeton : dans Home Assistant, cliquez sur votre profil (en bas à gauche) › Sécurité › Jetons d’accès longue durée › Créer un jeton. Adresse : celle de votre Home Assistant (http://homeassistant.local:8123, ou votre adresse Nabu Casa si CODE 2.0 tourne hors de chez vous). Le compte du jeton doit être administrateur pour que les pièces apparaissent.',
    lien: 'https://www.home-assistant.io/docs/authentication/#your-account-profile'
  },
  {
    id: 'coolify',
    nom: 'Coolify',
    description: 'Applications, déploiements, serveurs.',
    url: 'https://app.coolify.io/mcp',
    urlLibre: true,
    acces: 'jeton',
    aide: 'Activez d’abord le MCP : Coolify › Settings › Advanced › API and MCP. Jeton : Keys & Tokens › API Tokens (permission read, et read:sensitive pour les journaux). Adresse : https://votre-coolify/mcp.'
  },
  {
    id: 'sentry',
    nom: 'Sentry',
    description: 'Erreurs de production, problèmes et versions.',
    url: 'https://mcp.sentry.dev/mcp',
    acces: 'les_deux',
    entete: (jeton) => ({ 'Sentry-Bearer': jeton }),
    aide: 'Jeton : Settings › Account › API › Auth Tokens, avec org:read, project:read, team:read, event:read. Ou connectez-vous sans jeton.',
    lien: 'https://sentry.io/settings/account/api/auth-tokens/'
  },
  {
    id: 'supabase',
    nom: 'Supabase',
    description: 'Projets, tables, journaux (lecture seule).',
    url: 'https://mcp.supabase.com/mcp?read_only=true',
    acces: 'les_deux',
    aide: 'Jeton : supabase.com › Account › Access Tokens (il ouvre tout le compte ; l’assistant s’y connecte en lecture seule). Ou connectez-vous sans jeton.',
    lien: 'https://supabase.com/dashboard/account/tokens'
  },
  {
    id: 'linear',
    nom: 'Linear',
    description: 'Tickets, cycles, projets.',
    url: 'https://mcp.linear.app/mcp',
    acces: 'les_deux',
    aide: 'Clé API personnelle : Linear › Settings › Security & access › API keys (lecture). Ou connectez-vous sans jeton.',
    lien: 'https://linear.app/settings/account/security'
  },
  {
    id: 'notion',
    nom: 'Notion',
    description: 'Pages et bases de données.',
    url: 'https://mcp.notion.com/mcp',
    acces: 'oauth'
  }
]

export function serviceOf(id: string): Service | undefined {
  return CATALOGUE.find((s) => s.id === id)
}

/** Ce que l'écran reçoit du catalogue. */
export function catalogueInfo(): ServiceConnecteur[] {
  return CATALOGUE.map(({ id, nom, description, acces, aide, lien, urlLibre, complement }) => ({ id, nom, description, acces, ...(aide ? { aide } : {}), ...(lien ? { lien } : {}), ...(urlLibre ? { urlLibre } : {}), ...(complement ? { complement } : {}) }))
}

/** Les en-têtes qui portent le jeton d'un service. */
export function headersFor(service: string, jeton: string): Record<string, string> {
  return serviceOf(service)?.entete?.(jeton) ?? { Authorization: `Bearer ${jeton}` }
}
