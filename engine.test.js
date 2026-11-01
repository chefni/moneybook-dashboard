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

console.log(`\n${pass} 通過、${fail} 失敗`);
process.exit(fail ? 1 : 0);
