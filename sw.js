/* UNION ONE WORK BOARD - 런처 서비스워커
 *
 * 앱 화면(app.html)도 이 저장소에 있습니다.
 * 열 때마다 서버에 "바뀌었나" 를 물어보고, 바뀌었을 때만 새로 받습니다.
 *
 * ★ 화면을 고쳐서 올릴 때마다 아래 CACHE 뒤의 숫자를 하나 올리세요.
 *   index.html 의 APP_VER 도 같은 숫자로 맞춰두면 헷갈리지 않습니다.
 *
 * ────────────────────────────────────────────────────────────
 * 2026-08-29 · 속도
 *
 * 앱을 열 때마다 app.html 225KB 를 통째로 다시 받고 있었습니다.
 * 런처가 주소 끝에 Date.now() 를 붙여 **매번 다른 주소**를 만들었기 때문에
 * 캐시가 한 번도 맞은 적이 없었습니다. 그래서 세 가지가 같이 일어났습니다.
 *
 *   · 열 때마다 225KB 를 새로 내려받았다  (앱이 늦게 뜨던 가장 큰 이유)
 *   · 열 때마다 캐시에 새 칸이 쌓였다      (100번 열면 22MB)
 *   · 캐시가 맞은 적이 없어 오프라인에서는 앱 화면이 아예 안 떴다
 *     (캐시를 못 찾아 런처 껍데기 index.html 을 대신 내주고 있었습니다)
 *
 * 고친 것
 *   ① 런처가 붙이는 v= 를 고정된 판 번호로 바꿨습니다 (index.html)
 *   ② 캐시에 넣을 때 물음표 뒤(?dt=..&v=..)를 떼어내 한 칸만 씁니다
 *   ③ 받아올 때 cache:"no-cache" 로 서버에 "바뀌었나" 만 물어봅니다
 *      안 바뀌었으면 서버가 '그대로다(304)' 한 줄만 보냅니다 — 수백 바이트
 *   ④ 캐시가 있으면 통신을 2.5초까지만 기다립니다
 *
 * ▶ '항상 최신을 확인한다' 는 규칙은 하나도 달라지지 않았습니다.
 *   달라진 것은 안 바뀐 날에 225KB 를 다시 안 받는다는 것뿐입니다.
 * ────────────────────────────────────────────────────────────
 */
const CACHE = 'unionone-launcher-v21';

/* 캐시가 있을 때 네트워크를 기다려주는 시간 */
const NET_WAIT_MS = 2500;

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

/* 물음표 뒤(?dt=..&v=..)를 떼어낸 주소.
   이게 없으면 app.html 이 열 때마다 새 칸으로 쌓입니다. */
function cacheKey(request) {
  const url = new URL(request.url);
  return url.origin + url.pathname;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

function keep(cache, request, response) {
  if (!response || !response.ok || response.redirected) return;
  try {
    cache.put(cacheKey(request), response.clone()).catch(() => {});
  } catch (err) { /* 넣지 못해도 화면에는 영향이 없습니다 */ }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.hostname.indexOf('google') >= 0) return;
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  /* 화면 파일(.html)과 스크립트(.js)는 아래에서 '항상 최신 우선' 으로 다룹니다.
     아이콘 · manifest 는 바뀌는 일이 거의 없는데 열 때마다 서버에 묻느라
     왕복만 늘어나므로 캐시를 먼저 내주고 뒤에서 갱신합니다.
     (앞으로 이 저장소에 .js·.css 파일이 생겨도 옛것이 남지 않게
      확장자를 적어두는 쪽으로 했습니다) */
  var alwaysFresh = /\.(html|js|css)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (!alwaysFresh) {
    e.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(cacheKey(e.request), { ignoreSearch: true }).then((cached) => {
          const network = fetch(e.request)
            .then((res) => { keep(cache, e.request, res); return res; })
            .catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  /* 화면 파일(index.html · app.html) 은 항상 최신 우선 */
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(cacheKey(e.request), { ignoreSearch: true });

    const fromNet = fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        keep(cache, e.request, res);
        return res && res.ok ? res : null;
      })
      .catch(() => null);

    /* 캐시가 있을 때만 시간을 끊습니다.
       캐시가 없으면(처음 설치) 끝까지 기다려야 화면이 나옵니다. */
    const fresh = cached
      ? await Promise.race([fromNet, wait(NET_WAIT_MS)])
      : await fromNet;

    if (fresh) return fresh;
    if (cached) return cached;

    const fallback = await cache.match('./index.html', { ignoreSearch: true });
    return fallback || Response.error();
  })());
});
