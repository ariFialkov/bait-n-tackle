// Bait N' Tackle service worker — precache the whole game for offline play.

const CACHE = 'bait-n-tackle-v8';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './vendor/three.module.js',
  './vendor/addons/loaders/GLTFLoader.js',
  './vendor/addons/utils/BufferGeometryUtils.js',
  './src/main.js',
  './src/config.js',
  './src/noise.js',
  './src/fishdata.js',
  './src/fishmodels.js',
  './src/fishicons.js',
  './src/dex.js',
  './src/boats.js',
  './src/player.js',
  './src/docks.js',
  './src/marina.js',
  './src/tender.js',
  './src/rtp.js',
  './src/lake.js',
  './src/boat.js',
  './src/net.js',
  './src/fish.js',
  './src/fishing.js',
  './src/cameraRig.js',
  './src/input.js',
  './src/hud.js',
  './assets/boats/skiff.png',
  './assets/boats/cuddy.png',
  './assets/boats/trawler.png',
  './assets/boats/mud-dredger.png',
  './assets/boats/gillnetter.png',
  './assets/boats/paddleboat.png',
  './assets/boats/seiner.png',
  './assets/boats/steamboat.png',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) => hit ||
        fetch(e.request).then((res) => {
          if (res.ok && new URL(e.request.url).origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
    )
  );
});
