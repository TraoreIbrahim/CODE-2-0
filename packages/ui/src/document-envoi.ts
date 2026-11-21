/**
 * Avant l'envoi d'un papier : un PDF part tel quel ; une photo est remise d'aplomb (orientation de l'appareil),
 * réduite à 2 000 pixels de côté et réencodée en JPEG (une photo de téléphone pèse 3 à 8 Mo, le texte reste lisible).
 */

const MAX_COTE = 2000
const QUALITE = 0.85
const TELS_QUELS = new Set(['image/jpeg', 'image/png', 'image/webp'])

export type DocumentPret = { data: Blob; type: string; nom: string }

/** Le type d'un fichier choisi ; le nom quand le système n'en donne pas (PDF partagé depuis une autre app). */
export function typeDocument(f: { name: string; type: string }): string {
  if (f.type) return f.type.toLowerCase()
  if (/\.pdf$/i.test(f.name)) return 'application/pdf'
  if (/\.jpe?g$/i.test(f.name)) return 'image/jpeg'
  if (/\.png$/i.test(f.name)) return 'image/png'
  return ''
}

/** « IMG_2231.HEIC » devient « IMG_2231.jpg ». */
export function nomJpeg(nom: string): string {
  return `${nom.replace(/\.(heic|heif|png|webp|jpe?g|gif|bmp|tiff?)$/i, '') || 'photo'}.jpg`
}

export async function preparerDocument(f: File): Promise<DocumentPret> {
  const type = typeDocument(f)
  if (type === 'application/pdf') return { data: f, type, nom: f.name }
  if (!type.startsWith('image/')) throw new Error('Envoyez une photo ou un PDF.')
  let img: ImageBitmap
  try {
    img = await createImageBitmap(f, { imageOrientation: 'from-image' })
  } catch {
    // Format que ce navigateur ne sait pas ouvrir (HEIC hors Safari) : tel quel s'il est lisible par le serveur.
    if (TELS_QUELS.has(type)) return { data: f, type, nom: f.name }
    throw new Error('Format de photo non pris en charge : reprenez-la avec l’appareil photo, ou envoyez un JPEG.')
  }
  const k = Math.min(1, MAX_COTE / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * k)
  canvas.height = Math.round(img.height * k)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  img.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITE))
  if (!blob) {
    if (TELS_QUELS.has(type)) return { data: f, type, nom: f.name }
    throw new Error('La photo n’a pas pu être préparée : réessayez.')
  }
  return { data: blob, type: 'image/jpeg', nom: nomJpeg(f.name) }
}
