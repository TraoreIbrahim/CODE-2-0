/**
 * Journal technique des cartes (MapLibre), envoyé au serveur comme celui du micro : sur un téléphone,
 * une carte restée noire ne dit rien à l'écran ; le journal dit à quelle étape elle s'est arrêtée.
 * Branché par useCode ; sans connexion (atelier), rien ne part.
 */

let sink: ((step: string) => void) | null = null

export function setMapTrace(fn: ((step: string) => void) | null): void {
  sink = fn
}

export function mapTrace(step: string): void {
  sink?.(`carte : ${step}`)
}
