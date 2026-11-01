// 家計簿 service worker（2026-11-01；2026-11-02 版本配對修正）
//
// 網路優先：有網路一律拿伺服器上的最新版（這就是「更新不用重裝」），沒網路才退回上次存的副本。
// 只經手本站的頁面與圖示；Supabase 資料與 CDN 程式庫不經過這裡、也不快取——
// 帳目永遠是即時的，手機上不留一份財務資料的副本。
//
// 版本配對：index.html 用 engine.js?v=<雜湊> 這種網址載入本地程式，detail.js／accounts.js 又靠 index.html 的全域。
// 新頁面配到舊程式就會壞，所以：
//   ・程式檔只認「完全相同的網址」（含 ?v=），且同一個檔只留最新存的那一版；
//   ・首頁副本跟它要的那組程式「一起存」：程式沒存齊就不換首頁，離線開啟時兩者一定是同一版。
"use strict";
const CACHE = "kakeibo-shell-v2";   // v1 時期存過不帶版本號的 engine.js，換名字讓 activate 整個丟掉
const SLOW_MS = 5000;   // 訊號差到「有連線但不通」時，等這麼久就先拿上次的副本頂著

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
  // 舊副本剛丟掉：馬上補一組新的，不然更新後第一次離線開啟會什麼都沒有。沒網路就算了，下次上線再存
  try {
    const res = await fetch(self.registration.scope, { cache: "no-cache", credentials: "same-origin" });
    if (res.ok && res.status === 200) await storeShell(new Request(self.registration.scope), res);
  } catch (_){ /* 離線 */ }
})()));

/** 存一份新副本，並刪掉同一路徑的其他版本（?v= 不同），免得離線時拿到舊版 */
async function store(req, res){
  const c = await caches.open(CACHE), path = new URL(req.url).pathname;
  await c.put(req, res);
  for (const k of await c.keys()) if (k.url !== req.url && new URL(k.url).pathname === path) await c.delete(k);
}

/** 首頁＋它引用的本地程式（xxx.js?v=<雜湊>）一起存；有一支拿不到就整組不換，保留上一組完整的 */
async function storeShell(req, res){
  const c = await caches.open(CACHE);
  const html = await res.clone().text();
  const urls = [...html.matchAll(/src="([\w.-]+\.js\?v=[0-9a-f]+)"/g)].map(m => new URL(m[1], req.url).href);
  const got = await Promise.all(urls.map(async u =>
    (await c.match(u)) || fetch(u, { cache: "no-cache" }).then(r => (r.ok ? r : null), () => null)));
  if (got.some(r => !r)) return;
  for (let i = 0; i < urls.length; i++) await store(new Request(urls[i]), got[i]);
  await store(req, res);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const nav = req.mode === "navigate";
  // no-cache＝每次都向伺服器確認（沒變只回 304，很省）。不加的話瀏覽器會沿用 10 分鐘內的舊檔，
  // 剛發布時可能拿到「新 index.html＋舊 engine.js」的混搭。
  // 導覽請求不能直接帶 init 重建，改用網址；redirect:"manual" 保留導覽原本的轉址行為（follow 的話遇到轉址整頁打不開）
  const net = (nav ? fetch(req.url, { cache: "no-cache", redirect: "manual", credentials: "same-origin" })
                   : fetch(req, { cache: "no-cache" }))
    .then(res => {
      // 帶查詢字串的頁面（登入回跳、?demo=1）不存，免得把一次性代碼留在快取裡；engine.js?v=… 這種版本號照存
      if (res.ok && res.status === 200 && !(nav && url.search)){
        const save = (nav ? storeShell(req, res.clone()) : store(req, res.clone())).catch(() => {});
        try { e.waitUntil(save); } catch (_){ /* 已先用副本回應、事件結束了：照樣存，只是不保證存完 */ }
      }
      return res;
    });
  e.respondWith((async () => {
    const quick = await Promise.race([net.catch(() => null), new Promise(r => setTimeout(r, SLOW_MS, null))]);
    if (quick) return quick;
    // 頁面可忽略查詢字串（?demo=1 也拿首頁副本）；程式與圖示只認完全相同的網址——寧可等網路，不配舊版
    const hit = await caches.match(req, { ignoreSearch: nav });
    return hit || net.catch(() => Response.error());   // 沒副本就繼續等網路
  })());
});
