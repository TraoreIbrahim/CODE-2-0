import { LEVEL_STEP_MS } from '@code/protocol'

/** Enveloppe de volume (0..1), une valeur par tranche de 20 ms, pour animer l'orbe en phase avec la voix. */
export function levels(pcm: Buffer, sampleRate: number): number[] {
  const step = Math.round((sampleRate * LEVEL_STEP_MS) / 1000)
  const samples = Math.floor(pcm.length / 2)
  const out: number[] = []
  for (let start = 0; start < samples; start += step) {
    const end = Math.min(samples, start + step)
    let sum = 0
    for (let i = start; i < end; i++) {
      const s = pcm.readInt16LE(i * 2) / 0x8000
      sum += s * s
    }
    const rms = Math.sqrt(sum / Math.max(1, end - start))
    out.push(Math.round(Math.min(1, rms * 4) * 100) / 100)
  }
  return out
}

/** Durée d'un morceau PCM 16 bits mono, en millisecondes. */
export function durationMs(bytes: number, sampleRate: number): number {
  return (bytes / 2 / sampleRate) * 1000
}

/** Encapsule du PCM 16 bits mono dans un fichier WAV (pour Whisper). */
export function wav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
