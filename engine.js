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
  return fromTx.concat(fromAcct).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
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
  }
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
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
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

const api = { daysApart, amtMatchTransfer, normalizeMerchant, merchantCore, statCategory, incomeCategory,
  classify, sortCategoryRules, matchFilterRule, statSource, classifyF, ruleExcludeState, effExclude,
  effExcludeF, incExcludeF, txOwnerId, assetOwnerId, accountDisplay, autoExclusions, buildIncome,
  categoryTotals, monthlyTrend, detectSubscriptions, labelOf, isInvestSell, ymAdd, Period, analyze,
  AI_CATS, OTHER, todayIso };
if (typeof module !== "undefined") module.exports = api;
else root.Engine = api;
})(typeof window !== "undefined" ? window : globalThis);
