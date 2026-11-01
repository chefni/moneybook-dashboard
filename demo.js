// ═══════════════════════════════════════════════════════════════════════
//  家計簿示範模式（?demo=1）：合成資料＋同介面的 DemoStore。皆虛構，部署前看版面、點流程用。
//
//  為什麼另成一檔：示範程式跟真資料的路徑無關，正式使用時根本不載入（index.html 只在 ?demo=1 時才插入本檔）。
//  與 index.html 共用全域（S、E、pad、addDays、newestFirst、uid…）；Store 介面以 index.html 的 LiveStore 為準。
// ═══════════════════════════════════════════════════════════════════════
"use strict";

let DEMO_DATA = null;

/** 示範模式：同一套介面改頁內陣列；找不到列時照樣丟錯，讓錯誤路徑也點得到 */
const demoRow = (list, id) => { const r = list.find(x => x.id === id); if (!r) throw new Error("沒有成功寫進去（這筆可能已被刪除，或沒有權限）"); return r; };
const DemoStore = {
  trips: async () => DEMO_DATA.trips.slice().sort(newestFirst(t => t.start_date)),
  tripTx: async () => DEMO_DATA.tripTx.slice(),
  txAll: async (a, b) => DEMO_DATA.txs.filter(t => t.dedup_status !== "merged" && t.occurred_at >= a && t.occurred_at < b),
  txByIds: async ids => DEMO_DATA.txs.filter(t => ids.includes(t.id)),
  acct: async (a, b) => DEMO_DATA.acct.filter(t => t.occurred_at >= a && t.occurred_at < b),
  search: async q => DEMO_DATA.txs.filter(t => t.dedup_status !== "merged" &&
    (t.merchant + t.note).toLowerCase().includes(q.toLowerCase())).sort(newestFirst()),
  addTrip: async (name, s, e) => { DEMO_DATA.trips.push({ id: "trip" + Date.now(), name, start_date: s, end_date: e }); },
  deleteTrip: async id => { DEMO_DATA.trips = DEMO_DATA.trips.filter(t => t.id !== id); },
  setTripTx: async (trip_id, transaction_id, action) => {
    await DemoStore.clearTripTx(trip_id, transaction_id); DEMO_DATA.tripTx.push({ trip_id, transaction_id, action });
  },
  clearTripTx: async (tripId, txId) => {
    DEMO_DATA.tripTx = DEMO_DATA.tripTx.filter(r => !(r.trip_id === tripId && r.transaction_id === txId));
  },
  setCategoryRule: async (merchant, category) => { S.catRules = [{ merchant, category, source: "user" }, ...S.catRules]; },

  aged: async before => DEMO_DATA.txs.filter(t => t.source === "notification" && t.dedup_status === "unique" &&
    t.occurred_at < before).sort(newestFirst()),
  setDedup: async (id, status) => { demoRow(DEMO_DATA.txs, id).dedup_status = status; },
  setExclude: async (kind, id, state) => { demoRow(kind === "acct" ? DEMO_DATA.acct : DEMO_DATA.txs, id).exclude_state = state; },
  setExcludeRule: async (pattern, state) => {
    const p = pattern.trim().toLowerCase();
    S.excludeRules = [{ pattern: p, exclude_state: state, source: "user" }, ...S.excludeRules.filter(r => r.pattern !== p)];
  },
  updateTx: async (id, fields) => { Object.assign(demoRow(DEMO_DATA.txs, id), fields); },
  deleteTx: async t => {
    if (t.source === "manual") DEMO_DATA.txs.splice(DEMO_DATA.txs.indexOf(demoRow(DEMO_DATA.txs, t.id)), 1);
    else demoRow(DEMO_DATA.txs, t.id).dedup_status = "merged";
  },
  addTx: async row => { DEMO_DATA.txs.push({ id: "q" + Date.now(), exclude_state: null, ...row }); },
  addCategory: async c => ({ id: "c" + Date.now(), household_id: "demo", ...c }),

  snapshots: async ids => DEMO_DATA.snaps.filter(x => ids.includes(x.account_id)),
  acctTxns: async id => DEMO_DATA.acct.filter(a => a.account_id === id).sort(newestFirst()),
  setSnapshot: async (account_id, balance, cost, snapshot_date) => {
    DEMO_DATA.snaps = DEMO_DATA.snaps.filter(x => !(x.account_id === account_id && x.snapshot_date === snapshot_date));
    DEMO_DATA.snaps.push({ id: "n" + Date.now(), account_id, balance, cost, snapshot_date, source: "manual" });
  },
  renameAccount: async (id, displayName) => { demoRow(S.accounts, id).display_name = displayName; },
  addAccount: async (name, type, member_id) => {
    const a = { id: "acc" + Date.now(), name, type, member_id, display_name: null, sort_order: S.accounts.length };
    S.accounts.push(a);
    return a;
  }
};

/** 一個期間的資料（同 index.html loadPeriod 的形狀） */
function demoPeriod(p){
  const a = E.Period.startDate(p), b = E.Period.endExclusive(p), pv = E.Period.prev(p), an = E.Period.anchorMonth(p);
  const [y5, m5] = E.ymAdd(an.y, an.m, -5), [y1, m1] = E.ymAdd(an.y, an.m, 1);
  const inR = (x, s, e) => x.occurred_at >= s && x.occurred_at < e;
  const live = DEMO_DATA.txs.filter(t => t.dedup_status !== "merged"), uniq = live.filter(t => t.dedup_status === "unique");
  const txsAll = live.filter(t => inR(t, a, b));
  return { txsAll, txs: txsAll.filter(t => t.dedup_status === "unique"),
           prevTxs: uniq.filter(t => inR(t, E.Period.startDate(pv), E.Period.endExclusive(pv))),
           range6: uniq.filter(t => inR(t, `${y5}-${pad(m5)}-01`, `${y1}-${pad(m1)}-01`)),
           acctTxnsWide: DEMO_DATA.acct.filter(t => inR(t, addDays(a, -5), addDays(b, 5))) };
}
function buildDemo(){
  uid = "u1";   // 示範登入者＝爸爸（記一筆預設算他的）
  const members = [{ id: "m1", name: "爸爸", user_id: "u1", sort_order: 0 }, { id: "m2", name: "媽媽", sort_order: 1 }];
  const accounts = [
    { id: "a1", name: "示範銀行(爸爸)·活存", type: "bank", member_id: "m1" },
    { id: "a2", name: "示範銀行(媽媽)·活存", type: "bank", member_id: "m2" },
    { id: "a3", name: "示範證券(爸爸)·台積電", type: "stock", member_id: "m1" },      // 有成本 → 損益
    { id: "a4", name: "示範投信(媽媽)·全球基金", type: "stock", member_id: "m2" },    // 名稱含基金 → 基金信託
    { id: "a5", name: "示範銀行(爸爸)·房貸", type: "bank", member_id: "m1" },        // 負數 → 負債
    { id: "a6", name: "零用金", type: "cash", member_id: "m2" }                       // 還沒有任何快照
  ].map((a, i) => ({ display_name: null, sort_order: i, ...a }));
  const labels = E.AI_CATS.map((k, i) => ({ key: k, label: k, sort_order: i,
    budget: k === "🍜 飲食" ? 12000 : k === "🧺 食品雜貨" ? 9000 : k === "🚗 交通" ? 2500 : null }));   // 交通會超支
  const cats = [{ id: "c1", name: "飲食", icon: "🍜", kind: "expense", sort_order: 0 }];
  const now = new Date();
  const reminders = [{ id: "r1", name: "示範信用卡", due_day: (now.getDate() + 2) % 28 + 1, active: true }];   // 幾天後到期
  Object.assign(S, { members, accounts, labels, cats, reminders, catRules: [], excludeRules: [], filterRules: [], subIgnores: new Set() });
  const txs = [], acct = [], snaps = [];
  let n = 0;
  const shops = [["全聯福利中心", 860, "m2"], ["麥當勞", 245, "m1"], ["中油加油站", 1500, "m1"], ["蝦皮購物", 1290, "m2"],
                 ["UNIQLO 信義店", 1990, "m2"], ["台灣高鐵", 1490, "m1"], ["誠品書店", 680, "m2"], ["星巴克咖啡", 155, "m1"]];
  for (let k = 0; k < 7; k++){
    const [y, m] = E.ymAdd(now.getFullYear(), now.getMonth() + 1, -k);
    const day = d => `${y}-${pad(m)}-${pad(d)}`;
    const T = (d, amount, merchant, mid, kind = "expense", note = "[email] 示範信用卡(爸爸)", extra = {}) =>
      txs.push({ id: "t" + (++n), occurred_at: day(d), amount, merchant, family_member_id: mid, kind, note,
                 source: "email", dedup_status: "unique", exclude_state: null, ...extra });
    const price = i => shops[i][1] + ((k * 37 + i * 13) % 400);
    shops.forEach(([s, , mid], i) => T(3 + i * 3, price(i), s, mid, "expense",
      mid === "m2" ? "[email] 示範銀行卡(媽媽)" : "[email] 示範信用卡(爸爸)"));
    T(12, 390, "NETFLIX.COM", "m1");                         // 訂閱：同額同日
    T(20, 1288, "健身工廠", "m2", "expense", "[email] 示範銀行卡(媽媽)");
    if (k === 0){
      T(9, 1990, "UNIQLO 信義店", "m2", "income", "[email] 示範銀行卡(媽媽)"); T(16, 30000, "普買 0050", "m1", "invest");
      // 明細頁要點得到的各種狀態：疑似重複（同日同額的通知）、手記、刷卡通知（暫記）、手動排除、轉帳
      const dup = { source: "notification", dedup_status: "suspect" };
      T(6, price(1), "麥當勞", "m1", "expense", "[notification] 示範信用卡(爸爸)", dup);
      T(12, price(3), "蝦皮購物", "m2", "expense", "[notification] 示範銀行卡(媽媽)", dup);
      T(1, 120, "飲食", "m1", "expense", "", { source: "manual", category_id: "c1", member_id: "u1", family_member_id: "m1" });
      T(1, 85, "全家便利商店", "m1", "expense", "[notification] 示範信用卡(爸爸)", { source: "notification" });
      T(2, 3600, "公司聚餐代墊", "m1", "expense", "[email] 示範信用卡(爸爸)", { exclude_state: "exclude" });
      T(25, 15000, "繳信用卡費", "m1", "transfer", "[email] 示範銀行(爸爸)");
    }
    if (k === 2){
      T(2, 60, "路邊停車費", "m1", "expense", "[notification] 示範信用卡(爸爸)", { source: "notification" });   // 超過 45 天沒對到帳單
    }
    if (k === 3){
      acct.push({ id: "p" + (++n), account_id: "a1", occurred_at: day(25), amount: 5000, description: "跨行轉入", note: "" });   // 待確認收入
    }
    acct.push({ id: "s" + (++n), account_id: "a1", occurred_at: day(5), amount: 68000, description: "薪資", note: "", balance: 388000 - k * 4000 });
    acct.push({ id: "w" + (++n), account_id: "a1", occurred_at: day(6), amount: -20000, description: "網銀轉出", note: "給媽媽", balance: 368000 - k * 4000 });
    acct.push({ id: "d" + (++n), account_id: "a2", occurred_at: day(6), amount: 20000, description: "轉入", note: "" });
    acct.push({ id: "i" + (++n), account_id: "a2", occurred_at: day(21), amount: 37, description: "活儲利息", note: "" });
    // 餘額快照：每月一次（本月＝今天，可試「今天已記過」的覆蓋確認）
    const sd = k === 0 ? E.todayIso() : day(28);
    const S_ = (account_id, balance, cost = null) => snaps.push({ id: "n" + (++n), account_id, balance, cost, snapshot_date: sd, source: "email" });
    S_("a1", 368000 - k * 4000); S_("a2", 182000 - k * 1500); S_("a3", 452000 - k * 9000, 380000);
    S_("a4", 118000 + k * 2500, 130000); S_("a5", -2400000 - k * 15000);
  }
  const [ty, tm] = E.ymAdd(now.getFullYear(), now.getMonth() + 1, -1);
  const trips = [{ id: "trip1", name: "示範：台南三日", start_date: `${ty}-${pad(tm)}-09`, end_date: `${ty}-${pad(tm)}-12` }];
  DEMO_DATA = { txs, acct, snaps, trips, tripTx: [] };
}
