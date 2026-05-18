const CACHE_NAME = 'nofvce-shell-v3'

const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icons/nofvce-icon.png',
  '/logo-nofvce.png',
  '/nofvce/logo-white.png',
  '/nofvce/logo-letra-white.png',
  '/nofvce/mask-white.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  )

  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const requestUrl = new URL(event.request.url)

  if (
    requestUrl.pathname.startsWith('/src/') ||
    requestUrl.pathname.startsWith('/@vite') ||
    requestUrl.pathname.includes('node_modules')
  ) {
    event.respondWith(fetch(event.request))
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/')),
    )
    return
  }

  if (
    event.request.destination === 'script' ||
    event.request.destination === 'style' ||
    event.request.destination === 'document'
  ) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone()

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone)
          })

          return networkResponse
        })
        .catch(() => caches.match(event.request)),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request).then((networkResponse) => {
        const responseClone = networkResponse.clone()

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone)
        })

        return networkResponse
      })

      return cachedResponse || networkFetch
    }),
  )
})
