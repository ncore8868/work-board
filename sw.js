/* UNION ONE WORK BOARD - 런처 서비스워커
 *
 * 앱 화면(app.html)도 이 저장소에 있습니다.
 * 항상 서버에서 먼저 받아보고, 실패했을 때만 캐시를 씁니다.
 *
 * ★ 화면을 고쳐서 올릴 때마다 아래 CACHE 뒤의 숫자를 하나 올리세요.
 *   올리지 않으면 직원들 폰에 옛 화면이 계속 남습니다.
 */
const CACHE = 'unionone-launcher-v14';

const SHELL = [
  './',
  './index.html',
  './app.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.hostname.indexOf('google') >= 0) return;
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
