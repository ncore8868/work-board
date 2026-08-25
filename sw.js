/*
 * WORK-BOARD / UNION ONE 전용 서비스워커
 * 계정 이전 캐시 갱신본
 */
const CACHE_NAME = "unionone-work-board-v3";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-192.png",
  "./icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          CORE_ASSETS.map((url) => cache.add(url).catch(() => null))
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Apps Script 등 외부 주소는 서비스워커가 건드리지 않는다.
  if (url.origin !== self.location.origin) return;

  // 런처 HTML은 항상 최신 네트워크 우선.
  if (request.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(request, { ignoreSearch: true })) ||
          (await caches.match("./index.html")) ||
          new Response(
            "오프라인 상태입니다.\n인터넷 연결 후 다시 시도해 주세요.",
            {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" }
            }
          )
        )
    );
    return;
  }

  // 아이콘/manifest 등 정적 파일은 캐시 우선 + 백그라운드 갱신.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
