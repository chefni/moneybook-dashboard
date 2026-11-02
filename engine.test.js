// engine.js 的回歸測試（2026-11-01）——逐條移植自 Android 的
// AutoExclusionsTest／NormalizeTest／RulesTest，外加分析頁彙總（analyze）的整合案例。
// 目的：網頁版與 App 算出同一個數字。App 那邊的測試改了，這裡要跟著改。
//
// 用法：node engine.test.js（CI 也跑；零相依）
"use strict";
const E = require("./engine.js");

let pass = 0, fail = 0;
function test(name, fn){
  try { fn(); pass++; }
  catch (e){ fail++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
function eq(actual, expected, msg = ""){
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} 預期 ${b}，實際 ${a}`);
}
const ok = (v, msg = "") => { if (!v) throw new Error(msg || "預期為真"); };

/* ── 夾具（同 Kotlin 測試的 helper） ── */
const acct = (id, account_id, amount, occurred_at, description = "", note = "") =>
  ({ id, account_id, amount, occurred_at, description, note });
const tx = (id, amount, occurred_at, kind = "income", merchant = "", source = "email", extra = {}) =>
  ({ id, household_id: "h", amount, occurred_at, kind, merchant, note: "", source, dedup_status: "unique", ...extra });
const accA = { id: "A", name: "玉山(阿明)·活存" }, accB = { id: "B", name: "國泰(阿明)·活存" },
      accC = { id: "C", name: "台新(阿華)·活存" };
const me = { id: "m1", name: "阿明", sort_order: 0 }, her = { id: "m2", name: "阿華", nickname: "阿華", sort_order: 1 };
const rule = (merchant, category) => ({ merchant, category, source: "user" });
const filter = (action, o = {}) => ({ action, priority: 100, kw: "", account: "", amount_min: null,
  amount_max: null, direction: "any", active: true, ...o });
const xr = (pattern, exclude_state) => ({ pattern, exclude_state });

/* ═══ AutoExclusionsTest ═══ */
test("A 不同帳戶同額一出一入算互轉 兩邊都排除", () => {
  const [, r] = E.autoExclusions([], [acct("w", "A", -10000, "2026-02-01", "轉出"),
    acct("d", "B", 10000, "2026-02-01", "轉入")], [accA, accB], [me]);
  eq(r.get("w"), "帳戶互轉"); eq(r.get("d"), "帳戶互轉");
});
test("A 不同人的帳戶互轉標出方向", () => {
  const [, r] = E.autoExclusions([], [acct("w", "C", -5000, "2026-02-01", "轉出"),
    acct("d", "A", 5000, "2026-02-01", "轉入")], [accA, accC], [me, her]);
  eq(r.get("d"), "家人互轉 阿華→阿明");
});
test("A 相隔超過兩天不算互轉", () => {
  const [, r] = E.autoExclusions([], [acct("w", "A", -10000, "2026-02-01", "轉出"),
    acct("d", "B", 10000, "2026-02-05", "轉入")], [accA, accB], [me]);
  eq(r.get("w"), undefined);
});
test("A 薪資不會因為剛好有同額出帳就被當成互轉", () => {
  const [, r] = E.autoExclusions([], [acct("w", "A", -60000, "2026-02-05", "轉出"),
    acct("d", "B", 60000, "2026-02-05", "薪資轉帳")], [accA, accB], [me]);
  eq(r.get("d"), undefined);
});
test("A 利息配息賣出同樣不會被當成互轉", () => {
  for (const desc of ["活儲利息", "現金股利", "普賣 台積電"]){
    const [, r] = E.autoExclusions([], [acct("w", "A", -1000, "2026-02-05", "轉出"),
      acct("d", "B", 1000, "2026-02-05", desc)], [accA, accB], [me]);
    eq(r.get("d"), undefined, desc);
  }
});
test("A 一筆轉出只能對消一筆轉入", () => {
  const [, r] = E.autoExclusions([], [acct("w", "A", -10000, "2026-02-01", "轉出"),
    acct("d1", "B", 10000, "2026-02-01", "轉入"), acct("d2", "B", 10000, "2026-02-01", "轉入")], [accA, accB], [me]);
  eq(["d1", "d2"].filter(k => r.get(k) === "帳戶互轉").length, 1);
});
test("A 手續費容差內也算互轉（O2）", () => {
  const [, r] = E.autoExclusions([], [acct("w", "A", -10015, "2026-02-01", "轉出"),
    acct("d", "B", 10000, "2026-02-01", "轉入")], [accA, accB], [me]);
  eq(r.get("d"), "帳戶互轉");
});
test("A2 同帳戶同額同摘要一出一入算相抵", () => {
  const [, r] = E.autoExclusions([], [acct("w", "A", -3000, "2026-02-01", "手機預約"),
    acct("d", "A", 3000, "2026-02-01", "手機預約")], [accA], [me]);
  eq(r.get("d"), "轉帳(進出相抵)");
});
test("A2 同帳戶同額但摘要不同不算相抵", () => {
  const [, r] = E.autoExclusions([], [acct("w", "A", -3000, "2026-02-01", "提款"),
    acct("d", "A", 3000, "2026-02-01", "存款")], [accA], [me]);
  eq(r.get("d"), undefined);
});
test("C 存款存入與對帳單收入同額算重複 排掉存款那筆", () => {
  const [rTx, rAcct] = E.autoExclusions([tx("t1", 8000, "2026-02-10", "income", "退費")],
    [acct("d", "A", 8000, "2026-02-11", "退費")], [accA], [me]);
  eq(rAcct.get("d"), "與對帳單重複"); eq(rTx.get("t1"), "信用卡退款/返還");
});
test("B 對帳單收入視為刷卡退款並對消同商家同額的原支出", () => {
  const [rTx] = E.autoExclusions([tx("inc", 1200, "2026-02-10", "income", "UNIQLO"),
    tx("exp", 1200, "2026-02-03", "expense", "UNIQLO")], []);
  eq(rTx.get("inc"), "信用卡退款/返還"); eq(rTx.get("exp"), "退款對消");
});
test("B 證券類收入不算刷卡退款", () => {
  for (const m of ["普賣 台積電", "現金股利", "活儲利息"])
    eq(E.autoExclusions([tx("inc", 1200, "2026-02-10", "income", m)], [])[0].get("inc"), undefined, m);
});
test("B 手動記的收入不會被當成刷卡退款", () => {
  eq(E.autoExclusions([tx("inc", 1200, "2026-02-10", "income", "紅包", "manual")], [])[0].get("inc"), undefined);
});
test("B 已合併的重複列不參與偵測", () => {
  eq(E.autoExclusions([tx("m", 1200, "2026-02-10", "income", "UNIQLO", "email", { dedup_status: "merged" })], [])[0].size, 0);
});
test("T 轉入語言且有對應轉出 判為內部搬錢", () => {
  const [, r] = E.autoExclusions([], [acct("w", "A", -20000, "2026-02-01", "約定轉帳"),
    acct("d", "B", 20000, "2026-02-02", "帳務異動-轉入")], [accA, accB], [me]);
  ok(["帳戶互轉", "自家轉入"].includes(r.get("d")), r.get("d"));
});
test("T 匯款沒有對應轉出時算真收入", () => {
  eq(E.autoExclusions([], [acct("d", "A", 30000, "2026-02-02", "匯款")], [accA], [me])[1].get("d"), undefined);
});
test("T 自家轉入語言且久未配對會浮回待確認收入", () => {
  eq(E.autoExclusions([], [acct("d", "A", 30000, "2020-01-01", "帳務異動-轉入")], [accA], [me])[1].get("d"), "待確認收入");
});
test("T 未滿 45 天先當自家轉入(待配對)", () => {
  eq(E.autoExclusions([], [acct("d", "A", 30000, "2026-02-01", "帳務異動-轉入")], [accA], [me], "2026-02-10")[1].get("d"),
     "自家轉入(待配對)");
});
test("沒有任何資料時不會爆炸也不排除任何東西", () => {
  const [a, b] = E.autoExclusions([], []); eq(a.size + b.size, 0);
});
test("沒有 id 的列一律略過", () => {
  eq(E.autoExclusions([], [acct(null, "A", 100, "2026-02-01", "轉入")], [accA], [me])[1].size, 0);
});

/* ═══ NormalizeTest ═══ */
test("正規化：全形、空白、大小寫、代收前綴", () => {
  eq(E.normalizeMerchant("ＵＮＩＱＬＯ"), "uniqlo");
  eq(E.normalizeMerchant("７－１１"), "7-11");
  eq(E.normalizeMerchant("　全家　便利商店　"), "全家 便利商店");
  eq(E.normalizeMerchant("StarBucks"), "starbucks");
  eq(E.normalizeMerchant("連支＊全家便利商店"), "全家便利商店");
  eq(E.normalizeMerchant("連加＊全家便利商店"), "全家便利商店");
  eq(E.normalizeMerchant("ICP一康是美"), "康是美");
  eq(E.normalizeMerchant("愛金卡一康是美"), "康是美");
  eq(E.normalizeMerchant("統一金流－蝦皮購物"), "蝦皮購物");
  eq(E.normalizeMerchant("綠界－蝦皮購物"), "蝦皮購物");
  eq(E.normalizeMerchant("順立智慧－蝦皮購物"), "蝦皮購物");
  eq(E.normalizeMerchant("統一金流－連支＊全家"), "全家");
  eq(E.normalizeMerchant("我愛綠界－甜點"), "我愛綠界-甜點");
  const once = E.normalizeMerchant("統一金流－ＵＮＩＱＬＯ"); eq(E.normalizeMerchant(once), once);
  eq(E.normalizeMerchant(""), ""); eq(E.normalizeMerchant("　　"), ""); eq(E.normalizeMerchant("連支＊"), "");
});
test("分類：正規化後比對使用者規則", () => {
  eq(E.classify("ＵＮＩＱＬＯ", [rule("uniqlo", "👗 服飾美容")]), "👗 服飾美容");
  eq(E.classify("連支＊全家便利商店", [rule("全家", "🧺 食品雜貨")]), "🧺 食品雜貨");
  eq(E.classify("uniqlo 信義店", [rule("ＵＮＩＱＬＯ", "👗 服飾美容")]), "👗 服飾美容");
  eq(E.classify("全家便利商店", [rule("全家", "📦 其他"), rule("全家便利商店", "🧺 食品雜貨")]), "🧺 食品雜貨");
  eq(E.classify("連支＊全家便利商店", [rule("全家便利商店", "🧺 食品雜貨")]), "🧺 食品雜貨");
  ok(E.classify("普買 台積電", []) !== "📦 其他");
  eq(E.classify("ＡＧＯＤＡ", []), E.classify("agoda", []));
  ok(E.classify("ＤＯＮ ＤＯＮ ＤＯＮＫＩ－忠孝新生店", []) !== "📦 其他", "全形 DONKI 掉進其他");
  eq(E.classify("", []), "📦 其他"); eq(E.classify("   ", []), "📦 其他");
});
test("分類：任何關鍵字的全形寫法都與半形同類", () => {
  for (const half of ["agoda", "uniqlo", "ikea", "coupang", "netflix", "starbucks", "7-11"]){
    const full = [...half].map(c => (c >= "!" && c <= "~" ? String.fromCharCode(c.charCodeAt(0) + 0xFEE0) : c)).join("");
    eq(E.classify(full, []), E.classify(half, []), half);
  }
});
test("分類：規則清單換一份時快取跟著換", () => {
  const a = [rule("全家", "🧺 食品雜貨")], b = [rule("全家", "📦 其他")];
  eq(E.classify("全家", a), "🧺 食品雜貨"); eq(E.classify("全家", b), "📦 其他"); eq(E.classify("全家", a), "🧺 食品雜貨");
});
test("分店後綴：merchantCore", () => {
  eq(E.merchantCore("創義麵-信義店"), "創義麵");
  eq(E.merchantCore("台塑生醫-龍潭湖門市"), "台塑生醫");
  eq(E.merchantCore("uniqlo lalaport南港店"), "uniqlo");
  eq(E.merchantCore("motel five #34"), "motel five");
  eq(E.merchantCore("starbucks no.12"), "starbucks");
  eq(E.merchantCore("bengawan solo @ changi t1"), "bengawan solo");
  eq(E.merchantCore("創義麵-信義店 #12"), "創義麵");
  eq(E.merchantCore("全家便利商店"), "全家便利商店");
  eq(E.merchantCore("屈臣氏"), "屈臣氏");
  eq(E.merchantCore("三商巧福 牛肉麵"), "三商巧福 牛肉麵");
  eq(E.merchantCore("a-b 甜點"), "a-b 甜點");
  eq(E.merchantCore(""), ""); eq(E.merchantCore("信義店"), "信義店");
});
test("分店：同一家店不同分店共用規則、退路不改既有對的", () => {
  const r = [rule("創義麵-信義店", "🍜 飲食")];
  eq(E.classify("創義麵-信義店", r), "🍜 飲食"); eq(E.classify("創義麵-大安店", r), "🍜 飲食");
  eq(E.classify("創義麵 南港店", r), "🍜 飲食");
  eq(E.classify("創義麵-大安店", [rule("創義麵-信義店", "🍜 飲食"), rule("創義麵-大安店", "🎮 娛樂")]), "🎮 娛樂");
  eq(E.classify("查無此店-信義店", []), "📦 其他");
});
test("篩選器關鍵字吃正規化、看得到備註", () => {
  eq(E.matchFilterRule("ＵＮＩＱＬＯ 信義店", "", "帳單", 1000, "expense", [filter("exclude", { kw: "uniqlo" })]).action, "exclude");
  eq(E.matchFilterRule("uniqlo 信義店", "", "帳單", 1000, "expense", [filter("exclude", { kw: "ＵＮＩＱＬＯ" })]).action, "exclude");
  eq(E.matchFilterRule("", "醫院停車", "手動記帳", 100, "expense", [filter("exclude", { kw: "停車" })]).action, "exclude");
});

/* ═══ RulesTest ═══ */
const rt = (amount, merchant, state) => tx("t1", amount, "2026-02-01", "expense", merchant, "email", { exclude_state: state ?? null });
test("排除優先序：手動 ＞ 篩選器 ＞ 商家規則 ＞ 自動 ＞ 預設納入", () => {
  eq(E.effExcludeF(rt(100, "全聯", "exclude"), new Map([["t1", "自動偵測"]]), [xr("全聯", "include")], [filter("include")]), [true, "手動排除"]);
  eq(E.effExcludeF(rt(100, "全聯", "include"), new Map([["t1", "帳戶互轉"]]), [], [])[0], false);
  eq(E.effExcludeF(rt(100, "全聯"), new Map(), [xr("全聯", "include")], [filter("exclude")]), [true, "篩選器"]);
  eq(E.effExcludeF(rt(100, "全聯"), new Map([["t1", "帳戶互轉"]]), [xr("全聯", "include")], [])[0], false);
  eq(E.effExcludeF(rt(100, "全聯"), new Map(), [], [])[0], false);
});
test("篩選器：priority、停用、金額閉區間、方向、大小寫與備註、快取", () => {
  eq(E.matchFilterRule("蝦皮", "", "", 100, "expense", [filter("cat:B", { priority: 9 }), filter("cat:A", { priority: 1 })]).action, "cat:A");
  eq(E.matchFilterRule("蝦皮", "", "", 100, "expense", [filter("cat:A", { priority: 1, active: false }), filter("cat:B", { priority: 9 })]).action, "cat:B");
  const f = [filter("exclude", { amount_min: 100, amount_max: 200 })];
  eq(E.matchFilterRule("", "", "", 100, "expense", f).action, "exclude");
  eq(E.matchFilterRule("", "", "", 200, "expense", f).action, "exclude");
  eq(E.matchFilterRule("", "", "", 99, "expense", f), null);
  eq(E.matchFilterRule("", "", "", 201, "expense", f), null);
  const d = [filter("exclude", { direction: "expense" })];
  eq(E.matchFilterRule("", "", "", 100, "income", d), null);
  eq(E.matchFilterRule("", "", "", 100, "expense", d).action, "exclude");
  const n = [filter("cat:X", { kw: "netflix" })];
  eq(E.matchFilterRule("NETFLIX.COM", "", "", 100, "expense", n).action, "cat:X");
  eq(E.matchFilterRule("", "訂閱 Netflix", "", 100, "expense", n).action, "cat:X");
  const a = [filter("cat:A", { priority: 1 })], b = [filter("cat:B", { priority: 1 })];
  eq(E.matchFilterRule("x", "", "", 1, "expense", a).action, "cat:A");
  eq(E.matchFilterRule("x", "", "", 1, "expense", b).action, "cat:B");
  eq(E.matchFilterRule("x", "", "", 1, "expense", a).action, "cat:A");
});
test("商家排除規則：完全相同優先、空字串不觸發", () => {
  eq(E.ruleExcludeState("全聯福利中心", [xr("全聯", "exclude"), xr("全聯福利中心", "include")]), "include");
  eq(E.ruleExcludeState("", [xr("全聯", "exclude")]), null);
  eq(E.ruleExcludeState("   ", [xr("全聯", "exclude")]), null);
});
test("轉帳金額容差", () => {
  ok(E.amtMatchTransfer(10015, 10000)); ok(E.amtMatchTransfer(10000, 10000)); ok(E.amtMatchTransfer(1003000, 1000000));
  ok(!E.amtMatchTransfer(9999, 10000)); ok(!E.amtMatchTransfer(10031, 10000)); ok(!E.amtMatchTransfer(1004000, 1000000));
});
const monthly = (merchant, amts, day = 5) =>
  amts.map((a, i) => tx(`s${i}${merchant}`, a, `2026-${String(i + 3).padStart(2, "0")}-${String(day).padStart(2, "0")}`, "expense", merchant));
test("訂閱偵測：同額同日連續三月、浮動、跳月、亂日、按次、非訂閱、aux", () => {
  const subs = E.detectSubscriptions(monthly("串流服務", [390, 390, 390]));
  eq(subs.length, 1); eq(subs[0].amount, 390); eq(subs[0].months, 3);
  eq(E.detectSubscriptions(monthly("飲料店", [390, 500, 420])).length, 0);
  eq(E.detectSubscriptions([tx("a", 390, "2026-03-05", "expense", "某服務"), tx("b", 390, "2026-04-05", "expense", "某服務"),
    tx("c", 390, "2026-06-05", "expense", "某服務")]).length, 0);
  eq(E.detectSubscriptions([tx("a", 390, "2026-03-02", "expense", "某服務"), tx("b", 390, "2026-04-15", "expense", "某服務"),
    tx("c", 390, "2026-05-27", "expense", "某服務")]).length, 0);
  for (const m of ["嘟嘟房停車場", "統一超商", "中油加油站"]) eq(E.detectSubscriptions(monthly(m, [390, 390, 390])).length, 0, m);
  eq(E.detectSubscriptions(monthly("串流服務", [390, 390, 390]), new Set(["串流服務"])).length, 0);
  eq(E.detectSubscriptions(monthly("串流服務", [390, 390, 390]).map(t => ({ ...t, dedup_status: "aux" }))).length, 0);
});
test("分類優先序：手動 category_id ＞ 篩選器 ＞ 使用者規則 ＞ 關鍵字", () => {
  const t = rt(100, "全聯福利中心");
  eq(E.classify("全聯福利中心", [rule("全聯", "自訂類")]), "自訂類");
  eq(E.classifyF(t, [rule("全聯", "自訂類")], [filter("cat:篩選類")]), "篩選類");
  eq(E.classifyF(t, [rule("全聯", "自訂類")], [filter("exclude")]), "自訂類");
  eq(E.classifyF({ ...t, category_id: "c1" }, [], [filter("cat:篩選類")], [{ id: "c1", icon: "🍜", name: "飲食" }]), "🍜 飲食");
});
test("來源名 statSource", () => {
  eq(E.statSource({ note: "[email] 國泰世華(阿明)", source: "email" }), "國泰世華");
  eq(E.statSource({ note: "[notification] 永豐信用卡(阿明)", source: "notification" }), "永豐信用卡·通知");
  eq(E.statSource({ note: "[申購退還]", source: "email" }), "申購（重建）");
  eq(E.statSource({ note: "", source: "manual" }), "手動記帳");
  eq(E.statSource({ note: "[email]", source: "email" }), "帳單匯入");
});

/* ═══ 期間 ═══ */
test("期間：月份與自訂區間的前後推移", () => {
  const P = E.Period;
  eq(P.endExclusive(P.month(2026, 12)), "2027-01-01");
  eq(P.prev(P.month(2026, 1)), P.month(2025, 12));
  const r = P.range("2026-03-01", "2026-03-10");
  eq(P.prev(r), P.range("2026-02-19", "2026-02-28"));
  eq(P.endExclusive(r), "2026-03-11");
  eq(P.anchorMonth(r), { y: 2026, m: 3 });
  ok(!P.canNext(P.month(2026, 11), "2026-11-15")); ok(P.canNext(P.month(2026, 10), "2026-11-15"));
});

/* ═══ 分析頁整合（analyze）：只算計入的、成員篩選、收入合併、儲蓄率 ═══ */
test("analyze：支出排除互轉與退款、收入含存款進帳、成員篩選", () => {
  const members = [me, her], accounts = [accA, accB];
  const d = {
    members, accounts, catRules: [], labels: [], excludeRules: [], filterRules: [], cats: [], subIgnores: new Set(),
    txs: [tx("e1", 500, "2026-02-03", "expense", "全聯", "email", { family_member_id: "m1" }),
          tx("e2", 1200, "2026-02-04", "expense", "UNIQLO", "email", { family_member_id: "m2" }),
          tx("r1", 1200, "2026-02-09", "income", "UNIQLO", "email", { family_member_id: "m2" }),
          tx("i1", 300, "2026-02-12", "invest", "普買 台積電", "email", { family_member_id: "m1" })],
    prevTxs: [tx("p1", 400, "2026-01-03", "expense", "全聯", "email", { family_member_id: "m1" })],
    range6: [], acctTxnsWide: [acct("s1", "A", 60000, "2026-02-05", "薪資"),
                              acct("w", "A", -10000, "2026-02-06", "轉出"), acct("d", "B", 10000, "2026-02-06", "轉入")]
  };
  const r = E.analyze(d, E.Period.month(2026, 2), null, "2026-02-20");
  eq(r.te, 500, "UNIQLO 被退款對消 → 只剩全聯");
  eq(r.ti, 60000, "薪資計入、互轉與退款不計");
  eq(r.prevTe, 400);
  eq(r.fin.investIn, 300); eq(r.fin.savingRate, Math.trunc((60000 - 500) * 100 / 60000));
  eq(r.exclCount, 3, "UNIQLO 支出＋退款收入＋互轉存入");
  eq(E.analyze(d, E.Period.month(2026, 2), "m2", "2026-02-20").te, 0, "阿華 的支出被對消");
  eq(r.movers[0][0], E.classify("全聯", []));
});

/* ═══ TripsTest ═══ */
const trip = (s, e, id = "t1") => ({ id, name: id, start_date: s, end_date: e });
const jp = trip("2026-02-21", "2026-02-28");
const ttx = (id, date, extra = {}) => tx(id, 100, date, "expense", "店", "email", extra);
const ov = o => new Map(Object.entries(o));
test("天數含頭尾、跨月跨年閏年、壞日期回 1", () => {
  eq(E.dayCount("2026-02-21", "2026-02-21"), 1); eq(E.dayCount("2026-02-21", "2026-02-28"), 8);
  eq(E.dayCount("2026-01-31", "2026-02-02"), 3); eq(E.dayCount("2025-12-31", "2026-01-01"), 2);
  eq(E.dayCount("2028-02-27", "2028-03-01"), 4); eq(E.dayCount("不是日期", "2026-02-28"), 1); eq(E.dayCount("", ""), 1);
});
test("區間頭尾都算、前後一天不算、字串比較不被月份位數騙", () => {
  ok(E.covers(jp, "2026-02-21")); ok(E.covers(jp, "2026-02-28")); ok(E.covers(jp, "2026-02-25"));
  ok(!E.covers(jp, "2026-02-20")); ok(!E.covers(jp, "2026-03-01"));
  const t = trip("2026-09-30", "2026-10-02"); ok(E.covers(t, "2026-10-01")); ok(!E.covers(t, "2026-09-29"));
});
test("inTrip：例外優先、只認自己那筆、看不懂的 action 退回日期", () => {
  ok(E.inTrip(ttx("a", "2026-02-25"), jp, ov({}))); ok(!E.inTrip(ttx("b", "2026-03-05"), jp, ov({})));
  ok(!E.inTrip(ttx("a", "2026-02-25"), jp, ov({ a: "exclude" })));
  ok(E.inTrip(ttx("a", "2026-01-20"), jp, ov({ a: "include" })));
  ok(E.inTrip(ttx("b", "2026-02-25"), jp, ov({ a: "exclude" })));
  ok(E.inTrip(ttx("a", "2026-02-25"), jp, ov({ a: "include" })));
  ok(E.inTrip(ttx("a", "2026-02-25"), jp, ov({ a: "???" }))); ok(!E.inTrip(ttx("b", "2026-03-05"), jp, ov({ b: "???" })));
});
test("tripView：移出的列在 kicked、手動加入的算進 rows、收入不混入", () => {
  const inn = ttx("in", "2026-02-25"), out = ttx("out", "2026-01-20");
  let v = E.tripView([inn, out], jp, ov({})); eq(v.rows.map(t => t.id), ["in"]); eq(v.kicked.length, 0);
  v = E.tripView([inn], jp, ov({ in: "exclude" })); eq(v.rows.length, 0); eq(v.kicked.map(t => t.id), ["in"]);
  v = E.tripView([out], jp, ov({ out: "include" })); eq(v.rows.map(t => t.id), ["out"]);
  const all = [inn, out, ttx("x", "2026-02-22")], o = ov({ in: "exclude", out: "include", x: "include" });
  const vv = E.tripView(all, jp, o), reach = new Set([...vv.rows, ...vv.kicked].map(t => t.id));
  for (const k of o.keys()) ok(reach.has(k), `${k} 被手動決定過卻找不到`);
  eq(E.tripView([inn, tx("inc", 100, "2026-02-25", "income")], jp, ov({})).rows.map(t => t.id), ["in"]);
});
test("加入候選：不列區間內、排除已在的／疑似重複／非支出、新到舊", () => {
  eq(E.tripAddCandidates([ttx("in", "2026-02-25"), ttx("out", "2026-01-20")], jp, new Set()).map(t => t.id), ["out"]);
  eq(E.tripAddCandidates([ttx("out", "2026-01-20")], jp, new Set(["out"])).length, 0);
  eq(E.tripAddCandidates([ttx("d", "2026-01-20", { dedup_status: "suspect" }),
    tx("i", 100, "2026-01-20", "income")], jp, new Set()).length, 0);
  eq(E.tripAddCandidates([ttx("a", "2026-01-01"), ttx("b", "2026-03-10"), ttx("c", "2026-01-15")], jp, new Set())
     .map(t => t.id), ["b", "c", "a"]);
});
test("tripTxAction：等於日期預設就不寫；寫完之後 inTrip＝使用者的意圖", () => {
  eq(E.tripTxAction(jp, "2026-02-25", true), null); eq(E.tripTxAction(jp, "2026-01-20", false), null);
  eq(E.tripTxAction(jp, "2026-02-25", false), "exclude"); eq(E.tripTxAction(jp, "2026-01-20", true), "include");
  for (const date of ["2026-02-25", "2026-01-20"]) for (const want of [true, false]){
    const a = E.tripTxAction(jp, date, want), t = ttx("a", date);
    eq(E.inTrip(t, jp, a ? ov({ a }) : ov({})), want, `${date} ${want}`);
  }
});
test("狀態文字五種情形都不一樣", () => {
  const s = [E.tripMemberState(ttx("a", "2026-02-25"), jp, ov({})), E.tripMemberState(ttx("a", "2026-02-25"), jp, ov({ a: "include" })),
    E.tripMemberState(ttx("a", "2026-02-25"), jp, ov({ a: "exclude" })), E.tripMemberState(ttx("a", "2026-01-20"), jp, ov({ a: "include" })),
    E.tripMemberState(ttx("a", "2026-01-20"), jp, ov({}))];
  eq(new Set(s).size, 5);
});
test("tripSummary：總額只算不重複且未排除、分類依計入金額排序", () => {
  const rows = [tx("a", 500, "2026-02-22", "expense", "壽司"), tx("b", 300, "2026-02-23", "expense", "壽司", "email", { exclude_state: "exclude" }),
    tx("c", 900, "2026-02-24", "expense", "飯店"), tx("d", 50, "2026-02-25", "expense", "壽司", "email", { dedup_status: "suspect" })];
  const r = E.tripSummary(jp, rows, ov({}), t => E.effExcludeF(t, new Map(), [], []), t => E.classify(t.merchant, []));
  eq(r.total, 1400); eq(r.counted.length, 2); eq(r.byCat[0][0], E.classify("飯店", [])); eq(r.days, 8);
  eq(r.byCat.find(x => x[0] === E.classify("壽司", []))[1].length, 3, "未計入的也要列在原分類");
});
test("tripsByRelevance：已算進去的最前、其次日期近、再來出發日早", () => {
  const a = trip("2026-01-01", "2026-01-05", "a"), b = trip("2026-03-01", "2026-03-03", "b"),
        c = trip("2026-02-10", "2026-02-12", "c"), d = trip("2026-02-14", "2026-02-15", "d");
  const t = ttx("x", "2026-02-13");
  eq(E.tripsByRelevance(t, [a, b, c, d], new Map()).map(x => x.id), ["c", "d", "b", "a"], "c、d 都差 1 天 → 出發日早的先");
  eq(E.tripsByRelevance(t, [a, b, c, d], new Map([["a", ov({ x: "include" })]]))[0].id, "a", "手動加入的排最前");
  eq(E.tripDistanceDays("2026-02-11", c), 0); eq(E.tripDistanceDays("壞", c), Infinity);
});

/* ═══ 第三階段：明細／帳戶／記帳 ═══ */
test("friendlyReason：對照表、家人互轉保留方向、補上內部轉帳、不認得的照原樣", () => {
  eq(E.friendlyReason("帳戶互轉"), "自己帳戶間搬錢"); eq(E.friendlyReason("家人互轉 阿華→阿明"), "家人間轉帳 阿華→阿明");
  eq(E.friendlyReason("內部轉帳"), "自家帳戶間搬錢"); eq(E.friendlyReason("跨表重複"), "與對帳單重複記到");
  eq(E.friendlyReason("新原因"), "新原因"); eq(E.friendlyReason(null), ""); eq(E.friendlyReason("constructor"), "constructor");
});
test("kindLabel、compactNt、ntD、plLabel 的格式同 App", () => {
  eq(["expense", "income", "invest", "transfer", "x"].map(E.kindLabel), ["支出", "收入", "投資", "轉帳", "x"]);
  eq(E.compactNt(9999), "9,999"); eq(E.compactNt(12345), "1.2萬"); eq(E.compactNt(-15000), "-1.5萬"); eq(E.compactNt(0), "0");
  eq(E.ntD(-0.4), "NT$ 0", "四捨五入後才判正負"); eq(E.ntD(-1234.5), "-NT$ 1,234"); eq(E.ntD(1234567), "NT$ 1,234,567");
  eq(E.plLabel(1234.4, 12.34), "▲ NT$ 1,234（+12.3%）"); eq(E.plLabel(-500, -5), "▼ NT$ 500（−5.0%）");
  eq(E.signedPct(3.25), "+3.3"); eq(E.signedPct(-0.04), "-0.0");
});
test("金額欄只收 1～9 位正整數、餘額欄收負數（§6-8）", () => {
  eq(E.parseAmount("500"), 500); eq(E.parseAmount(" 007 "), 7); eq(E.parseAmount("0"), null);
  eq(E.parseAmount("1234567890"), null, "10 位會超過 Int"); eq(E.parseAmount("12a"), null); eq(E.parseAmount(""), null);
  eq(E.parseBalance("-2400000"), -2400000); eq(E.parseBalance("0"), 0); eq(E.parseBalance(""), null); eq(E.parseBalance("1-2"), null);
  eq(E.parseBalance("1234.5"), 1234.5, "匯入的餘額有小數"); eq(E.parseBalance("1."), null);
});
test("手記分類：找 icon＋name 相同的列，沒有就照 key 拆出 icon 與 name、排在最後（§6-1）", () => {
  const cats = [{ id: "c1", icon: "🍜", name: "飲食", sort_order: 0 }, { id: "c2", icon: null, name: "雜項", sort_order: 4 }];
  eq(E.findCategory("🍜 飲食", cats).id, "c1"); eq(E.findCategory("📦 雜項", cats).id, "c2", "沒有 icon 的列與 classifyF 同樣當 📦");
  eq(E.findCategory("🛒 網購", cats), null);
  eq(E.newCategory("🛒 網購", cats), { icon: "🛒", name: "網購", kind: "expense", sort_order: 5 });
  eq(E.newCategory("雜費", []), { icon: "📦", name: "雜費", kind: "expense", sort_order: 0 });
  const made = { id: "c3", ...E.newCategory("🛒 網購", cats) };
  eq(E.classifyF(tx("m", 100, "2026-02-01", "expense", "網購", "manual", { category_id: "c3" }), [], [], [...cats, made]), "🛒 網購",
     "建出來的列，classifyF 回的正是選的 key");
});
test("overBudget 只列超支的；dueSoon 夾 28 號、跨月、7 天內含當天", () => {
  const labels = [{ key: "a", label: "A", budget: 100 }, { key: "b", label: "B", budget: 100 }, { key: "c", label: "C", budget: null }];
  eq(E.overBudget(labels, [["a", 150], ["b", 100], ["c", 999]]), [{ label: "A", spent: 150, budget: 100 }]);
  const r = (name, due_day, active = true) => ({ name, due_day, active });
  eq(E.dueSoon([r("今天", 10), r("三天後", 13), r("太遠", 20), r("已過", 9), r("停用", 11, false)], "2026-02-10"),
     [{ name: "今天", days: 0, day: 10 }, { name: "三天後", days: 3, day: 13 }]);
  eq(E.dueSoon([r("月底", 31)], "2026-02-25"), [{ name: "月底", days: 3, day: 28 }], "31 號夾成 28 號");
  eq(E.dueSoon([r("跨月", 2)], "2026-12-28"), [{ name: "跨月", days: 5, day: 2 }], "已過就看下個月（跨年）");
});
test("期間 fileTag：整月 2026-02、區間 起_迄", () => {
  eq(E.Period.fileTag(E.Period.month(2026, 2)), "2026-02");
  eq(E.Period.fileTag(E.Period.range("2026-02-01", "2026-02-15")), "2026-02-01_2026-02-15");
});

/* ── 明細頁 detailView ── */
const detailFixture = (extra = {}) => ({
  members: [me, her], accounts: [accA, accB, accC], catRules: [], labels: [], excludeRules: [], filterRules: [], cats: [],
  txsAll: [
    tx("e1", 500, "2026-02-03", "expense", "全聯", "email", { family_member_id: "m1" }),
    tx("e2", 300, "2026-02-05", "expense", "全聯", "notification", { family_member_id: "m1" }),
    tx("s1", 300, "2026-02-05", "expense", "全聯", "email", { family_member_id: "m1", dedup_status: "suspect" }),
    tx("x1", 80, "2026-02-06", "expense", "全聯", "email", { family_member_id: "m1", exclude_state: "exclude" }),
    tx("a1", 999, "2026-02-07", "expense", "全聯", "email", { family_member_id: "m1", dedup_status: "aux" }),
    tx("h1", 1200, "2026-02-04", "expense", "UNIQLO", "email", { family_member_id: "m2" }),
    tx("i1", 300, "2026-02-12", "invest", "普買 台積電", "email", { family_member_id: "m1" }),
    tx("o1", 100, "2026-01-31", "expense", "前月", "email", { family_member_id: "m1" })
  ].filter(t => t.occurred_at >= "2026-02-01"),
  acctTxnsWide: [acct("s", "A", 60000, "2026-02-05", "薪資"), acct("w", "A", -10000, "2026-02-06", "轉出"),
                 acct("d", "B", 10000, "2026-02-06", "轉入"), acct("q", "C", 777, "2026-02-08", "代收款"),
                 acct("p", "A", -50, "2026-01-29", "手續費")],
  ...extra
});
test("detailView：支出只算不重複且未排除；疑似重複與排除都列出、算進「未計」；aux 不列", () => {
  const v = E.detailView(detailFixture(), E.Period.month(2026, 2), null, "2026-02-20");
  eq(v.te, 2000, "500＋300＋1200"); eq(v.provisional, 300, "刷卡通知那筆");
  eq(v.expRows.map(r => r.t.id), ["x1", "e2", "s1", "h1", "e1"], "新到舊、aux 不在裡面");
  const g = v.groups.find(g => g.key === E.classify("全聯", []));
  eq([g.rows.length, g.off, g.suspect, g.total], [4, 2, 1, 800]);
  eq(v.groups.reduce((a, g) => a + g.rows.length, 0), v.expRows.length, "群組筆數加總＝摘要筆數（§6-13）");
  eq(v.excluded.exp.map(r => r.t.id), ["x1"]); eq(v.excluded.other.map(o => o.tag), ["投資買入"]); eq(v.excluded.invTotal, 300);
});
test("detailView：收入含存款進帳、互轉不計；存款流水與收入檢視對同一列判定一致（§6-10）", () => {
  const f = filter("exclude", { kw: "代收", direction: "income" });
  const v = E.detailView(detailFixture({ filterRules: [f] }), E.Period.month(2026, 2), null, "2026-02-20");
  eq(v.income.total, 60000, "薪資計入；互轉與篩選器排除的不計");
  const inc = v.income.rows.find(r => r.i.id === "q"), bank = v.bank.rows.find(r => r.a.id === "q");
  eq([inc.ex, inc.why], [true, "篩選器"]); eq([bank.ex, bank.why], [inc.ex, inc.why], "同一列兩個檢視的狀態相同");
  eq(v.bank.rows.map(r => r.a.id), ["q", "w", "d", "s"], "嚴格本期、新到舊（1/29 那筆只在寬窗）");
  eq([v.bank.inSum, v.bank.outSum], [60000, 0], "互轉兩邊與篩選器排除的都不計");
  eq(v.excluded.count, 1 + 1 + 2, "投資＋排除的支出＋排除的收入（互轉轉入、代收款）");
});
test("detailView：成員篩選、待確認收入、整月才比超支、空資料", () => {
  const d = detailFixture({ labels: [{ key: E.classify("全聯", []), label: "全聯類", budget: 600 }],
    reminders: [{ name: "卡費", due_day: 22, active: true }] });
  const v2 = E.detailView(d, E.Period.month(2026, 2), "m2", "2026-02-20");
  eq(v2.te, 1200); eq(v2.bank.rows.map(r => r.a.id), ["q"], "只留阿華的帳戶");
  eq(v2.over, [], "選了單一成員不比全家預算（同分析頁）");
  const v = E.detailView(d, E.Period.month(2026, 2), null, "2026-02-20");
  eq(v.over, [{ label: "全聯類", spent: 800, budget: 600 }]); eq(v.due, [{ name: "卡費", days: 2, day: 22 }]);
  eq(E.detailView(d, E.Period.range("2026-02-01", "2026-02-28"), null, "2026-02-20").over, [], "自訂區間不比預算");
  const old = E.detailView({ ...d, txsAll: [], acctTxnsWide: [acct("t", "A", 5000, "2026-02-06", "跨行轉入")] },
    E.Period.month(2026, 2), null, "2026-04-20");
  eq([old.income.pendingN, old.income.pendingAmt], [1, 5000], "超過 45 天沒配到轉出 → 待確認收入");
  ok(E.detailView({ ...d, txsAll: [], acctTxnsWide: [] }, E.Period.month(2026, 2), null).empty);
});
test("detailView 與 analyze 的支出同一個數：退款不會配到疑似重複那筆", () => {
  const base = { members: [me, her], accounts: [], catRules: [], labels: [], excludeRules: [], filterRules: [], cats: [],
    subIgnores: new Set(), prevTxs: [], range6: [], acctTxnsWide: [] };
  const txsAll = [tx("s1", 1200, "2026-02-04", "expense", "UNIQLO", "notification", { dedup_status: "suspect" }),
                  tx("e1", 1200, "2026-02-04", "expense", "UNIQLO"), tx("e2", 300, "2026-02-05", "expense", "全聯"),
                  tx("r1", 1200, "2026-02-09", "income", "UNIQLO")];
  const p = E.Period.month(2026, 2);
  const v = E.detailView({ ...base, txsAll }, p, null, "2026-02-20");
  const a = E.analyze({ ...base, txs: txsAll.filter(t => t.dedup_status === "unique") }, p, null, "2026-02-20");
  eq([v.te, a.te], [300, 300], "退款對消的是不重複的 e1");
  eq(v.expRows.find(r => r.t.id === "e1").why, "退款對消");
});
test("決定納不納入的篩選規則：只認 exclude／include、收入看描述與來源", () => {
  const ex = filter("exclude", { kw: "代收" }), cat = filter("cat:📦 其他", { kw: "全聯" });
  eq(E.txExclusionFilter(tx("a", 100, "2026-02-01", "expense", "代收水費"), [ex]), ex);
  eq(E.txExclusionFilter(tx("b", 100, "2026-02-01", "expense", "全聯"), [cat]), null, "分類規則不算");
  eq(E.incomeExclusionFilter({ desc: "代收款", source: "某銀行", amount: 5 }, [ex]), ex);
  const v = E.detailView(detailFixture({ filterRules: [ex] }), E.Period.month(2026, 2), null, "2026-02-20");
  eq(v.bank.rows.find(r => r.a.id === "q").rule, ex, "存入列帶著那條規則");
  eq(v.bank.rows.find(r => r.a.id === "w").rule, null, "轉出列不經篩選器");
});
test("newestFirst：新到舊、同日保持原順序、可指定日期欄", () => {
  const rows = [{ id: 1, d: "2026-01-02" }, { id: 2, d: "2026-01-03" }, { id: 3, d: "2026-01-02" }];
  eq(rows.slice().sort(E.newestFirst(r => r.d)).map(r => r.id), [2, 1, 3]);
  eq(E.addDays("2026-02-28", 1), "2026-03-01");
});
test("monthCsv：BOM、分類用 classifyF、疑似重複與排除原因、引號跳脫、公式防護", () => {
  const cats = [{ id: "c1", icon: "🍜", name: "飲食" }];
  const d = { members: [me], catRules: [], filterRules: [], cats, labels: [] };
  const rows = [tx("a", 100, "2026-02-01", "expense", "", "manual", { note: "午餐 \"便當\"", category_id: "c1", family_member_id: "m1" }),
                tx("b", 200, "2026-02-03", "expense", "=HYPERLINK()", "email", { dedup_status: "suspect" })];
  const csv = E.monthCsv(rows, d, t => (t.id === "b" ? "你手動排除" : ""));
  ok(csv.startsWith("\uFEFF日期,類型,金額,"), "BOM＋表頭");
  const lines = csv.trim().split("\n");
  eq(lines[1], `2026-02-03,支出,200,"'=HYPERLINK()","${E.classify("=HYPERLINK()", [])}","email","","疑似重複","你手動排除"`);
  eq(lines[2], `2026-02-01,支出,100,"午餐 ""便當""","🍜 飲食","手動記帳","阿明","",""`);
});

/* ── 帳戶 portfolio ── */
test("assetGroup：負數＝負債、存款、證券、基金信託、其他", () => {
  eq(E.assetGroup({ type: "bank" }, -1), "負債"); eq(E.assetGroup({ type: "bank" }, 5), "存款");
  eq(E.assetGroup({ type: "stock", name: "某投信·全球基金" }, 5), "基金信託"); eq(E.assetGroup({ type: "stock", name: "某證券·台積電" }, 5), "證券");
  eq(E.assetGroup({ type: "cash" }, 0), "其他"); eq(E.assetGroup({ type: "credit_card" }, 0), "其他");
});
test("portfolio：最新快照、資產負債淨值、趨勢沿用前值、沒快照的帳戶也列出（§6-4）、投資總覽", () => {
  const accts = [{ id: "A", name: "玉山(阿明)·活存", type: "bank" }, { id: "S", name: "某證券(阿明)·台積電", type: "stock" },
                 { id: "L", name: "某銀行(阿明)·房貸", type: "bank" }, { id: "N", name: "現金", type: "cash", member_id: "m2" }];
  const snap = (account_id, snapshot_date, balance, cost = null) => ({ account_id, snapshot_date, balance, cost });
  const p = E.portfolio(accts, [snap("A", "2026-01-31", 1000), snap("A", "2026-02-28", 1500), snap("S", "2026-02-15", "1200", "1000"),
                                snap("L", "2026-01-31", -800)]);
  eq(p.latest.get("A").balance, 1500); eq(p.latest.get("S").balance, 1200, "numeric 字串轉成數字");
  eq([p.assets, p.debts, p.net], [2700, -800, 1900]);
  eq(p.trend, [["2026-01-31", 200], ["2026-02-15", 1400], ["2026-02-28", 1900]], "同日合併、其他帳戶沿用前值");
  eq(p.groups.map(g => g.name), ["存款", "證券", "其他", "負債"]);
  eq(p.groups.find(g => g.name === "其他").rows.map(r => [r.a.id, r.s]), [["N", null]], "沒快照照樣在");
  const sec = p.groups.find(g => g.name === "證券"); eq([sec.total, sec.cost, sec.pl], [1200, 1000, 200]);
  eq(p.invest, { mv: 1200, cost: 1000, pl: 200, pct: 20 }); eq(p.holdings.map(h => h.a.id), ["S"]);
  eq(p.alloc, [["存款", 1500], ["證券", 1200]], "只算正餘額");
  const [a2, s2] = E.forMember(accts, p.snapshots, "m2", [me, her]);
  eq([a2.map(a => a.id), s2.length], [["N"], 0]);
  eq(E.forMember(accts, p.snapshots, null, [me, her])[0].length, 4);
  eq(E.portfolio([], []).invest, null);
});

/* ── 「👤 我的」頁（第四階段） ── */
test("normInviteCode：去掉所有空白（含中間、全形空白）並轉小寫；appPassword 去空白", () => {
  eq(E.normInviteCode("  AB12 cd34\n"), "ab12cd34"); eq(E.normInviteCode("ab12　CD34"), "ab12cd34");
  eq(E.normInviteCode(null), ""); eq(E.normInviteCode("   "), "");
  eq(E.appPassword(" abcd efgh ijkl mnop "), "abcdefghijklmnop"); eq(E.appPassword("abcdefghijklmnop").length, 16);
});
test("intIn：純數字且在區間內才收", () => {
  eq(E.intIn("28", 1, 28), 28); eq(E.intIn(" 1 ", 1, 28), 1); eq(E.intIn("0", 1, 28), null); eq(E.intIn("29", 1, 28), null);
  eq(E.intIn("1.5", 1, 28), null); eq(E.intIn("-3", 1, 28), null); eq(E.intIn("", 1, 28), null); eq(E.intIn("0", 0, 999), 0);
});
test("filterRuleSummary：條件依序列出、沒條件＝所有交易、三種動作（同 App filterRuleSummary）", () => {
  const labels = [{ key: "🍜 飲食", label: "🍜 吃飯" }];
  eq(E.filterRuleSummary(filter("cat:🍜 飲食", { kw: "麥當勞", account: "示範卡", amount_min: 100, direction: "expense" }), labels),
     "含「麥當勞」、帳戶「示範卡」、金額 100~?、支出 → 分類「🍜 吃飯」");
  eq(E.filterRuleSummary(filter("exclude", { amount_max: 50, direction: "income" })), "金額 ?~50、收入 → 不納入收支");
  eq(E.filterRuleSummary(filter("include")), "所有交易 → 納入收支");
  eq(E.filterRuleSummary(filter("cat:未知鍵")), "所有交易 → 分類「未知鍵」", "找不到標籤就顯示 key");
});
test("PARSER_DEFS／parserDef：11 家、欄位齊全、id 不重複", () => {
  eq(E.PARSER_DEFS.length, 11); eq(new Set(E.PARSER_DEFS.map(d => d.id)).size, 11);
  ok(E.PARSER_DEFS.every(d => d.label && d.from && d.subject && (d.kind === "bank" || d.kind === "credit_card")));
  eq(E.parserDef("esun_cc").from, "esunbank.com"); eq(E.parserDef("nope"), null); eq(E.parserDef(""), null);
});
test("mailboxFor：先看家人信箱連結，再看該成員帳單來源最常用的信箱（同票取先出現）", () => {
  const mails = [{ member_name: "阿華", gmail: "hua@example.com" }, { member_name: "阿明", gmail: "壞的" }];
  const src = (member_hint, mailbox) => ({ member_hint, mailbox });
  eq(E.mailboxFor("阿華", mails, [src("阿華", "other@example.com")]), "hua@example.com");
  eq(E.mailboxFor("阿明", mails, [src("阿明", "b@example.com"), src("阿明", "a@example.com"), src("阿明", "a@example.com")]), "a@example.com");
  eq(E.mailboxFor("阿明", [], [src("阿明", "x@example.com"), src("阿明", "y@example.com")]), "x@example.com");
  eq(E.mailboxFor("阿明", [], [src("阿明", "沒有小老鼠")]), null); eq(E.mailboxFor("無名", mails, []), null);
});
test("splitSources：啟用／發現／本機隱藏／永久忽略 四堆互不重疊", () => {
  const x = (id, active, sort_order = 0) => ({ id, active, sort_order, mailbox: "m@example.com", from_contains: id + ".com" });
  const list = [x("a", true), x("d1", false), x("d2", false), x("ig", false, -1)];
  const r = E.splitSources(list, s => E.sourceKey(s) === "m@example.com|d2.com");
  eq([r.active, r.discovered, r.hiddenLocal, r.ignored].map(l => l.map(s => s.id)), [["a"], ["d1"], ["d2"], ["ig"]]);
  eq(E.splitSources([x("d", false)]).discovered.length, 1, "沒給 hidden＝都不隱藏");
});
test("hideHash：16 碼十六進位、同字串同結果、不含信箱字樣", () => {
  const k = "m@example.com|bank.com", h = E.hideHash(k);
  eq(/^[0-9a-f]{16}$/.test(h), true, "格式");
  eq(E.hideHash(k), h, "穩定");
  eq(E.hideHash("m@example.com|bank2.com") !== h, true, "不同來源不同鍵");
  eq(/[@|]/.test(h), false, "讀取時靠「有沒有 @ 或 |」分辨舊明文，雜湊本身不能有");
});
test("ruleSearch：分類規則比商家或分類名、排除規則比樣式、不分大小寫、空白＝全部", () => {
  const labels = [{ key: "🛒 網購", label: "🛒 線上購物" }];
  const cr = [rule("shopee", "🛒 網購"), rule("麥當勞", "🍜 飲食")], ex = [xr("netflix", "exclude"), xr("公司代墊", "exclude")];
  eq(E.ruleSearch(cr, ex, "  ").cat.length, 2);
  eq(E.ruleSearch(cr, ex, "線上", labels).cat.map(r => r.merchant), ["shopee"], "比對顯示名稱");
  eq(E.ruleSearch(cr, ex, "SHOP", labels).cat.map(r => r.merchant), ["shopee"]);
  eq(E.ruleSearch(cr, ex, "NetFlix").exc.map(r => r.pattern), ["netflix"]);
});

console.log(`\n${pass} 通過、${fail} 失敗`);
process.exit(fail ? 1 : 0);
