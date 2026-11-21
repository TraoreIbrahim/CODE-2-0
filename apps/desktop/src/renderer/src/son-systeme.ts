/**
 * Le son de l'ordinateur (ce que jouent Zoom, Meet, Teams…), pour l'enregistrement d'une réunion : demandé au
 * processus principal par `getDisplayMedia` (voir main/index.ts, sans sélecteur). L'image ne nous sert pas :
 * coupée aussitôt. Renvoie null si le son n'est pas disponible : sur macOS, sans l'autorisation
 * « Enregistrement de l'écran et de l'audio système », la piste arrive déjà terminée, sans erreur.
 */
export async function sonSysteme(): Promise<MediaStream | null> {
  if (!navigator.mediaDevices?.getDisplayMedia) return null
  let flux: MediaStream
  try {
    flux = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 320, height: 240, frameRate: 1 } })
  } catch {
    return null
  }
  for (const t of flux.getVideoTracks()) t.stop()
  const audio = flux.getAudioTracks()[0]
  // Laisse à une piste refusée le temps de se terminer.
  await new Promise((ok) => setTimeout(ok, 400))
  if (!audio || audio.readyState !== 'live') {
    for (const t of flux.getTracks()) t.stop()
    return null
  }
  return flux
}
