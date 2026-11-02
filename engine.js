// ═══════════════════════════════════════════════════════════════════════
//  家計簿記帳語意引擎（2026-11-01）——Android App Rules.kt 的逐條移植。
//
//  為什麼另成一檔：網頁版要取代 App，「一筆錢算不算支出、算哪類、算誰的」必須跟 App
//  算出一模一樣的數字。舊儀表板是「簡化子集」（少了 45 天翻案、跨月寬窗、手續費容差…，
//  連 suspect 都算進去），兩邊數字會對不起來。這裡逐函式對照 Kotlin 寫，函式名與註解
//  標出對應的 Kotlin 位置；改規則時兩邊一起改，engine.test.js 守著。
//
//  資料一律吃資料庫原始列（snake_case：occurred_at、exclude_state…），不另做轉換。
//  純函式、無 DOM：瀏覽器當全域用，node 測試用 require。
//  優先序（O6）：① 單筆手動 ＞ ② 篩選器 ＞ ③ 商家規則 ＞ ④ 自動偵測 ＞ 預設納入。
// ═══════════════════════════════════════════════════════════════════════
"use strict";
(function (root) {
const DATA = typeof CLASSIFY_DATA !== "undefined" ? CLASSIFY_DATA : require("./classify_data.js");

const s = v => (v == null ? "" : String(v));
const isBlank = v => s(v).trim() === "";
const lc = v => s(v).toLowerCase();
const has = (text, kw) => lc(text).includes(lc(kw));          // Kotlin contains(ignoreCase = true)
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseDay = t => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(t)); return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) : NaN; };
const addDays = (t, n) => iso(new Date(parseDay(t) + n * 86400000));
function todayIso(){ const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const notMergedAux = t => t.dedup_status !== "merged" && t.dedup_status !== "aux";
/** 新到舊的比較器；同日維持原順序（相等回 0，排序才穩定）。dateOf 預設看 occurred_at。 */
const newestFirst = (dateOf = t => t.occurred_at) => (a, b) => (dateOf(a) < dateOf(b) ? 1 : dateOf(a) > dateOf(b) ? -1 : 0);

/** Rules.kt daysApart：解析失敗當 999 天。 */
function daysApart(a, b){
  const x = parseDay(a), y = parseDay(b);
  return isNaN(x) || isNaN(y) ? 999 : Math.abs(Math.round((x - y) / 86400000));
}

/** Rules.kt amtMatchTransfer（O2）：出 ≥ 入，差額 ≤ max(30, 0.3%)＝手續費小差。 */
function amtMatchTransfer(withdrawMag, depositAmt){
  if (withdrawMag < depositAmt) return false;
  return (withdrawMag - depositAmt) <= Math.max(30, depositAmt * 0.003);
}

/* ── 商家名正規化（Rules.kt normalizeMerchant／merchantCore） ── */
function normalizeMerchant(raw){
  if (isBlank(raw)) return "";
  let t = s(raw).normalize("NFKC").replace(/　/g, " ").trim().toLowerCase();
  for (let changed = true; changed && t; ){
    changed = false;
    for (const p of DATA.collectorPrefixes) if (t.startsWith(p)){ t = t.slice(p.length).trim(); changed = true; }
  }
  return t;
}
const BRANCH_TAIL = new RegExp("^(?:\\S*(?:" + DATA.branchTokens.join("|") + ")" +
  "|(?:no\\.?\\s*)?#?\\d{1,6}|t\\d{1,2}|(?:store|branch)\\s*\\S*)$");
function merchantCore(normalized){
  if (!normalized) return normalized;
  let t = normalized;
  const at = t.indexOf("@");
  if (at > 0) t = t.slice(0, at).trim();
  for (let guard = 0; guard < 4; guard++){
    const cut = Math.max(...["-", "(", ")", "·", "/", " "].map(c => t.lastIndexOf(c)));
    if (cut <= 0) break;
    const tail = t.slice(cut + 1).trim();
    if (tail && BRANCH_TAIL.test(tail)) t = t.slice(0, cut).trim().replace(/[-(·/]+$/, "");
    else break;
  }
  return t || normalized;
}

/* ── 分類（MainActivity.kt statCategory／incomeCategory；Rules.kt classify／classifyF） ── */
const STAT_CATS_NORM = DATA.statCats.map(([cat, kws]) =>
  [cat, [...new Set(kws.map(normalizeMerchant).filter(Boolean))]]);
const OTHER = DATA.other;
const AI_CATS = DATA.statCats.map(c => c[0]).concat([OTHER]);

function statCategory(merchant){
  const m = normalizeMerchant(merchant);
  if (!m) return OTHER;
  for (const [cat, kws] of STAT_CATS_NORM) if (kws.some(k => m.includes(k))) return cat;
  return OTHER;
}

const INCOME_CATS = [
  ["💰 薪資", ["薪", "薪資", "薪轉", "薪水", "代發", "獎金", "年終", "SALARY", "PAYROLL", "BONUS"]],
  ["🏦 利息", ["利息", "存息", "結息", "活息", "INTEREST"]],
  ["💹 配息", ["股息", "配息", "股利", "現金股利", "DIVIDEND"]],
  ["📊 賣出", ["普賣", "櫃賣", "賣出", "交割", "股票款", "股票", "SELL"]],
  ["↩️ 退款", ["退款", "退還", "退貨", "退刷", "退費", "返還", "折讓", "回饋", "REFUND", "CASHBACK"]],
  ["🔁 轉入", ["轉入", "匯入", "轉帳", "存入", "匯款", "入帳", "TRANSFER", "ATM"]]
];
function incomeCategory(text){
  for (const [cat, kws] of INCOME_CATS) if (kws.some(k => has(text, k))) return cat;
  return "💵 其他收入";
}

// 規則正規化快取：同一份規則陣列只算一次（同 Kotlin normRulesCache）
let normCache = null;
function normalizedRules(rules){
  if (normCache && normCache.src === rules) return normCache.out;
  const out = rules.filter(r => !isBlank(r.merchant))
    .map(r => [normalizeMerchant(r.merchant), r.category]).filter(p => p[0]);
  normCache = { src: rules, out };
  return out;
}
/** catRules 須已排成使用者優先（sortCategoryRules）。 */
function classify(merchant, rules){
  const m = normalizeMerchant(merchant);
  if (m && rules.length){
    const nr = normalizedRules(rules);
    let hit = nr.find(p => m === p[0]) || nr.find(p => m.includes(p[0]));
    if (hit) return hit[1];
    const core = merchantCore(m);
    if (core !== m || nr.some(p => p[0] !== merchantCore(p[0]))){
      hit = nr.find(p => core === merchantCore(p[0])) || nr.find(p => core.includes(merchantCore(p[0])));
      if (hit) return hit[1];
    }
  }
  return statCategory(merchant);
}
const sortCategoryRules = rules => rules.slice().sort((a, b) => (a.source === "user" ? 0 : 1) - (b.source === "user" ? 0 : 1));

/* ── 篩選器（Rules.kt matchFilterRule） ── */
let filterCache = null;
function activeFilters(filters){
  if (filterCache && filterCache.src === filters) return filterCache.out;
  const out = filters.filter(r => r.active !== false).sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  filterCache = { src: filters, out };
  return out;
}
function matchFilterRule(merchant, note, source, amount, kind, filters){
  if (!filters.length) return null;
  const text = normalizeMerchant(merchant) + " " + normalizeMerchant(note);
  const dir = kind === "income" ? "income" : "expense";
  return activeFilters(filters).find(r =>
    (isBlank(r.kw) || text.includes(normalizeMerchant(r.kw))) &&
    (isBlank(r.account) || lc(source).includes(s(r.account).trim().toLowerCase())) &&
    (r.amount_min == null || amount >= r.amount_min) &&
    (r.amount_max == null || amount <= r.amount_max) &&
    ((r.direction || "any") === "any" || r.direction === dir)) || null;
}

/** Rules.kt statSource：帳單來源名（各卡/來源帳單分組用）。 */
function statSource(t){
  const n = s(t.note);
  const before = x => { const i = x.indexOf("("); return (i >= 0 ? x.slice(0, i) : x).trim(); };
  if (n.startsWith("[申購")) return "申購（重建）";
  if (n.startsWith("[email]")) return before(n.slice(7).trim()) || "帳單匯入";
  if (n.startsWith("[notification]")) return before(n.slice(14).trim()) + "·通知";
  if (t.source === "manual") return "手動記帳";
  return s(t.source);
}

function classifyF(t, catRules, filters, cats = []){
  if (t.category_id){
    const c = cats.find(c => c.id === t.category_id);
    if (c) return `${c.icon || "📦"} ${c.name}`;
  }
  const f = matchFilterRule(t.merchant, t.note, statSource(t), t.amount, t.kind, filters);
  if (f && s(f.action).startsWith("cat:")) return f.action.slice(4);
  return classify(t.merchant, catRules);
}

/* ── 排除判定（Rules.kt ruleExcludeState／effExclude／effExcludeF／incExcludeF） ── */
function ruleExcludeState(text, rules){
  if (isBlank(text) || !rules.length) return null;
  const m = s(text).trim().toLowerCase();
  const r = rules.find(r => !isBlank(r.pattern) && m === r.pattern) ||
            rules.find(r => !isBlank(r.pattern) && m.includes(r.pattern));
  return r ? r.exclude_state : null;
}
function effExclude(state, id, text, auto, rules){
  if (state === "include") return [false, ""];
  if (state === "exclude") return [true, "手動排除"];
  const rs = ruleExcludeState(text, rules);
  if (rs === "include") return [false, ""];
  if (rs === "exclude") return [true, "規則排除"];
  const r = id != null ? auto.get(id) : undefined;
  return [r != null, r || ""];
}
function effExcludeF(t, auto, excludeRules, filters){
  if (t.exclude_state === "include") return [false, ""];
  if (t.exclude_state === "exclude") return [true, "手動排除"];
  const f = matchFilterRule(t.merchant, t.note, statSource(t), t.amount, t.kind, filters);
  if (f && f.action === "exclude") return [true, "篩選器"];
  if (f && f.action === "include") return [false, ""];
  return effExclude(null, t.id, isBlank(t.merchant) ? t.note : t.merchant, auto, excludeRules);
}
function incExcludeF(i, auto, excludeRules, filters){
  if (i.exclude_state === "include") return [false, ""];
  if (i.exclude_state === "exclude") return [true, "手動排除"];
  const f = matchFilterRule(i.desc, "", i.source, i.amount, "income", filters);
  if (f && f.action === "exclude") return [true, "篩選器"];
  if (f && f.action === "include") return [false, ""];
  return effExclude(null, i.id, i.desc, auto, excludeRules);
}
/** 決定這筆「納不納入」的篩選規則（action 是 exclude／include 的那條；沒有回 null）。
 *  篩選器排在商家排除規則前面（優先序 ②＞③）：有這條時，「以後同 X 都…」的永久規則對這筆不會生效。 */
const decides = f => (f && (f.action === "exclude" || f.action === "include") ? f : null);
const txExclusionFilter = (t, filters) => decides(matchFilterRule(t.merchant, t.note, statSource(t), t.amount, t.kind, filters));
const incomeExclusionFilter = (i, filters) => decides(matchFilterRule(i.desc, "", i.source, i.amount, "income", filters));

/* ── 歸屬（Portfolio.kt txOwnerId／assetOwnerId／AssetAccount.display） ── */
function txOwnerId(t, members){
  if (t.family_member_id) return t.family_member_id;
  const m = members.find(m => m.user_id != null && m.user_id === t.member_id);
  return m ? m.id : null;
}
function assetOwnerId(account, members){
  if (account.member_id && members.some(m => m.id === account.member_id)) return account.member_id;
  const bank = s(account.name).split("·")[0];
  const byName = members.find(m => !isBlank(m.name) && bank.includes(`(${m.name})`));
  if (byName) return byName.id;
  let best = null;
  for (const m of members) if (!best || (m.sort_order ?? 0) < (best.sort_order ?? 0)) best = m;
  return best ? best.id : null;
}
const nickOf = m => (isBlank(m.nickname) ? m.name : m.nickname);
function accountDisplay(account, members = []){
  if (!isBlank(account.display_name)) return account.display_name;
  const name = s(account.name), bank = name.split("·")[0];
  if (bank.includes("(")) return name;
  const m = members.find(m => m.id === account.member_id);
  if (!m) return name;
  const rest = name.includes("·") ? name.slice(name.indexOf("·") + 1) : null;
  return rest != null ? `${bank}(${nickOf(m)})·${rest}` : `${name}(${nickOf(m)})`;
}

/* ── 自動排除（Rules.kt autoExclusions）→ [交易 id→原因, 存款流水 id→原因] ── */
function autoExclusions(txs, acctTxns, accounts = [], members = [], today = todayIso()){
  const rTx = new Map(), rAcct = new Map();
  const deposits = acctTxns.filter(a => a.amount > 0 && a.id != null);
  const withdrawals = acctTxns.filter(a => a.amount < 0 && a.id != null);
  const usedW = new Set();
  const accOwner = new Map(accounts.map(a => [a.id, assetOwnerId(a, members)]));
  const ownerNick = mid => { const m = members.find(m => m.id === mid); return m ? nickOf(m) : "?"; };
  const TRUE_INCOME = ["💰 薪資", "🏦 利息", "💹 配息", "📊 賣出"];

  // A：帳戶互轉（同人＝帳戶互轉；不同人＝家人互轉 付款→收款）
  for (const d of deposits.filter(d => !rAcct.has(d.id))){
    if (TRUE_INCOME.includes(incomeCategory(s(d.description) + " " + s(d.note)))) continue;
    const w = withdrawals.find(w => !usedW.has(w.id) && !rAcct.has(w.id) && w.account_id !== d.account_id &&
      amtMatchTransfer(Math.abs(w.amount), d.amount) && daysApart(w.occurred_at, d.occurred_at) <= 2);
    if (w){
      const oD = accOwner.get(d.account_id), oW = accOwner.get(w.account_id);
      const reason = oD != null && oW != null && oD !== oW ? `家人互轉 ${ownerNick(oW)}→${ownerNick(oD)}` : "帳戶互轉";
      rAcct.set(d.id, reason); rAcct.set(w.id, reason); usedW.add(w.id);
    }
  }
  // A2：同帳戶一出一入、同額同摘要（≤2 天）＝進出相抵
  const usedW2 = new Set();
  for (const d of deposits.filter(d => !rAcct.has(d.id) && !isBlank(d.description))){
    const w = withdrawals.find(w => !usedW.has(w.id) && !usedW2.has(w.id) && !rAcct.has(w.id) &&
      w.account_id === d.account_id && Math.abs(w.amount) === d.amount &&
      s(w.description).trim() === s(d.description).trim() && daysApart(w.occurred_at, d.occurred_at) <= 2);
    if (w){ rAcct.set(d.id, "轉帳(進出相抵)"); usedW2.add(w.id); }
  }
  // C：跨表重複（存款存入 vs 對帳單交易收入）
  const txIncome = txs.filter(t => t.kind === "income" && notMergedAux(t) && t.id != null);
  const usedT = new Set();
  for (const d of deposits.filter(d => !rAcct.has(d.id))){
    const t = txIncome.find(t => !usedT.has(t.id) && t.amount === Math.trunc(d.amount) &&
      daysApart(t.occurred_at, d.occurred_at) <= 3);
    if (t){ rAcct.set(d.id, "與對帳單重複"); usedT.add(t.id); }
  }
  // B：信用卡退款/返還（交易表收入非證券類）＋對消原支出
  for (const t of txs.filter(t => t.kind === "income" && t.source !== "manual" && notMergedAux(t) && t.id != null)){
    const cat = incomeCategory(s(t.merchant) + " " + s(t.note));
    if (!["📊 賣出", "💹 配息", "🏦 利息"].includes(cat)){
      rTx.set(t.id, "信用卡退款/返還");
      const e = txs.find(e => e.kind === "expense" && notMergedAux(e) && e.id != null && !rTx.has(e.id) &&
        e.amount === t.amount && !isBlank(e.merchant) && lc(e.merchant) === lc(t.merchant));
      if (e) rTx.set(e.id, "退款對消");
    }
  }
  // T：內部轉入（明確自家搬錢語言 → 預設排除，45 天仍無對手方浮回「待確認收入」；匯款類需佐證才排除）
  const INTERNAL_KW = ["轉入", "轉帳", "帳務異動", "ATM", "存入"];
  for (const d of deposits.filter(d => !rAcct.has(d.id))){
    const text = s(d.description) + " " + s(d.note);
    if (incomeCategory(text) !== "🔁 轉入") continue;
    const hasOut = acctTxns.some(a => a.amount < 0 && amtMatchTransfer(Math.abs(a.amount), d.amount) &&
      daysApart(a.occurred_at, d.occurred_at) <= 3);
    if (INTERNAL_KW.some(k => has(text, k)))
      rAcct.set(d.id, hasOut ? "自家轉入" : daysApart(d.occurred_at, today) > 45 ? "待確認收入" : "自家轉入(待配對)");
    else if (hasOut) rAcct.set(d.id, "內部轉帳");
  }
  return [rTx, rAcct];
}

/* ── 收入清單（MainActivity.kt buildIncome） ── */
function buildIncome(txIncome, acctTxns, accounts, members){
  const acctById = new Map(accounts.map(a => [a.id, a]));
  const fromTx = txIncome.map(t => ({
    id: t.id, kind: "tx", date: t.occurred_at, amount: t.amount,
    category: incomeCategory(s(t.merchant) + " " + s(t.note)),
    desc: !isBlank(t.merchant) ? t.merchant : !isBlank(t.note) ? t.note : "收入",
    source: statSource(t), memberId: txOwnerId(t, members), exclude_state: t.exclude_state ?? null }));
  const fromAcct = acctTxns.filter(a => a.amount > 0).map(a => {
    const acc = acctById.get(a.account_id);
    return { id: a.id, kind: "acct", date: a.occurred_at, amount: Math.trunc(a.amount),
      category: incomeCategory(s(a.description) + " " + s(a.note)),
      desc: isBlank(a.description) ? "存入" : a.description,
      source: acc ? accountDisplay(acc, members) : "存款帳戶",
      memberId: acc ? assetOwnerId(acc, members) : null, exclude_state: a.exclude_state ?? null };
  });
  return fromTx.concat(fromAcct).sort(newestFirst(x => x.date));
}

/* ── 彙總（Rules.kt categoryTotals／monthlyTrend／detectSubscriptions） ── */
function groupSum(list, keyOf, amtOf = x => x.amount){
  const m = new Map();
  for (const x of list){ const k = keyOf(x); m.set(k, (m.get(k) || 0) + amtOf(x)); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
const categoryTotals = (counted, rules, filters, cats) => groupSum(counted, t => classifyF(t, rules, filters, cats));

function monthlyTrend(txs, anchor, months = 6){
  const out = [];
  for (let off = 0; off < months; off++){
    const [y, m] = ymAdd(anchor.y, anchor.m, -(months - 1 - off));
    const key = `${y}-${pad(m)}`;
    const sum = txs.filter(t => t.kind === "expense" && s(t.occurred_at).slice(0, 7) === key)
                   .reduce((a, t) => a + t.amount, 0);
    out.push([`${m}月`, sum]);
  }
  return out;
}

const NON_SUB_KW = ["停車", "計時", "停車場", "路邊停", "嘟嘟房", "小時停",
  "計次", "加油", "中油", "台亞", "超商", "便利商店", "全家", "７-", "7-", "統一超"];
function detectSubscriptions(txs, ignores = new Set()){
  const byMerchant = new Map();
  for (const t of txs){
    if (t.kind !== "expense" || !notMergedAux(t) || isBlank(t.merchant)) continue;
    const k = s(t.merchant).trim();
    if (!byMerchant.has(k)) byMerchant.set(k, []);
    byMerchant.get(k).push(t);
  }
  const out = [];
  for (const [m, list] of byMerchant){
    const key = m.toLowerCase();
    if ([...ignores].some(i => !isBlank(i) && (key === i || key.includes(i)))) continue;
    if (NON_SUB_KW.some(k => m.includes(k))) continue;
    const byMonth = new Map();
    for (const t of list){
      if (isNaN(parseDay(t.occurred_at))) continue;
      const ym = t.occurred_at.slice(0, 7);
      if (!byMonth.has(ym)) byMonth.set(ym, []);
      byMonth.get(ym).push(t);
    }
    if (byMonth.size < 3) continue;
    const monthsSorted = [...byMonth.keys()].sort();
    const consecutive = monthsSorted.every((ym, i) => i === 0 ||
      ymKey(...ymAdd(...ymParse(monthsSorted[i - 1]), 1)) === ym);
    if (!consecutive) continue;
    const reps = monthsSorted.map(ym => byMonth.get(ym).reduce((best, t) => (t.occurred_at > best.occurred_at ? t : best)));
    const amts = reps.map(t => t.amount);
    const med = amts.slice().sort((a, b) => a - b)[Math.floor(amts.length / 2)];
    if (med <= 0) continue;
    const tol = Math.max(1, Math.trunc(med * 0.02));
    if (amts.some(a => Math.abs(a - med) > tol)) continue;
    const days = reps.map(t => +t.occurred_at.slice(8, 10)).sort((a, b) => a - b);
    const medDay = days[Math.floor(days.length / 2)];
    if (days.some(d => { const diff = Math.abs(d - medDay); return Math.min(diff, 31 - diff) > 5; })) continue;
    const last = reps.reduce((best, t) => (t.occurred_at > best.occurred_at ? t : best));
    out.push({ merchant: m, months: byMonth.size, amount: med, lastDate: last.occurred_at });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

const labelOf = (key, labels) => { const l = labels.find(l => l.key === key); return l ? l.label : key; };
const isInvestSell = t => t.kind === "invest" && (s(t.merchant).includes("賣") || has(t.merchant, "SELL"));

/* ── 期間（MainActivity.kt Period：整月或自訂區間，起迄皆含） ── */
function ymAdd(y, m, d){ const t = y * 12 + (m - 1) + d; return [Math.floor(t / 12), (t % 12) + 1]; }
const ymKey = (y, m) => `${y}-${pad(m)}`;
const ymParse = k => k.split("-").map(Number);
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
const Period = {
  month: (y, m) => ({ type: "month", y, m }),
  range: (start, end) => ({ type: "range", start, end }),
  startDate: p => (p.type === "month" ? `${ymKey(p.y, p.m)}-01` : p.start),
  endExclusive: p => (p.type === "month" ? `${ymKey(...ymAdd(p.y, p.m, 1))}-01` : addDays(p.end, 1)),
  anchorMonth: p => (p.type === "month" ? { y: p.y, m: p.m } : { y: +p.end.slice(0, 4), m: +p.end.slice(5, 7) }),
  label: p => (p.type === "month" ? `${p.y} 年 ${p.m} 月` : `${p.start} ～ ${p.end}`),
  prev(p){
    if (p.type === "month") return Period.month(...ymAdd(p.y, p.m, -1));
    const len = daysBetween(p.start, p.end) + 1;
    return Period.range(addDays(p.start, -len), addDays(p.end, -len));
  },
  next(p){
    if (p.type === "month") return Period.month(...ymAdd(p.y, p.m, 1));
    const len = daysBetween(p.start, p.end) + 1;
    return Period.range(addDays(p.start, len), addDays(p.end, len));
  },
  canNext(p, today = todayIso()){
    return p.type === "month" ? ymKey(p.y, p.m) < today.slice(0, 7) : p.end < today;
  },
  fileTag: p => (p.type === "month" ? ymKey(p.y, p.m) : `${p.start}_${p.end}`)   // MainActivity.kt Period.fileTag
};

/* ── 分析頁一次算完（MainActivity.kt AnalysisScreen 的資料段，逐行對照） ──
 *  d: { txs, prevTxs, range6, acctTxnsWide, accounts, members, catRules, labels, excludeRules,
 *       filterRules, cats, subIgnores }（txs 系列＝dedup_status=unique）；period；sel＝成員 id 或 null。 */
function analyze(d, period, sel, today = todayIso()){
  const { members, accounts, catRules, excludeRules, filterRules, cats } = d;
  const mStart = Period.startDate(period), mNext = Period.endExclusive(period);
  const mine = list => (sel == null ? list : list.filter(t => txOwnerId(t, members) === sel));
  const acctTxns = d.acctTxnsWide.filter(a => a.occurred_at >= mStart && a.occurred_at < mNext);
  const trend6 = monthlyTrend(mine(d.range6), Period.anchorMonth(period));
  const [autoTx, autoAcct] = autoExclusions(d.txs, d.acctTxnsWide, accounts, members, today);
  const txs = mine(d.txs);
  const txExc = t => effExcludeF(t, autoTx, excludeRules, filterRules);
  const incExc = i => incExcludeF(i, i.kind === "tx" ? autoTx : autoAcct, excludeRules, filterRules);
  const exp = txs.filter(t => t.kind === "expense" && !txExc(t)[0]);
  const te = exp.reduce((a, t) => a + t.amount, 0);
  const prevAutoTx = autoExclusions(d.prevTxs, [], accounts, members, today)[0];
  const prevCounted = mine(d.prevTxs).filter(t => t.kind === "expense" &&
    !effExcludeF(t, prevAutoTx, excludeRules, filterRules)[0]);
  const prevTe = prevCounted.reduce((a, t) => a + t.amount, 0);
  const income0 = buildIncome(d.txs.filter(t => t.kind === "income"), acctTxns, accounts, members);
  const incomeSel = sel == null ? income0 : income0.filter(i => i.memberId === sel);
  const income = incomeSel.filter(i => !incExc(i)[0]);
  const excluded = [
    ...txs.filter(t => t.kind === "expense").map(t => [t, txExc(t)]).filter(([, e]) => e[0])
      .map(([t, e]) => ({ date: t.occurred_at, name: isBlank(t.merchant) ? s(t.note) : t.merchant, reason: e[1], amount: t.amount, dir: "支出" })),
    ...incomeSel.map(i => [i, incExc(i)]).filter(([, e]) => e[0])
      .map(([i, e]) => ({ date: i.date, name: i.desc, reason: e[1], amount: i.amount, dir: "收入" }))
  ].sort(newestFirst(x => x.date));
  const ti = income.reduce((a, i) => a + i.amount, 0);
  const incByCat = groupSum(income, i => i.category);
  const byCat = categoryTotals(exp, catRules, filterRules, cats);
  const bySrc = groupSum(exp, statSource);

  // 💎 理財指標
  const investTxs = txs.filter(t => t.kind === "invest" && notMergedAux(t));
  const investIn = investTxs.filter(t => !isInvestSell(t)).reduce((a, t) => a + t.amount, 0);
  const investOut = investTxs.filter(isInvestSell).reduce((a, t) => a + t.amount, 0);
  const catAmt = (list, c) => (list.find(x => x[0] === c) || [, 0])[1];
  const realInc = Math.max(0, ti - catAmt(incByCat, "📊 賣出"));
  const passive = catAmt(incByCat, "🏦 利息") + catAmt(incByCat, "💹 配息");
  const kdiv = (a, b) => Math.trunc(a / b);   // Kotlin Int 除法（向零取整）
  const fin = { realInc, consumption: te, investIn, investOut, passive,
    savingRate: realInc > 0 ? kdiv((realInc - te) * 100, realInc) : null,
    investRate: realInc > 0 ? kdiv(investIn * 100, realInc) : null };

  // 📊 分類變化（較前一期）
  const prevByCat = new Map(groupSum(prevCounted, t => classifyF(t, catRules, filterRules, cats)));
  const curMap = new Map(byCat);
  const movers = [...new Set([...curMap.keys(), ...prevByCat.keys()])]
    .map(c => [c, (curMap.get(c) || 0) - (prevByCat.get(c) || 0), curMap.get(c) || 0])
    .filter(x => x[1] !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5);

  const subs = detectSubscriptions(mine(d.range6), d.subIgnores || new Set());
  return { te, prevTe, ti, exclCount: excluded.length, excluded, exp, income, incByCat, byCat, bySrc,
           trend6, fin, movers: prevByCat.size ? movers : [], subs };
}

/* ── ✈️ 旅遊（Trips.kt）：行程＝日期區間；trip_tx 只存「跟日期預設不一樣」的單筆例外 ── */
const covers = (trip, date) => date >= trip.start_date && date <= trip.end_date;   // ISO 字串可直接比
/** 含頭尾天數（2/21~2/21＝1 天）；日期壞掉回 1（顯示用，不值得炸掉）。 */
function dayCount(a, b){ const n = daysBetween(a, b); return isNaN(n) ? 1 : n + 1; }
/** 優先序：單筆例外 ＞ 日期區間。overrides＝這趟的 txId → include/exclude。 */
function inTrip(t, trip, overrides){
  const o = overrides.get(t.id);
  return o === "include" ? true : o === "exclude" ? false : covers(trip, t.occurred_at);
}
/** rows＝算在這趟的支出；kicked＝被手動移出的（仍要列：那是唯一能加回來的入口）。 */
function tripView(mine, trip, overrides){
  const exp = mine.filter(t => t.kind === "expense");
  return { rows: exp.filter(t => inTrip(t, trip, overrides)), kicked: exp.filter(t => overrides.get(t.id) === "exclude") };
}
/** 「把其他消費加進這趟」的候選：只列區間外、不重複的支出，新到舊。 */
function tripAddCandidates(src, trip, exclude){
  return src.filter(t => t.kind === "expense" && t.dedup_status === "unique" && t.id != null &&
                         !exclude.has(t.id) && !covers(trip, t.occurred_at))
            .sort(newestFirst());
}
/** 要讓某筆算／不算這趟時該寫什麼；null＝刪掉例外即可（結果等於日期預設，不留同義紀錄）。 */
const tripTxAction = (trip, date, want) => (want === covers(trip, date) ? null : want ? "include" : "exclude");
function tripMemberState(t, trip, overrides){
  const o = overrides.get(t.id), c = covers(trip, t.occurred_at);
  if (o === "include") return c ? "手動保留" : "手動加入（日期在區間外）";
  if (o === "exclude") return "已移出這趟";
  return c ? "日期在區間內，自動算進這趟" : "不在這趟";
}
/** 一趟行程的彙總（TripsSection 的資料段）：總額只算「不重複且沒被排除」的。 */
function tripSummary(trip, mine, overrides, exc, catOf){
  const { rows, kicked } = tripView(mine, trip, overrides);
  const counts = t => t.dedup_status === "unique" && !exc(t)[0];
  const counted = rows.filter(counts);
  const total = counted.reduce((a, t) => a + t.amount, 0);
  const groups = new Map();
  for (const t of rows){ const c = catOf(t); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(t); }
  const byCat = [...groups.entries()].map(([c, l]) => [c, l, l.filter(counts).reduce((a, t) => a + t.amount, 0)])
                  .sort((a, b) => b[2] - a[2]);
  const manualN = rows.filter(t => overrides.has(t.id)).length + kicked.length;
  return { rows, kicked, counted, total, byCat, manualN, days: dayCount(trip.start_date, trip.end_date) };
}
/** 分類選單（Rules.kt categoryOptions）：labels 空時退回內建清單。 */
const categoryOptions = labels => (labels.length
  ? labels.filter(l => l.active !== false).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(l => [l.key, l.label])
  : AI_CATS.map(c => [c, c]));
/** 消費日期距行程幾天（區間內＝0；Trips.kt tripDistanceDays）。日期壞掉排最後。 */
function tripDistanceDays(date, trip){
  const d = parseDay(date), a = parseDay(trip.start_date), z = parseDay(trip.end_date);
  if (isNaN(d) || isNaN(a) || isNaN(z)) return Infinity;
  return d < a ? (a - d) / 86400000 : d > z ? (d - z) / 86400000 : 0;
}
/** 編輯對話框的行程順序（Trips.kt tripsByRelevance）：已算在裡面的 → 日期近的 → 出發日早的。只影響顯示。
 *  overrides＝tripId → (txId → action)。 */
function tripsByRelevance(t, trips, overrides){
  const key = tp => [inTrip(t, tp, overrides.get(tp.id) || new Map()) ? 0 : 1, tripDistanceDays(t.occurred_at, tp), s(tp.start_date)];
  return trips.map(tp => [tp, key(tp)])
    .sort(([, a], [, b]) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0))
    .map(([tp]) => tp);
}

/* ═══════════════════════════════════════════════════════════════════════
 *  第三階段（2026-11-01）：明細、帳戶、記一筆。對照 MainActivity.kt DetailScreen／Portfolio.kt。
 *  與 App 刻意不同的地方都是修 App 的 bug，註解標 §6-n（phase3 盤點的編號）。
 * ═══════════════════════════════════════════════════════════════════════ */

/** 排除原因 → 白話（MainActivity.kt friendlyReason）；只影響顯示，判定仍用原字串。
 *  補上 App 漏掉的「內部轉帳」（§6-15）。 */
const FRIENDLY = new Map([["帳戶互轉", "自己帳戶間搬錢"], ["轉帳(進出相抵)", "同帳戶進出相抵"],
  ["自家轉入", "自家帳戶轉入"], ["自家轉入(待配對)", "自家轉入（確認中）"], ["待確認收入", "可能是漏記的收入？"],
  ["信用卡退款/返還", "刷卡退款"], ["退款對消", "退款抵掉原消費"], ["與對帳單重複", "與對帳單重複記到"],
  ["跨表重複", "與對帳單重複記到"], ["篩選器", "你設的篩選規則"], ["規則排除", "你設的商家規則"],
  ["手動排除", "你手動排除"], ["投資買入", "買股票（不算花費）"], ["投資賣出", "賣股票（不算收入）"],
  ["轉帳", "轉帳（不算花費）"], ["內部轉帳", "自家帳戶間搬錢"]]);
function friendlyReason(r){
  r = s(r);
  return r.startsWith("家人互轉") ? "家人間轉帳" + r.slice(4) : FRIENDLY.get(r) ?? r;   // 保留「甲→乙」方向
}
const KINDS = new Map([["expense", "支出"], ["income", "收入"], ["invest", "投資"], ["transfer", "轉帳"]]);
const kindLabel = kind => KINDS.get(kind) ?? s(kind);                  // Rules.kt kindLabel

const grouped = n => Math.abs(n).toLocaleString("en-US");
/** 精簡金額（Portfolio.kt compactNt）：一萬以上「1.2萬」，否則千分位。 */
const compactNt = n => (Math.abs(n) >= 10000 ? (n / 10000).toFixed(1) + "萬" : (n < 0 ? "-" : "") + grouped(Math.round(n)));
/** 帶號金額（Portfolio.kt ntD）：先四捨五入再判正負，-0.4 不會顯示成「-NT$ 0」。 */
function ntD(n){ const r = Math.round(Number(n) || 0); return (r < 0 ? "-NT$ " : "NT$ ") + grouped(r); }
/** 報酬率「+12.3」（Kotlin "%+.1f"）。 */
const signedPct = p => (p >= 0 ? "+" : "-") + Math.abs(p).toFixed(1);
/** 未實現損益標籤（Portfolio.kt plLabel）：▲/▼ 金額（±%）。配色台灣慣例：賺紅賠綠，由畫面決定。 */
const plLabel = (pl, pct) => `${pl >= 0 ? "▲" : "▼"} ${ntD(Math.abs(pl))}（${pl >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%）`;

/** 金額欄（§6-8）：只收 1～9 位數字且 > 0；其餘回 null（App 沒上限，超過 Int 會閃退、0 也收）。 */
const parseAmount = v => { const t = s(v).trim(); return /^\d{1,9}$/.test(t) && +t > 0 ? +t : null; };
/** 餘額欄（負數＝負債；可帶小數——對帳單匯入的餘額有小數，預填回去要能原樣存）；空白或看不懂回 null。 */
const parseBalance = v => { const t = s(v).trim(); return /^-?\d{1,13}(\.\d{1,4})?$/.test(t) ? +t : null; };

/* ── 手記的分類（§6-1、6-2）：分類一律用 category_labels 的 key（如「🍜 飲食」）；
 *    手記列要的 category_id 指向 categories 表裡「icon name」等於這個 key 的那一列，沒有就建一列。 */
const catKey = c => `${c.icon || "📦"} ${c.name}`;                    // 與 classifyF 的寫法一致
const findCategory = (key, cats) => cats.find(c => catKey(c) === key) || null;
function newCategory(key, cats){
  const i = s(key).indexOf(" ");
  const [icon, name] = i > 0 ? [key.slice(0, i), key.slice(i + 1).trim()] : ["📦", s(key).trim()];
  const sort_order = cats.reduce((m, c) => Math.max(m, (c.sort_order ?? 0) + 1), 0);
  return { icon, name, kind: "expense", sort_order };
}

/** 超支（Rules.kt overBudget）：有設預算且花超過的分類。 */
const overBudget = (labels, byCat) => labels.filter(l => (l.budget || 0) > 0)
  .map(l => ({ label: l.label, spent: (byCat.find(x => x[0] === l.key) || [, 0])[1], budget: l.budget }))
  .filter(x => x.spent > x.budget);
/** 7 天內到期的帳單（Rules.kt dueSoon）：繳款日夾到 1～28，免得 2 月沒有 30 號時提醒消失。 */
function dueSoon(reminders, today = todayIso(), within = 7){
  return reminders.filter(r => r.active !== false).map(r => {
    const day = Math.min(28, Math.max(1, +r.due_day || 1));
    let due = `${today.slice(0, 8)}${pad(day)}`;
    if (due < today) due = `${ymKey(...ymAdd(+today.slice(0, 4), +today.slice(5, 7), 1))}-${pad(day)}`;
    return { name: r.name, days: daysBetween(today, due), day };
  }).filter(x => x.days >= 0 && x.days <= within);
}

/* ── 明細頁一次算完（MainActivity.kt DetailScreen 的資料段，:704-752） ──
 *  d：{ txsAll（本期非 merged，含 suspect）, acctTxnsWide, members, accounts, catRules, labels,
 *       excludeRules, filterRules, cats, reminders }。回傳畫面要的全部數字與分好組的列。 */
function detailView(d, period, sel, today = todayIso()){
  const { members, accounts, catRules, labels, excludeRules, filterRules, cats } = d;
  const mStart = Period.startDate(period), mNext = Period.endExclusive(period);
  const newest = newestFirst(x => x.date);
  const sum = (list, amt = x => x.amount) => list.reduce((a, x) => a + amt(x), 0);
  // aux（舊通知層）一律不列（§6-12：App 把它畫成正常列卻不計，看起來像總額算錯）
  const all = d.txsAll.filter(notMergedAux);
  const acctTxns = d.acctTxnsWide.filter(a => a.occurred_at >= mStart && a.occurred_at < mNext);
  // 自動偵測用全家資料算（寬窗配跨月互轉），再依人篩選顯示。只拿「不重複」的去配對——跟分析頁同一份輸入：
  // App 連疑似重複一起配，退款可能配到疑似重複那筆，結果不重複的那筆在明細照算、在分析被對消，兩頁總額對不起來
  const [autoTx, autoAcct] = autoExclusions(all.filter(t => t.dedup_status === "unique"), d.acctTxnsWide, accounts, members, today);
  const txExc = t => effExcludeF(t, autoTx, excludeRules, filterRules);
  const incExc = i => incExcludeF(i, i.kind === "tx" ? autoTx : autoAcct, excludeRules, filterRules);
  const txs = sel == null ? all : all.filter(t => txOwnerId(t, members) === sel);

  // 支出：列出全部（含疑似重複、已排除，灰字），只算「不重複且未排除」的
  const expRows = txs.filter(t => t.kind === "expense").map(t => {
    const [ex, why] = txExc(t);
    return { t, date: t.occurred_at, ex, why, suspect: t.dedup_status === "suspect", rule: txExclusionFilter(t, filterRules) };
  }).sort(newest);
  const counts = r => !r.ex && !r.suspect;
  const exp = expRows.filter(counts).map(r => r.t);
  const te = sum(exp);
  const byCat = categoryTotals(exp, catRules, filterRules, cats);
  // 依分類：群組標題的「n 筆、m 未計」與摘要「共 N 筆」同一個定義＝列出來的列（§6-13）
  const gm = new Map();
  for (const r of expRows){ const k = classifyF(r.t, catRules, filterRules, cats); if (!gm.has(k)) gm.set(k, []); gm.get(k).push(r); }
  const groups = [...gm].map(([key, rows]) => ({ key, rows, total: sum(rows.filter(counts), r => r.t.amount),
      off: rows.filter(r => !counts(r)).length, suspect: rows.filter(r => r.suspect).length }))
    .sort((a, b) => b.total - a.total);

  // 收入：交易表 income ＋ 存款存入（嚴格本期）
  const income0 = buildIncome(all.filter(t => t.dedup_status === "unique" && t.kind === "income"), acctTxns, accounts, members);
  const incRows = (sel == null ? income0 : income0.filter(i => i.memberId === sel))
    .map(i => { const [ex, why] = incExc(i); return { i, date: i.date, ex, why, rule: incomeExclusionFilter(i, filterRules) }; });
  const im = new Map();
  for (const r of incRows){ if (!im.has(r.i.category)) im.set(r.i.category, []); im.get(r.i.category).push(r); }
  const incGroups = [...im].map(([key, rows]) => ({ key, rows, total: sum(rows.filter(r => !r.ex), r => r.i.amount),
      off: rows.filter(r => r.ex).length }))
    .sort((a, b) => b.total - a.total);
  const pending = incRows.filter(r => r.why === "待確認收入");

  // 存款流水：存入列與收入檢視用同一個判定（含篩選器），轉出列用 effExclude——同一列兩處狀態一致（§6-10）
  const acctById = new Map(accounts.map(a => [a.id, a]));
  const depositItem = new Map(income0.filter(i => i.kind === "acct").map(i => [i.id, i]));
  const bankRows = acctTxns.filter(a => {
    const acc = acctById.get(a.account_id);
    return sel == null || (acc != null && assetOwnerId(acc, members) === sel);
  }).map(a => {
    const acc = acctById.get(a.account_id), dep = depositItem.get(a.id);
    const [ex, why] = dep ? incExc(dep) : effExclude(a.exclude_state, a.id, a.description, autoAcct, excludeRules);
    return { a, date: a.occurred_at, ex, why, account: acc ? accountDisplay(acc, members) : "存款帳戶",
             rule: dep ? incomeExclusionFilter(dep, filterRules) : null };   // 轉出列不經篩選器（同 App）
  }).sort(newest);

  // 已排除：投資／轉帳（不計收支但要看得到）＋被排除的支出與收入
  const other = txs.filter(t => t.dedup_status === "unique" && (t.kind === "invest" || t.kind === "transfer"))
    .map(t => ({ t, date: t.occurred_at, tag: t.kind === "transfer" ? "轉帳" : isInvestSell(t) ? "投資賣出" : "投資買入" }))
    .sort(newest);
  const exclExp = expRows.filter(r => r.ex && !r.suspect);
  const exclInc = incRows.filter(r => r.ex);
  return {
    txs, te, byCat, expRows, groups, txExc,
    provisional: sum(exp.filter(t => t.source === "notification")),
    income: { rows: incRows, groups: incGroups, total: sum(incRows.filter(r => !r.ex), r => r.i.amount),
              pendingN: pending.length, pendingAmt: sum(pending, r => r.i.amount) },
    bank: { rows: bankRows, inSum: sum(bankRows.filter(r => !r.ex && r.a.amount > 0), r => r.a.amount),
            outSum: sum(bankRows.filter(r => !r.ex && r.a.amount < 0), r => -r.a.amount) },
    excluded: { other, exp: exclExp, inc: exclInc, count: other.length + exclExp.length + exclInc.length,
                invTotal: sum(other.filter(o => o.t.kind === "invest" && !isInvestSell(o.t)), o => o.t.amount) },
    // 超支只在「合併＋整月」時比，同分析頁的「本月預算」：預算是全家整月的額度，拿去比單一成員或自訂區間會失真
    over: sel == null && period.type === "month" ? overBudget(labels, byCat) : [],
    due: dueSoon(d.reminders || [], today),
    empty: !txs.length && !incRows.length && !bankRows.length
  };
}

/** 匯出 CSV（MainActivity.kt buildMonthCsv）：UTF-8 BOM 讓 Excel 開中文不亂碼。
 *  分類欄改用 classifyF（§6-6：App 用 classify，跟畫面上的分類對不起來）。
 *  文字欄開頭是 = + - @ 時前面補 '，Excel 才不會把商家名當公式執行。 */
function monthCsv(txs, d, exclusionOf = () => ""){
  const esc = v => `"${s(v).replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
  const status = { suspect: "疑似重複", merged: "已合併" };
  const owner = t => { const m = d.members.find(m => m.id === txOwnerId(t, d.members)); return m ? m.name : ""; };
  const rows = txs.slice().sort(newestFirst())
    .map(t => [t.occurred_at, kindLabel(t.kind), t.amount].join(",") + "," +
      [isBlank(t.merchant) ? t.note : t.merchant, labelOf(classifyF(t, d.catRules, d.filterRules, d.cats), d.labels),
       statSource(t), owner(t), status[t.dedup_status] || "", exclusionOf(t)].map(esc).join(","));
  return "\uFEFF日期,類型,金額,商家/備註,分類,來源,成員,狀態,排除原因\n" + rows.map(r => r + "\n").join("");
}

/* ── 帳戶（Portfolio.kt assetGroup／forMember／PortfolioData／InvestSection） ── */
/** 帳戶分組：負數＝負債；bank＝存款；stock 名稱含基金/信託＝基金信託，否則證券；其餘＝其他。 */
function assetGroup(acc, balance){
  if (balance < 0) return "負債";
  if (acc.type === "bank") return "存款";
  if (acc.type === "stock") return /基金|信託/.test(s(acc.name)) ? "基金信託" : "證券";
  return "其他";
}
const ASSET_GROUPS = ["存款", "證券", "基金信託", "其他", "負債"];
/** 依成員篩選（Portfolio.kt forMember）：只留歸屬此人的帳戶與它們的快照；sel=null＝全家。 */
function forMember(accounts, snapshots, sel, members){
  if (sel == null) return [accounts, snapshots];
  const keep = new Set(accounts.filter(a => assetOwnerId(a, members) === sel).map(a => a.id));
  return [accounts.filter(a => keep.has(a.id)), snapshots.filter(x => keep.has(x.account_id))];
}
/** 帳戶頁一次算完（Portfolio.kt PortfolioData＋AccountsScreen 分組＋InvestSection）。
 *  餘額＝每個帳戶最新一筆快照（沒有流水）。沒有快照的帳戶也列在所屬分組（§6-4：App 會整個藏起來，
 *  手動新增時餘額留白的帳戶就再也找不到）。 */
function portfolio(accounts, snapshots){
  const snaps = snapshots.map(x => ({ ...x, balance: Number(x.balance), cost: x.cost == null ? null : Number(x.cost) }))
    .sort(newestFirst(x => x.snapshot_date));
  const latest = new Map();
  for (const x of snaps) if (!latest.has(x.account_id)) latest.set(x.account_id, x);
  let assets = 0, debts = 0;
  for (const x of latest.values()) if (x.balance > 0) assets += x.balance; else debts += x.balance;
  // 淨值趨勢（舊→新）：每個基準日＝各帳戶「當天或之前最近一次」餘額的加總（App v93 的修正）
  const asOf = new Map(), trend = [];
  for (const x of snaps.slice().reverse()){
    asOf.set(x.account_id, x.balance);
    const v = [...asOf.values()].reduce((a, b) => a + b, 0);
    if (trend.length && trend[trend.length - 1][0] === x.snapshot_date) trend[trend.length - 1][1] = v;
    else trend.push([x.snapshot_date, v]);
  }
  const hasCost = (a, x) => a.type === "stock" && x != null && x.cost != null && x.cost > 0;
  const gm = new Map(ASSET_GROUPS.map(g => [g, []]));
  for (const a of accounts){ const x = latest.get(a.id) || null; gm.get(assetGroup(a, x ? x.balance : 0)).push({ a, s: x }); }
  const groups = ASSET_GROUPS.filter(g => gm.get(g).length).map(name => {
    const rows = gm.get(name).sort((p, q) => (q.s ? Math.abs(q.s.balance) : -1) - (p.s ? Math.abs(p.s.balance) : -1));
    const priced = rows.filter(r => hasCost(r.a, r.s));
    const cost = priced.reduce((t, r) => t + r.s.cost, 0);
    return { name, rows, total: rows.reduce((t, r) => t + (r.s ? r.s.balance : 0), 0),
             cost, pl: priced.reduce((t, r) => t + r.s.balance - r.s.cost, 0) };
  });
  const holdings = accounts.filter(a => a.type === "stock" && latest.has(a.id))
    .map(a => ({ a, s: latest.get(a.id) })).sort((p, q) => q.s.balance - p.s.balance);
  const withCost = holdings.filter(h => hasCost(h.a, h.s));
  const mv = withCost.reduce((t, h) => t + h.s.balance, 0), cost = withCost.reduce((t, h) => t + h.s.cost, 0);
  const am = new Map();
  for (const a of accounts){ const x = latest.get(a.id); if (x && x.balance > 0){ const g = assetGroup(a, x.balance); am.set(g, (am.get(g) || 0) + x.balance); } }
  return { accounts, snapshots: snaps, latest, assets, debts, net: assets + debts, trend, groups, holdings,
           invest: withCost.length ? { mv, cost, pl: mv - cost, pct: (mv - cost) * 100 / cost } : null,
           alloc: [...am].sort((p, q) => q[1] - p[1]) };
}

/* ═══════════ 「👤 我的」頁（第四階段；App MainActivity.kt SettingsScreen 一帶） ═══════════ */
/** 邀請碼正規化：碼是 8 個小寫十六進位字（v59 rotate_invite_code 的 md5 片段）。
 *  家人常從訊息複製、手機會自動大寫開頭或夾空白——全部空白拿掉、轉小寫再送（App 只 trim）。 */
const normInviteCode = v => s(v).replace(/\s+/g, "").toLowerCase();
/** Gmail 應用程式密碼：Google 顯示成「abcd efgh ijkl mnop」，貼上會帶空白；真正的密碼是 16 個字母（App 只去頭尾）。 */
const appPassword = v => s(v).replace(/\s+/g, "");
/** 整數欄位：只收純數字且在 [lo, hi]，否則 null（自動撈取的天數、提醒日、優先序…） */
const intIn = (v, lo, hi) => { const t = s(v).trim(); return /^\d{1,9}$/.test(t) && +t >= lo && +t <= hi ? +t : null; };

/** 篩選器一行摘要（MainActivity.kt filterRuleSummary :2751）：條件 → 動作 */
function filterRuleSummary(r, labels = []){
  const cond = [];
  if (!isBlank(r.kw)) cond.push(`含「${r.kw}」`);
  if (!isBlank(r.account)) cond.push(`帳戶「${r.account}」`);
  if (r.amount_min != null || r.amount_max != null) cond.push(`金額 ${r.amount_min ?? "?"}~${r.amount_max ?? "?"}`);
  if ((r.direction || "any") !== "any") cond.push(r.direction === "income" ? "收入" : "支出");
  const a = s(r.action);
  const act = a.startsWith("cat:") ? `→ 分類「${labelOf(a.slice(4), labels)}」`
            : a === "exclude" ? "→ 不納入收支" : a === "include" ? "→ 納入收支" : `→ ${a}`;
  return `${cond.join("、") || "所有交易"} ${act}`;
}

/** 已支援解析的機構（MainActivity.kt PARSER_DEFS :3092）：選了自動帶入寄件網域／主旨／類型。新機構需先由開發者加解析器。 */
const PARSER_DEFS = [
  ["cathay_cc", "國泰世華信用卡", "credit_card", "cathaybk.com.tw", "信用卡"],
  ["sinopac_cc", "永豐信用卡", "credit_card", "banksinopac.com.tw", "信用卡"],
  ["taishin_cc", "台新信用卡", "credit_card", "taishinbank.com.tw", "信用卡"],
  ["esun_cc", "玉山信用卡", "credit_card", "esunbank.com", "信用卡"],
  ["fubon_cc", "富邦信用卡", "credit_card", "taipeifubon.com.tw", "信用卡"],
  ["first_bank", "第一銀行", "bank", "firstbank.com.tw", "對帳單"],
  ["yuanta_bank", "元大銀行", "bank", "yuantabank.tw", "對帳單"],
  ["hsbc", "HSBC 滙豐", "bank", "hsbc.com.tw", "對帳單"],
  ["sinopac_sec", "永豐金證券", "bank", "sinotrade.com.tw", "對帳單"],
  ["sinopac_bank", "永豐銀行(綜合對帳單)", "bank", "banksinopac.com.tw", "綜合對帳單"],
  ["ctbc_cc", "中國信託信用卡", "credit_card", "estats.ctbcbank.com", "電子帳單"]
].map(([id, label, kind, from, subject]) => ({ id, label, kind, from, subject }));
const parserDef = id => PARSER_DEFS.find(d => d.id === id) || null;

/** 成員 → 收信信箱的最佳猜測（MainActivity.kt mailboxFor :3120）：先看家人的信箱連結，
 *  再看這位成員既有帳單來源最常用的信箱。猜不到回 null。 */
function mailboxFor(name, mailAccounts, sources){
  const m = mailAccounts.find(a => a.member_name === name && s(a.gmail).includes("@"));
  if (m) return m.gmail;
  const n = new Map();
  for (const x of sources) if (x.member_hint === name && s(x.mailbox).includes("@")) n.set(x.mailbox, (n.get(x.mailbox) || 0) + 1);
  let best = null;
  for (const [k, c] of n) if (best == null || c > n.get(best)) best = k;   // 同票取先出現的（Kotlin maxByOrNull 同）
  return best;
}

/** 帳單來源分四堆（MainActivity.kt :3130-3205）：sort_order＝-1 是「永久忽略」（ignore_bank_source）；
 *  active=false 的是同步時探索掃描發現、還沒設定的；hidden(列) 為真＝只在這台裝置暫時隱藏 */
const sourceKey = x => `${x.mailbox}|${x.from_contains}`;
function splitSources(list, hidden = () => false){
  const pending = list.filter(x => !x.active && (x.sort_order ?? 0) >= 0);
  return { active: list.filter(x => x.active),
           discovered: pending.filter(x => !hidden(x)),
           hiddenLocal: pending.filter(x => hidden(x)),
           ignored: list.filter(x => (x.sort_order ?? 0) < 0) };
}

/** 已學習規則的搜尋（MainActivity.kt :2548-2550）：分類規則比商家或分類名稱，排除規則比樣式；不分大小寫 */
function ruleSearch(catRules, excludeRules, q, labels = []){
  const qq = s(q).trim().toLowerCase();
  if (!qq) return { cat: catRules, exc: excludeRules };
  return { cat: catRules.filter(r => lc(r.merchant).includes(qq) || lc(labelOf(r.category, labels)).includes(qq)),
           exc: excludeRules.filter(r => lc(r.pattern).includes(qq)) };
}

const api = { covers, dayCount, inTrip, tripView, tripAddCandidates, tripTxAction, tripMemberState, tripSummary,
  tripDistanceDays, tripsByRelevance,
  categoryOptions, daysApart, amtMatchTransfer, normalizeMerchant, merchantCore, statCategory, incomeCategory,
  classify, sortCategoryRules, matchFilterRule, statSource, classifyF, ruleExcludeState, effExclude,
  effExcludeF, incExcludeF, txOwnerId, assetOwnerId, accountDisplay, autoExclusions, buildIncome,
  categoryTotals, monthlyTrend, detectSubscriptions, labelOf, isInvestSell, ymAdd, Period, analyze,
  friendlyReason, kindLabel, compactNt, ntD, signedPct, plLabel, parseAmount, parseBalance,
  findCategory, newCategory, overBudget, dueSoon, detailView, monthCsv, txExclusionFilter, incomeExclusionFilter,
  newestFirst, addDays, nickOf,
  assetGroup, forMember, portfolio, ASSET_GROUPS,
  normInviteCode, appPassword, intIn, filterRuleSummary, PARSER_DEFS, parserDef, mailboxFor, sourceKey, splitSources, ruleSearch,
  AI_CATS, OTHER, todayIso };
if (typeof module !== "undefined") module.exports = api;
else root.Engine = api;
})(typeof window !== "undefined" ? window : globalThis);
