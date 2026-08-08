// 對帳演算法 CI 自測（2026-08-08 第二輪團隊審查・QA）
//
// billbook.html 內建 ?selftest=1 供人工開網址驗證，但沒人會每次部署前都記得開。
// 這支在 CI 跑同一份 SELFTESTS、同一個 recon()——不複製演算法，所以不會走偏。
// 作法：把頁內 <script> 當成一段程式碼直接 eval，只補最小的 DOM 假物件讓它跑得完。
"use strict";
const fs = require("fs");

const el = () => ({ appendChild() {}, insertBefore() {}, set className(_) {},
                    set textContent(_) {} });
globalThis.document = {
  addEventListener() {}, createElement: el, getElementById: el,
  head: { appendChild() {} }, title: "",
};
globalThis.location = { search: "", origin: "", pathname: "" };
globalThis.window = globalThis;

const html = fs.readFileSync(process.argv[2] || "billbook.html", "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("找不到 <script> 區塊"); process.exit(1); }

// 間接 eval＝以全域程式執行；把要驗的兩個符號掛到 globalThis 才拿得到（const 是區塊綁定）
(0, eval)(m[1] + "\n;globalThis.__recon = recon; globalThis.__tests = SELFTESTS;");

const tests = globalThis.__tests, recon = globalThis.__recon;
if (!Array.isArray(tests) || !tests.length) {
  console.error("SELFTESTS 不存在或是空的——自測被拿掉了？");
  process.exit(1);
}
let fail = 0;
for (const [name, st, lines, check] of tests) {
  let ok = false, err = "";
  try { ok = !!check(recon(st, lines)); }
  catch (e) { err = " — 例外：" + (e && e.message); }
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${err}`);
}
console.log(`\n${tests.length - fail} 通過、${fail} 失敗`);
process.exit(fail ? 1 : 0);
