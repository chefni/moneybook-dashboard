// 家計簿 service worker（2026-11-01）
//
// 網路優先：有網路一律拿伺服器上的最新版（這就是「更新不用重裝」），沒網路才退回上次存的副本。
// 只經手本站的頁面與圖示；Supabase 資料與 CDN 程式庫不經過這裡、也不快取——
// 帳目永遠是即時的，手機上不留一份財務資料的副本。
"use strict";
const CACHE = "kakeibo-shell";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      // 帶查詢字串的（登入回跳的 ?code=…）不存，免得把一次性代碼留在快取裡
      if (res.ok && !url.search) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
