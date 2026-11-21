#!/usr/bin/env node
/**
 * Les icônes de CODE 2.0 : l'orbe « Onde » (packages/ui/src/orbes.ts) avec le regard en écoute
 * (Orb.tsx), figée à un instant calme. Mêmes boucles, mêmes couleurs que l'orbe à l'écran.
 * En dessous de 48 px, deux boucles plus épaisses et des yeux plus grands, pour rester lisible.
 *
 *   npm run icones
 *
 * Écrit les SVG, puis se relance dans Electron pour les rendre en PNG (le halo lumineux demande un
 * vrai navigateur), et assemble l'icône macOS avec `iconutil` quand il est là.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(RACINE, 'apps/mobile/public')
const BUREAU = join(RACINE, 'apps/desktop/build')

const DOT = '84,196,238'
const BRIGHT = '200,244,255'
/** L'instant et l'énergie où l'orbe est figée. */
const T = 4.8
const E = 0.25

/** Les boucles de l'Onde : [harmonique, vitesse, amplitude, couleur, épaisseur, opacité]. */
const BOUCLES = [
  [3, 1.3, 0.07, DOT, 7, 0.78],
  [5, -1.7, 0.06, BRIGHT, 4.6, 0.66],
  [7, 2.3, 0.045, DOT, 3.4, 0.54],
  [2, -0.9, 0.08, BRIGHT, 3, 0.42]
]
const BOUCLES_PETITES = [
  [3, 1.3, 0.07, DOT, 22, 0.95],
  [5, -1.7, 0.06, BRIGHT, 12, 0.8]
]

/** Le tracé d'une boucle, dans un carré de 512 centré. */
export function boucle(k, w, amp, c = 256, R = 236) {
  let d = ''
  for (let i = 0; i <= 240; i++) {
    const th = (i / 240) * Math.PI * 2
    const r = 0.8 + amp * (0.35 + 1.3 * E) * (Math.sin(k * th + T * w) + 0.4 * Math.sin((k + 2) * th - T * w * 0.7))
    d += `${i ? 'L' : 'M'}${(c + Math.cos(th) * r * R).toFixed(1)} ${(c + Math.sin(th) * r * R).toFixed(1)}`
  }
  return `${d}Z`
}

/**
 * L'icône en SVG (carré de 512).
 * - `petite` : la version pour 16 à 32 px ;
 * - `fond` : 'arrondi' (icône d'app, favicon), 'plein' (iOS et Android découpent eux-mêmes) ;
 * - `echelle` : l'orbe plus petite dans son fond (zone sûre des icônes masquables, grille macOS).
 */
export function icone({ petite = false, fond = 'arrondi', echelle = 1 } = {}) {
  const c = 256
  const R = 236
  const ex = R * 0.3
  const ey = c - R * 0.04
  const w = R * 0.15 * (petite ? 1.25 : 1)
  const H = R * 0.34 * (petite ? 1.1 : 1)
  const oeil = (x) => `<rect x="${(x - w / 2).toFixed(1)}" y="${(ey - H / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${H.toFixed(1)}" rx="${(w / 2).toFixed(1)}" fill="rgb(${BRIGHT})"/>`
  const traits = (petite ? BOUCLES_PETITES : BOUCLES)
    .map(([k, v, amp, rgb, lw, a]) => `<path d="${boucle(k, v, amp)}" fill="none" stroke="rgb(${rgb})" stroke-opacity="${a}" stroke-width="${lw}" stroke-linejoin="round"/>`)
    .join('\n      ')
  const orbe = `<circle cx="256" cy="256" r="${R * 0.8}" fill="url(#h)"/>
    <g filter="url(#l)">
      ${traits}
    </g>
    <g filter="url(#y)">${oeil(c - ex)}${oeil(c + ex)}</g>`
  const decale = echelle === 1 ? orbe : `<g transform="translate(${256 * (1 - echelle)} ${256 * (1 - echelle)}) scale(${echelle})">\n    ${orbe}\n  </g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="f" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#0d1c24"/><stop offset=".6" stop-color="#060b10"/><stop offset="1" stop-color="#020407"/></radialGradient>
    <radialGradient id="h" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="rgb(${DOT})" stop-opacity=".22"/><stop offset="1" stop-color="rgb(${DOT})" stop-opacity="0"/></radialGradient>
    <filter id="l" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${petite ? 6 : 5}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="y" x="-100%" y="-60%" width="300%" height="220%"><feGaussianBlur stdDeviation="${petite ? 14 : 16}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  ${fond === 'plein' ? '<rect width="512" height="512" fill="url(#f)"/>' : '<rect width="512" height="512" rx="114" fill="url(#f)"/>'}
  ${decale}
</svg>
`
}

/** macOS : l'icône occupe 824 px sur 1024, centrée (grille des icônes d'app). */
function iconeMac(petite) {
  const svg = icone({ petite })
  return svg.replace('viewBox="0 0 512 512"', 'viewBox="-50 -50 612 612"')
}

/** Ce qu'il faut rendre : [fichier, svg, taille]. */
function rendus(iconset) {
  const grande = iconeMac(false)
  const petite = iconeMac(true)
  const liste = [
    [join(PUBLIC, 'icon-192.png'), icone(), 192],
    [join(PUBLIC, 'icon-512.png'), icone(), 512],
    [join(PUBLIC, 'icon-maskable-512.png'), icone({ fond: 'plein', echelle: 0.8 }), 512],
    [join(PUBLIC, 'apple-touch-icon.png'), icone({ fond: 'plein', echelle: 0.92 }), 180],
    [join(PUBLIC, 'favicon-32.png'), icone({ petite: true }), 32],
    [join(BUREAU, 'icon.png'), grande, 1024]
  ]
  for (const n of [16, 32, 128, 256, 512]) {
    liste.push([join(iconset, `icon_${n}x${n}.png`), n <= 32 ? petite : grande, n])
    liste.push([join(iconset, `icon_${n}x${n}@2x.png`), n * 2 <= 32 ? petite : grande, n * 2])
  }
  return liste
}

/** Dans Electron : chaque SVG dessiné sur un canevas à sa taille exacte, puis enregistré en PNG. */
async function rendreDansElectron(iconset) {
  const { app, BrowserWindow } = await import('electron')
  app.dock?.hide()
  await app.whenReady()
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<meta charset="utf-8">')
  for (const [fichier, svg, taille] of rendus(iconset)) {
    const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
    const png = await win.webContents.executeJavaScript(`new Promise((ok, ko) => {
      const img = new Image()
      img.onload = () => {
        const cv = document.createElement('canvas')
        cv.width = cv.height = ${taille}
        cv.getContext('2d').drawImage(img, 0, 0, ${taille}, ${taille})
        ok(cv.toDataURL('image/png').split(',')[1])
      }
      img.onerror = () => ko(new Error('SVG illisible'))
      img.src = ${JSON.stringify(url)}
    })`)
    mkdirSync(dirname(fichier), { recursive: true })
    writeFileSync(fichier, Buffer.from(png, 'base64'))
  }
  app.quit()
}

function principal() {
  writeFileSync(join(PUBLIC, 'icon.svg'), icone())
  writeFileSync(join(PUBLIC, 'favicon.svg'), icone({ petite: true }))
  const dossier = mkdtempSync(join(tmpdir(), 'code2-icones-'))
  const iconset = join(dossier, 'icon.iconset')
  try {
    const electron = createRequire(import.meta.url)('electron')
    const r = spawnSync(electron, [fileURLToPath(import.meta.url), '--rendre', iconset], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error('le rendu des PNG dans Electron a échoué')
    if (process.platform === 'darwin') {
      const i = spawnSync('iconutil', ['-c', 'icns', iconset, '-o', join(BUREAU, 'icon.icns')], { stdio: 'inherit' })
      if (i.status !== 0) throw new Error('iconutil a échoué')
    } else console.log('Hors macOS : icon.icns n’est pas régénéré.')
  } finally {
    rmSync(dossier, { recursive: true, force: true })
  }
  console.log('Icônes écrites dans apps/mobile/public et apps/desktop/build.')
}

const i = process.argv.indexOf('--rendre')
// Sans `await` : Electron n'est prêt qu'une fois ce module fini de charger.
if (process.versions.electron && i >= 0)
  rendreDansElectron(process.argv[i + 1]).catch((e) => {
    console.error(e)
    process.exit(1)
  })
else if (process.argv[1] === fileURLToPath(import.meta.url)) principal()
