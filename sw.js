// 家計簿 service worker（2026-11-01）
//
// 網路優先：有網路一律拿伺服器上的最新版（這就是「更新不用重裝」），沒網路才退回上次存的副本。
// 只經手本站的頁面與圖示；Supabase 資料與 CDN 程式庫不經過這裡、也不快取——
// 帳目永遠是即時的，手機上不留一份財務資料的副本。
"use strict";
const CACHE = "kakeibo-shell";
const SLOW_MS = 5000;   // 訊號差到「有連線但不通」時，等這麼久就先拿上次的副本頂著

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // no-cache＝每次都向伺服器確認（沒變只回 304，很省）。不加的話瀏覽器會沿用 10 分鐘內的舊檔，
  // 剛發布時可能拿到「新 index.html＋舊 engine.js」的混搭。
  // 導覽請求不能直接帶 init 重建，改用網址；redirect:"manual" 保留導覽原本的轉址行為（follow 的話遇到轉址整頁打不開）
  const net = (req.mode === "navigate" ? fetch(req.url, { cache: "no-cache", redirect: "manual", credentials: "same-origin" })
                                       : fetch(req, { cache: "no-cache" }))
    .then(res => {
      // 帶查詢字串的頁面（登入回跳）不存，免得把一次性代碼留在快取裡；engine.js?v=… 這種版本號照存
      if (res.ok && res.status === 200 && !(req.mode === "navigate" && url.search)){
        const copy = res.clone();
        const save = caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        try { e.waitUntil(save); } catch (_){ /* 已先用副本回應、事件結束了：照樣存，只是不保證存完 */ }
      }
      return res;
    });
  e.respondWith((async () => {
    const quick = await Promise.race([net.catch(() => null), new Promise(r => setTimeout(r, SLOW_MS, null))]);
    if (quick) return quick;
    const hit = await caches.match(req, { ignoreSearch: true });
    return hit || net.catch(() => Response.error());   // 沒副本就繼續等網路
  })());
});
