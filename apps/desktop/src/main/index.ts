import { BrowserWindow, app, clipboard, desktopCapturer, globalShortcut, ipcMain, powerMonitor, screen, session, shell, systemPreferences } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { codeConfig } from '../../../../config/code.config'
import { installerPont } from './pont'

/** Adresse du serveur : `desktop.serverUrl` de la configuration (`CODE_SERVER_URL`). */
const SERVER_URL = codeConfig.desktop.serverUrl
const MAC = process.platform === 'darwin'

/** Le dossier de données du système, comme le serveur (apps/server/src/paths.ts). */
function systemDataDir(): string {
  if (MAC) return join(homedir(), 'Library', 'Application Support')
  if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  return process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
}

/** Le même dossier que le serveur (pas « Code » seul : sur macOS, c'est celui de VS Code). */
const DATA_DIR = process.env.CODE_DATA_DIR || join(systemDataDir(), 'code-2')
/**
 * Écrit par le serveur au démarrage (droits 0600) : le jeton du propriétaire, pour l'ordinateur où tourne le
 * serveur. Simple fichier lu au lancement ; un autre ordinateur s'associe par un code.
 */
const TOKEN_PATH = join(DATA_DIR, 'device-token')
const MINI_MARGIN = 24

// Données Chromium de l'app à part, sinon elles iraient dans le dossier de VS Code.
app.setPath('userData', join(DATA_DIR, 'desktop'))
/**
 * Jeton propre à l'app, obtenu à la connexion (droits 0600). Absent : on prend celui du serveur.
 * Vide : déconnecté, l'écran de connexion s'affiche (le jeton du serveur n'est plus repris).
 */
const OWN_TOKEN_PATH = join(app.getPath('userData'), 'device-token')

let main: BrowserWindow | null = null
let mini: BrowserWindow | null = null
let quitting = false

function load(win: BrowserWindow, page: 'index' | 'mini'): void {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) void win.loadURL(`${dev}/${page}.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`))
}

function preload(): string {
  return join(__dirname, '../preload/index.js')
}

function createMain(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#04070B',
    ...(MAC ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 20 } } : { autoHideMenuBar: true }),
    webPreferences: {
      preload: preload(),
      contextIsolation: true,
      sandbox: true,
      // Fenêtre cachée ou en arrière-plan : sans ça, Chromium espace ses minuteries (1 par minute)
      // et la page croyait le serveur injoignable toutes les deux minutes.
      backgroundThrottling: false
    }
  })
  win.once('ready-to-show', () => win.show())
  // Fermer la fenêtre la cache : l'assistant reste disponible dans la miniature.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win.hide()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  load(win, 'index')
  return win
}

function createMini(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  const size = 112
  const win = new BrowserWindow({
    width: size,
    height: size,
    x: workArea.x + workArea.width - size - MINI_MARGIN,
    y: workArea.y + workArea.height - size - MINI_MARGIN,
    // Panneau macOS (NSPanel) : flotte au-dessus des apps, suit les bureaux, ne vole pas le focus.
    ...(MAC ? { type: 'panel' } : {}),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: preload(),
      contextIsolation: true,
      sandbox: true,
      // Fenêtre cachée ou en arrière-plan : sans ça, Chromium espace ses minuteries (1 par minute)
      // et la page croyait le serveur injoignable toutes les deux minutes.
      backgroundThrottling: false
    }
  })
  const pin = () => {
    win.setAlwaysOnTop(true, 'floating')
    // Sur tous les bureaux, y compris les apps en plein écran ; sans toucher à l'icône du Dock.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  }
  pin()
  win.once('ready-to-show', () => {
    pin()
    win.showInactive()
  })
  win.on('show', pin)
  load(win, 'mini')
  return win
}

/** Déplace la miniature, sans la laisser sortir de l'écran où elle se trouve. */
function moveMini(dx: number, dy: number): void {
  if (!mini || !Number.isFinite(dx) || !Number.isFinite(dy)) return
  const b = mini.getBounds()
  const { workArea: w } = screen.getDisplayNearestPoint({ x: b.x + Math.round(dx) + b.width / 2, y: b.y + Math.round(dy) + b.height / 2 })
  const x = Math.min(Math.max(b.x + Math.round(dx), w.x), w.x + w.width - b.width)
  const y = Math.min(Math.max(b.y + Math.round(dy), w.y), w.y + w.height - b.height)
  mini.setPosition(x, y)
}

/** Redimensionne la miniature en gardant son coin bas-droit en place. */
function resizeMini(width: number, height: number): void {
  if (!mini) return
  const b = mini.getBounds()
  const w = Math.round(Math.min(Math.max(width, 80), 480))
  const h = Math.round(Math.min(Math.max(height, 80), 360))
  if (w === b.width && h === b.height) return
  // Sans animation : pendant une animation, le contenu (déjà à la nouvelle taille) débordait de la fenêtre.
  mini.setBounds({ x: b.x + b.width - w, y: b.y + b.height - h, width: w, height: h }, false)
}

/**
 * Signale au serveur que l’utilisateur est devant l'ordinateur : au réveil, au déverrouillage,
 * et toutes les minutes tant que le clavier ou la souris ont servi récemment.
 * C'est au retour après une longue absence que l'assistant fait le point. Le signal va à
 * l'app si elle est affichée, sinon à la miniature.
 */
function watchPresence(): void {
  const ACTIVE_S = 90
  const send = () => {
    const target = main && !main.isDestroyed() && main.isVisible() ? main : mini
    target?.webContents.send('code:presence')
  }
  powerMonitor.on('unlock-screen', send)
  powerMonitor.on('resume', () => setTimeout(send, 3000))
  setInterval(() => {
    if (powerMonitor.getSystemIdleTime() < ACTIVE_S && powerMonitor.getSystemIdleState(ACTIVE_S) === 'active') send()
  }, 60_000)
}

function readFile(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8').trim() : null
  } catch {
    return null
  }
}

/** Le jeton de l'app ; `attendre` : ni le sien ni celui du serveur (pas encore démarré), on réessaiera. */
function readToken(): { token: string | null; attendre: boolean } {
  const own = readFile(OWN_TOKEN_PATH)
  if (own !== null) return { token: own || null, attendre: false }
  const server = readFile(TOKEN_PATH) || null
  return { token: server, attendre: !server }
}

function saveToken(token: string | null): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(OWN_TOKEN_PATH, token ?? '', { mode: 0o600 })
}

app.whenReady().then(async () => {
  // En développement, le Dock montrerait l'icône d'Electron ; l'app empaquetée a la sienne (build/icon.icns).
  const devIcon = join(__dirname, '../../build/icon.png')
  if (MAC && !app.isPackaged && existsSync(devIcon)) app.dock?.setIcon(devIcon)
  if (MAC) await systemPreferences.askForMediaAccess('microphone')

  // Seul le micro est autorisé, et seulement pour nos propres pages.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    const url = wc.getURL()
    const ours = url.startsWith('file://') || (!!process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL))
    // Micro, position pour les itinéraires (demandée au cas par cas par le serveur, jamais suivie), et le son
    // de l'ordinateur pendant l'enregistrement d'une réunion (voir le gestionnaire ci-dessous).
    callback(ours && (permission === 'media' || permission === 'geolocation' || permission === 'display-capture'))
  })

  // Enregistrer une réunion en visio : nos pages demandent le son de l'ordinateur (ce que jouent Zoom, Meet,
  // Teams) par `getDisplayMedia`. Pas de sélecteur : c'est le son qui nous intéresse, la page coupe l'image
  // aussitôt. macOS demande l'autorisation « Enregistrement de l'écran et de l'audio système » ; refusée, la
  // piste audio arrive déjà terminée, sans erreur : la page se rabat sur le micro seul.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const url = request.frame?.url ?? ''
    const ours = url.startsWith('file://') || (!!process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL))
    if (!ours || !request.audioRequested) return callback(null as never)
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).then(
      (sources) => (sources[0] ? callback({ video: sources[0], audio: 'loopback' }) : callback(null as never)),
      () => callback(null as never)
    )
  })

  ipcMain.handle('code:config', () => ({ url: SERVER_URL, ...readToken() }))
  // Connexion ou déconnexion depuis une fenêtre : le jeton est gardé, l'autre fenêtre repart avec.
  ipcMain.on('code:set-token', (e, token: unknown) => {
    if (token !== null && (typeof token !== 'string' || !/^[\w-]{16,200}$/.test(token))) return
    if (readFile(OWN_TOKEN_PATH) === (token ?? '')) return
    saveToken(token as string | null)
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents !== e.sender) w.webContents.reload()
  })
  ipcMain.on('mini:resize', (_e, w: number, h: number) => resizeMini(w, h))
  ipcMain.on('mini:move', (_e, dx: number, dy: number) => moveMini(dx, dy))
  // Les fichiers de cet ordinateur pour un serveur hébergé ailleurs (le pont).
  installerPont(SERVER_URL)
  // Copie demandée par nos pages (jeton d'association, commande à lancer) : texte court seulement.
  ipcMain.handle('clipboard:write', (_e, text: unknown) => {
    if (typeof text !== 'string' || text.length > 4000) throw new Error('Texte refusé.')
    clipboard.writeText(text)
  })
  ipcMain.on('win:open-main', () => {
    main ??= createMain()
    main.show()
    main.focus()
  })
  ipcMain.on('win:to-mini', () => main?.hide())
  // Mise en veille ou écran verrouillé : personne devant l'ordinateur, le mode conversation se coupe.
  const asleep = () => mini?.webContents.send('code:sleep')
  powerMonitor.on('suspend', asleep)
  powerMonitor.on('lock-screen', asleep)

  main = createMain()
  mini = createMini()

  // ⌘⇧Espace (Ctrl+Maj+Espace) : parler à l'assistant depuis n'importe quelle app.
  globalShortcut.register('CommandOrControl+Shift+Space', () => mini?.webContents.send('code:toggle-voice'))

  watchPresence()

  app.on('activate', () => {
    main ??= createMain()
    main.show()
  })
})

app.on('before-quit', () => {
  quitting = true
})
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
app.on('window-all-closed', () => {
  if (!MAC) app.quit()
})
