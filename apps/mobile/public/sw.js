// Service worker : garde l'app sur le téléphone pour qu'elle s'ouvre tout de suite.
// Au lancement, le tunnel (Tailscale…) met parfois quelques secondes à se réveiller : l'interface
// s'affiche depuis le téléphone, et seule la connexion au serveur attend le réseau.
// Il affiche aussi les notifications envoyées par le serveur (rappels, briefing du matin), même app fermée.

const CACHE = 'code-2-app-v1'
/** Icônes de l'app (écran d'accueil, onglet, notifications). */
const ICONS = ['/icon.svg', '/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png']

/** Page d'accueil : le réseau d'abord (version à jour), la copie du téléphone si le serveur tarde. */
const NAVIGATION_TIMEOUT_MS = 1500

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', ...ICONS])).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })()
  )
})

async function fromCache(request) {
  const cache = await caches.open(CACHE)
  return cache.match(request, { ignoreSearch: true })
}

async function store(request, response) {
  if (response.ok) {
    const cache = await caches.open(CACHE)
    await cache.put(request, response.clone())
  }
  return response
}

/** Page : le réseau s'il répond vite, sinon la copie gardée (mise à jour en arrière-plan). */
async function navigation(request) {
  const network = fetch(request).then((r) => store(new Request('/'), r))
  const timeout = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT_MS, null))
  const first = await Promise.race([network.catch(() => null), timeout])
  if (first) return first
  const cached = await fromCache(new Request('/'))
  return cached ?? network
}

/** Fichiers à empreinte (/assets/…) et moteur de voix (/vad/…) : jamais modifiés sous le même nom. */
async function immutable(request) {
  const cached = await fromCache(request)
  if (cached) return cached
  const response = await fetch(request)
  // Jamais une page à la place d'un fichier : gardée, elle casserait ce fichier pour toujours.
  if ((response.headers.get('Content-Type') ?? '').startsWith('text/html')) return response
  return store(request, response)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  // Connexion temps réel, aperçus de fichiers et santé : toujours en direct.
  if (url.pathname.startsWith('/ws') || url.pathname.startsWith('/apercu') || url.pathname === '/health') return
  if (request.mode === 'navigate') return event.respondWith(navigation(request))
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/vad/')) return event.respondWith(immutable(request))
  if (url.pathname === '/manifest.webmanifest' || ICONS.includes(url.pathname)) {
    return event.respondWith(fromCache(request).then((c) => c ?? fetch(request)))
  }
})

// ── Notifications ──
// Contenu déchiffré par le navigateur : { titre, corps, tag, url } (apps/server/src/push/push.ts).
// iOS exige qu'une notification s'affiche pour chaque envoi : on en montre toujours une.
self.addEventListener('push', (event) => {
  let msg = {}
  try {
    msg = event.data ? event.data.json() : {}
  } catch {
    msg = { corps: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(msg.titre || 'CODE 2.0', {
      body: msg.corps || '',
      tag: msg.tag || 'code',
      renotify: true,
      lang: 'fr',
      icon: '/icon-192.png',
      data: { url: msg.url || '/' }
    })
  )
})

// Toucher la notification : l'app déjà ouverte revient au premier plan, sinon elle s'ouvre.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const w of windows) {
        if (!('focus' in w)) continue
        // App déjà ouverte : elle ouvre elle-même le résultat (tâche planifiée) sans recharger.
        w.postMessage({ type: 'ouvrir', url })
        return w.focus()
      }
      return self.clients.openWindow(url)
    })()
  )
})
