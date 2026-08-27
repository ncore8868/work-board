/* UNION ONE WORK BOARD - 런처 서비스워커
 *
 * 2026-08 부터 앱 화면(app.html)도 이 저장소에 있습니다.
 * 앱 화면은 항상 서버에서 먼저 받아보고, 실패했을 때만 캐시를 씁니다.
 * 그래야 새로 올린 화면이 바로 반영됩니다.
 *
 * ★ 화면을 고쳐서 올릴 때마다 아래 CACHE 뒤의 숫자를 하나 올리세요.
 *   올리지 않으면 직원들 폰에 옛 화면이 계속 남습니다.
 */
const CACHE = 'unionone-launcher-v4';

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
      // 아이콘 하나가 없어도 설치가 통째로 실패하지 않게 한다
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

  // 구글 앱스스크립트 요청은 절대 가로채지 않는다
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
