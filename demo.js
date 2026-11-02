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
  },

  // ── 我的（me.js）。規則類一律換成新陣列：engine 的篩選器快取認的是陣列本身，原地改會用到舊結果 ──
  household: async () => ({ ...DEMO_DATA.me.household }),
  rotateInvite: async () => (DEMO_DATA.me.household.invite_code = demoHex()),
  /** 示範：現在的邀請碼＝加入成功；00000000＝模擬「錯太多次」被擋；其他＝碼不存在（回 null，同 RPC） */
  joinHousehold: async code => {
    if (code === "00000000") throw demoDbError("P0001", "邀請碼輸入錯誤太多次，請一小時後再試");
    return code === DEMO_DATA.me.household.invite_code ? "demo" : null;
  },
  createHousehold: async () => {},
  addMember: async (name, nickname, sort_order) => {
    if (S.members.some(m => m.name === name)) throw demoDbError("23505", "duplicate key value violates unique constraint");
    S.members = [...S.members, { id: "m" + Date.now(), name, nickname, sort_order, user_id: null }];
  },
  updateMember: async (id, fields) => {
    if (S.members.some(m => m.id !== id && m.name === fields.name)) throw demoDbError("23505", "duplicate key value violates unique constraint");
    Object.assign(demoRow(S.members, id), fields);
  },
  deleteMember: async id => {
    demoRow(S.members, id);
    if (DEMO_DATA.txs.some(t => t.family_member_id === id) || S.accounts.some(a => a.member_id === id))
      throw demoDbError("23503", "violates foreign key constraint");
    S.members = S.members.filter(m => m.id !== id);
  },
  setMemberAsMe: async id => {
    demoRow(S.members, id).user_id = uid;
    for (const m of S.members) if (m.id !== id && m.user_id === uid) m.user_id = null;
  },
  seedLabels: async keys => { S.labels = keys.map((k, i) => ({ id: "l" + i, key: k, label: k, sort_order: i, builtin: true, active: true })); },
  addLabel: async (key, label, sort_order, budget) => {
    S.labels = [...S.labels, { id: "l" + Date.now(), key, label, sort_order, budget, builtin: false, active: true }];
  },
  updateLabel: async (id, fields) => { demoRow(S.labels, id); S.labels = S.labels.map(l => (l.id === id ? { ...l, ...fields } : l)); },
  deleteLabel: async id => { demoRow(S.labels, id); S.labels = S.labels.filter(l => l.id !== id); },
  deleteCatRule: async id => { demoRow(S.catRules, id); S.catRules = S.catRules.filter(r => r.id !== id); },
  deleteExcludeRule: async id => { demoRow(S.excludeRules, id); S.excludeRules = S.excludeRules.filter(r => r.id !== id); },
  deleteSubIgnore: async p => {
    if (!S.subIgnores.has(p)) throw new Error("沒有成功寫進去（這筆可能已被刪除，或沒有權限）");
    S.subIgnores = new Set([...S.subIgnores].filter(x => x !== p));
  },
  addFilterRule: async row => { S.filterRules = [...S.filterRules, { id: "f" + Date.now(), active: true, ...row }]; },
  setFilterActive: async (id, active) => { demoRow(S.filterRules, id); S.filterRules = S.filterRules.map(r => (r.id === id ? { ...r, active } : r)); },
  deleteFilterRule: async id => { demoRow(S.filterRules, id); S.filterRules = S.filterRules.filter(r => r.id !== id); },
  addReminder: async (name, due_day) => { S.reminders = [...S.reminders, { id: "r" + Date.now(), name, due_day, active: true }]; },
  deleteReminder: async id => { demoRow(S.reminders, id); S.reminders = S.reminders.filter(r => r.id !== id); },
  // 祕密欄位：示範版同樣不留值，只記「有沒有設」
  myMail: async () => DEMO_DATA.me.mail && { ...DEMO_DATA.me.mail },
  mailboxes: async () => (DEMO_DATA.me.mail ? [{ ...DEMO_DATA.me.mail }] : []),
  saveMail: async (gmail, _password, member_name) => { DEMO_DATA.me.mail = { gmail, member_name }; },
  removeMail: async () => { DEMO_DATA.me.mail = null; },
  sources: async () => DEMO_DATA.me.sources.map(x => ({ ...x })),
  setSource: async x => {
    const row = { parser: x.parser, name: x.name, kind: x.kind, from_contains: x.from, subject_contains: x.subject,
                  member_hint: x.member, mailbox: x.mailbox, active: true };
    if (x.id){ const r = demoRow(DEMO_DATA.me.sources, x.id); Object.assign(r, row, { hasPw: r.hasPw || !!x.password }); }
    else DEMO_DATA.me.sources.push({ id: "bs" + Date.now(), sort_order: 0, ...row, hasPw: !!x.password });
  },
  deleteSource: async id => { DEMO_DATA.me.sources = DEMO_DATA.me.sources.filter(x => x.id !== id); },
  ignoreSource: async id => {
    const r = demoRow(DEMO_DATA.me.sources, id);
    if (r.active) throw demoDbError("P0001", "discovered source not found (or already active)");
    r.sort_order = -1;
  },
  ingest: async () => DEMO_DATA.me.ingest && { ...DEMO_DATA.me.ingest },
  saveIngest: async fields => { DEMO_DATA.me.ingest = { ...DEMO_DATA.me.ingest, ...fields }; },
  lastDone: async () => DEMO_DATA.me.lastDone,
  ai: async () => ({ ...DEMO_DATA.me.ai }),
  saveAi: async (enabled, key) => { DEMO_DATA.me.ai = { enabled, hasKey: DEMO_DATA.me.ai.hasKey || !!key }; },
  signOut: async () => {}
};
/** 示範用的資料庫錯誤（帶 code，走 plainError 跟真的一樣的翻譯路徑） */
const demoDbError = (code, message) => Object.assign(new Error(message), { code });
const demoHex = () => [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, "0")).join("");

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
  // 媽媽連著另一個登入帳號（試「這是我」的搶人警告）；小寶沒有帳號、名下也沒交易（試得到刪除成功）
  const members = [{ id: "m1", name: "爸爸", nickname: "爸", user_id: "u1", sort_order: 0 },
                   { id: "m2", name: "媽媽", user_id: "u2", sort_order: 1 }, { id: "m3", name: "小寶", user_id: null, sort_order: 2 }];
  const accounts = [
    { id: "a1", name: "示範銀行(爸爸)·活存", type: "bank", member_id: "m1" },
    { id: "a2", name: "示範銀行(媽媽)·活存", type: "bank", member_id: "m2" },
    { id: "a3", name: "示範證券(爸爸)·台積電", type: "stock", member_id: "m1" },      // 有成本 → 損益
    { id: "a4", name: "示範投信(媽媽)·全球基金", type: "stock", member_id: "m2" },    // 名稱含基金 → 基金信託
    { id: "a5", name: "示範銀行(爸爸)·房貸", type: "bank", member_id: "m1" },        // 負數 → 負債
    { id: "a6", name: "零用金", type: "cash", member_id: "m2" }                       // 還沒有任何快照
  ].map((a, i) => ({ display_name: null, sort_order: i, ...a }));
  const labels = E.AI_CATS.map((k, i) => ({ id: "l" + i, key: k, label: k, sort_order: i, builtin: true, active: true,
    budget: k === "🍜 飲食" ? 12000 : k === "🧺 食品雜貨" ? 9000 : k === "🚗 交通" ? 2500 : null }));   // 交通會超支
  const cats = [{ id: "c1", name: "飲食", icon: "🍜", kind: "expense", sort_order: 0 }];
  const now = new Date();
  const reminders = [{ id: "r1", name: "示範信用卡", due_day: (now.getDate() + 2) % 28 + 1, active: true }];   // 幾天後到期
  // 「我的」頁看得到的規則：都挑不影響示範數字的（停用的、對不到任何交易的）
  const cat = word => E.AI_CATS.find(k => k.includes(word)) || E.OTHER;
  const catRules = [{ id: "cr1", merchant: "示範健身房", category: cat("娛樂"), source: "user" },
                    { id: "cr2", merchant: "示範串流", category: cat("訂閱"), source: "ai" }];
  const excludeRules = [{ id: "xr1", pattern: "示範代墊款", exclude_state: "exclude", source: "user" }];
  const filterRules = [
    { id: "fr1", name: "大額先不算", priority: 100, kw: "", account: "", amount_min: 100000, amount_max: null, direction: "expense", action: "exclude", active: false },
    { id: "fr2", name: "", priority: 50, kw: "示範測試", account: "", amount_min: null, amount_max: null, direction: "any", action: "cat:" + cat("娛樂"), active: true }];
  Object.assign(S, { members, accounts, labels, cats, reminders, catRules, excludeRules, filterRules, subIgnores: new Set(["示範停車場"]) });
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
  // 「我的」頁：信箱用 example.com（保留給範例的網域）；帳單來源含一個「發現」、一個「永久忽略」；上次撈取留一個錯誤可展開
  const ago = h => new Date(Date.now() - h * 3600_000).toISOString();
  const src = (id, o) => ({ id, parser: "", kind: "credit_card", subject_contains: "", member_hint: "", active: true, sort_order: 0, hasPw: false, ...o });
  const me = {
    household: { id: "demo", name: "示範家庭", invite_code: "1a2b3c4d" },
    mail: { gmail: "dad.demo@example.com", member_name: "爸爸" },
    sources: [
      src("bs1", { parser: "esun_cc", name: "示範信用卡(爸爸)", from_contains: "esunbank.com", subject_contains: "信用卡",
                   member_hint: "爸爸", mailbox: "dad.demo@example.com", hasPw: true }),
      src("bs2", { parser: "first_bank", name: "示範銀行(媽媽)", kind: "bank", from_contains: "firstbank.com.tw",
                   subject_contains: "對帳單", member_hint: "媽媽", mailbox: "mom.demo@example.com" }),
      src("bs3", { name: "", kind: "bank", from_contains: "demo-bank.example", subject_contains: "對帳單", mailbox: "dad.demo@example.com", active: false }),
      src("bs4", { name: "示範購物網", from_contains: "shop.example", mailbox: "dad.demo@example.com", active: false, sort_order: -1 })],
    ingest: { since_days: 60, interval_value: 1, interval_unit: "week", email_enabled: true, notif_enabled: true, einvoice_enabled: false,
              auto_enabled: true, run_hour: null, last_run_at: ago(20), last_error_at: ago(20),
              last_error: "示範：某銀行對帳單 PDF 打不開（密碼可能不對）\n其餘來源都已撈完。" },
    lastDone: ago(50),
    ai: { enabled: true, hasKey: false }
  };
  DEMO_DATA = { txs, acct, snaps, trips, tripTx: [], me };
}
