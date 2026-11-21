/**
 * Un seul contexte audio pour le micro et la voix de CODE, à la fréquence de l'appareil.
 * Sur iPhone, deux contextes à des fréquences différentes (micro 48 kHz, voix 24 kHz)
 * pendant que le micro est ouvert hachaient la voix ; le rééchantillonnage se fait
 * maintenant dans les AudioBuffer (24 kHz), pas dans un second contexte.
 */
let shared: AudioContext | null = null

export function audioContext(): AudioContext {
  shared ??= new AudioContext({ latencyHint: 'interactive' })
  return shared
}

/** À appeler pendant le toucher, avant toute attente : Safari ne laisse démarrer l'audio que là. */
export function primeAudio(): void {
  try {
    const ctx = audioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    shared = null
  }
}

/** Le contexte s'il existe déjà (sans le créer). */
export function existingAudioContext(): AudioContext | null {
  return shared
}
