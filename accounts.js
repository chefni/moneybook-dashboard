// ═══════════════════════════════════════════════════════════════════════
//  家計簿「💼 帳戶」分頁（2026-11-01 第三階段）
//
//  對照 App：Portfolio.kt AccountsScreen／AccountDetailScreen／AddAccountDialog／InvestSection。
//  餘額＝每個帳戶最新一筆快照（沒有流水），數字由 engine.js 的 portfolio 一次算好。
//  帳戶明細是「下一層」：用 history.pushState 記在 history.state.acct，手機返回鍵回到列表（App 沒做，§6-16）。
//  與 index.html 共用全域（S、E、Store、sel、el/add/nt、formDialog/field/busy、refreshData、setTab…）。
// ═══════════════════════════════════════════════════════════════════════
"use strict";

/** 帳戶頁狀態：第一次切到帳戶頁才載入，refreshData 時作廢（開著才重抓） */
const AV = {
  snaps: null, loading: false, stale: true, err: "",
  open: new Set(), holdings: false,          // 展開的分組、持股明細
  txns: new Map(), txShow: 300               // 帳戶 id → { rows, err }（存款流水，分頁抓、唯讀）
};
const CHART_LINE = "#0abde3";

function accountsStale(){ AV.stale = true; AV.txns.clear(); }
function loadAccounts(){
  // 還沒確認家庭（登入途中）就不抓：抓到的會是空清單，而且會被當成「已經是新的」不再重抓
  if (AV.loading || !AV.stale || (!DEMO && !hid)) return;
  AV.loading = true; AV.stale = false;
  // 快照要分頁（每日帳務一年就上千筆；App 沒分頁，只拿到前 1000 筆，§6-5），帳戶多時每 100 個一批
  Store.snapshots(S.accounts.map(a => a.id))
    .then(r => { AV.snaps = r; AV.err = ""; }, e => { AV.err = "讀取帳戶失敗：" + plainError(e); })
    .finally(() => { AV.loading = false; if (AV.stale) loadAccounts(); else if (tab === "accounts") paintAccounts(); });
}

function paintAccounts(){
  loadAccounts();
  resetCharts();
  const root = $("accountsView");
  root.replaceChildren();
  const id = history.state && history.state.acct, acc = id && S.accounts.find(a => a.id === id);
  if (acc && AV.snaps) paintAccount(root, acc);
  else paintAccountList(root);
}
function openAccount(id){
  history.pushState({ acct: id }, "", "#accounts");
  window.scrollTo(0, 0);
  paintAccounts();
}
/** ‹ 返回：是自己推進來的那一層就走瀏覽器返回（跟返回鍵同一條路），否則直接回列表 */
function closeAccount(){
  if (history.state && history.state.acct) history.back();
  else paintAccounts();
}

/* ═══════════ 列表 ═══════════ */
function paintAccountList(root){
  root.appendChild(monthCard());
  if (!AV.snaps){
    if (AV.err){
      const r = el("button", null, "重試");
      r.addEventListener("click", () => { AV.stale = true; paintAccounts(); });
      add(root, el("p", "warn", AV.err), r);
    } else root.appendChild(el("p", "muted", "讀取帳戶中…"));
    return;
  }
  if (AV.loading) root.appendChild(el("p", "muted", "🔄 更新中…"));
  else if (AV.err) root.appendChild(el("p", "warn", AV.err + "（下方是上一次的資料）"));
  const [accounts, snaps] = E.forMember(S.accounts, AV.snaps, sel, S.members);
  if (!accounts.length){
    const who = S.members.find(m => m.id === sel);
    root.appendChild(el("p", "muted", who ? `${E.nickOf(who)} 名下尚無資產帳戶`
      : "尚無資產資料（按上方「🔄 立即同步」匯入銀行對帳單，或在下方手動新增帳戶）"));
  } else {
    const pf = E.portfolio(accounts, snaps);
    // 使用者要求（2026-11-14）：淨值趨勢放最上面、淨資產卡移到原本趨勢圖的位置（頁尾）
    root.appendChild(el("h3", "vh", "淨值趨勢"));
    trendChart(root, pf.trend, "淨值趨勢折線圖");
    root.appendChild(el("p", "note", "點分組展開帳戶明細"));
    for (const g of pf.groups) groupRows(root, g);
    investSection(root, pf);
    add(root, el("h3", "vh", "淨資產"), netWorthCard(pf));
  }
  const addBtn = el("button", null, "➕ 手動新增帳戶");
  addBtn.addEventListener("click", addAccountDialog);
  add(root, el("div", "hr"), addBtn, el("p", "note", "沒有對帳單的銀行/證券戶或現金，也能手動記餘額。"));
}

/** 「這個月花了」：日曆本月、目前成員篩選；算法與明細頁的支出總額同一個（detailView），點了跳明細 */
function monthCard(){
  const c = el("button", "card spend");
  c.hidden = true;   // 算出來才出現；讀不到就整張不顯示（同 App）
  c.addEventListener("click", () => { DV.view = "expense"; setTab("detail", thisMonth()); });
  const p = thisMonth(), who = S.members.find(m => m.id === sel), mySel = sel;
  periodData(p).then(d => {
    if (mySel !== sel || !c.isConnected) return;   // 等的時候換了成員或已重畫（例如重抓過）：交給新的那張卡
    const v = E.detailView({ ...S, ...d }, p, sel);
    add(c, el("span", "muted", `這個月${who ? E.nickOf(who) : ""}花了`), el("span", "big", nt(v.te)),
      el("span", "muted", "點我看明細 ›"));
    c.hidden = false;
  }, e => console.warn("本月支出讀取失敗", e));
  return c;
}

function netWorthCard(pf){
  const c = el("section", "card");
  add(c, el("span", "muted", "淨資產"), el("span", "big " + (pf.net < 0 ? "expense" : "income"), E.ntD(pf.net)));
  if (pf.trend.length >= 2){
    const [prevDate, prev] = pf.trend[pf.trend.length - 2], chg = pf.trend[pf.trend.length - 1][1] - prev;
    c.appendChild(el("p", chg >= 0 ? "income" : "expense", `較 ${prevDate} ${chg >= 0 ? "▲" : "▼"} ${E.ntD(Math.abs(chg))}`));
  }
  add(c, el("p", "note", "※ 含股票/基金市值，市值漲跌≠現金進出"),
    add(el("div", "stats"), add(el("div"), el("span", "muted", "資產"), el("b", "income", E.ntD(pf.assets))),
                            add(el("div"), el("span", "muted", "負債"), el("b", "expense", E.ntD(pf.debts)))));
  return c;
}

/** 一個分組（預設收合）：標題列有合計與損益，展開後逐帳戶 */
function groupRows(root, g){
  const key = g.name, open = AV.open.has(key);
  const h = el("button", "ghead");
  h.setAttribute("aria-expanded", String(open));
  add(h, el("span", "m", `${open ? "▾" : "▸"} ${g.name}（${g.rows.length}）`),
    add(el("span", "a"), el("span", g.total < 0 ? "expense" : null, E.ntD(g.total)),
        g.cost > 0 ? el("small", g.pl >= 0 ? "gain" : "loss", E.plLabel(g.pl, g.pl * 100 / g.cost)) : null));
  h.addEventListener("click", () => { open ? AV.open.delete(key) : AV.open.add(key); paintAccounts(); });
  root.appendChild(h);
  if (!open) return;
  for (const { a, s } of g.rows){
    const hasPL = a.type === "stock" && s && s.cost > 0, pl = hasPL ? s.balance - s.cost : 0;
    const row = el("button", "main");
    add(row, add(el("span", "m"), el("span", null, E.accountDisplay(a, S.members)),
        el("small", null, !s ? "尚未有餘額 · 點此更新" : hasPL ? `成本 ${E.ntD(s.cost)} · 基準日 ${s.snapshot_date}`
                                                             : `基準日 ${s.snapshot_date} · 點看明細 ›`)),
      add(el("span", "a"), el("b", s && s.balance < 0 ? "expense" : null, s ? E.ntD(s.balance) : "—"),
          hasPL ? el("small", pl >= 0 ? "gain" : "loss", E.plLabel(pl, pl * 100 / s.cost)) : null));
    row.addEventListener("click", () => openAccount(a.id));
    root.appendChild(add(el("div", "li"), row));
  }
}

/** 📈 投資理財（App InvestSection）：總覽、持股明細、資產配置（淨值趨勢已移到頁首） */
function investSection(root, pf){
  if (!pf.accounts.some(a => a.type === "stock")) return;
  root.appendChild(el("h3", "vh", "📈 投資理財"));
  const iv = pf.invest;
  if (!iv) add(root, el("b", null, "投資總覽"), el("p", "muted", pf.holdings.length ? "尚無成本資料（需重灌含成本的快照）" : "無證券持倉"));
  else root.appendChild(add(el("section", "card"), el("span", "muted", `目前${iv.pl >= 0 ? "獲利" : "虧損"}（未實現）`),
    el("span", "big " + (iv.pl >= 0 ? "gain" : "loss"), (iv.pl >= 0 ? "+" : "") + E.ntD(iv.pl)),
    el("b", iv.pl >= 0 ? "gain" : "loss", `報酬率 ${E.signedPct(iv.pct)}%`),
    add(el("div", "stats"), add(el("div"), el("span", "muted", "市值"), el("b", null, E.ntD(iv.mv))),
                            add(el("div"), el("span", "muted", "成本"), el("b", null, E.ntD(iv.cost))))));
  const h = el("button", "ghead");
  h.setAttribute("aria-expanded", String(AV.holdings));
  h.appendChild(el("span", "m", `${AV.holdings ? "▾" : "▸"} 持股明細（${pf.holdings.length}）`));
  h.addEventListener("click", () => { AV.holdings = !AV.holdings; paintAccounts(); });
  root.appendChild(h);
  if (AV.holdings){
    if (!pf.holdings.length) root.appendChild(el("p", "muted", "無證券持倉"));
    for (const { a, s } of pf.holdings){
      const name = String(a.name), dot = name.indexOf("·");
      const pl = s.cost > 0 ? s.balance - s.cost : null;
      const row = el("button", "main");
      add(row, add(el("span", "m"), el("span", null, dot >= 0 ? name.slice(dot + 1) : name),
                   el("small", null, `${dot >= 0 ? name.slice(0, dot) : name} · ${s.snapshot_date}`)),
          add(el("span", "a"), el("b", null, E.ntD(s.balance)),
              pl == null ? null : el("small", pl >= 0 ? "gain" : "loss", `${pl >= 0 ? "+" : ""}${E.ntD(pl)}（${E.signedPct(pl * 100 / s.cost)}%）`)));
      row.addEventListener("click", () => openAccount(a.id));
      root.appendChild(add(el("div", "li"), row));
    }
  }
  root.appendChild(el("h3", "vh", "資產配置"));
  const total = pf.alloc.reduce((t, x) => t + x[1], 0);
  if (total > 0){
    if (window.Chart) chartBox(root, "資產配置圓環圖（數值見下方）", cv => donut(cv, pf.alloc, total));
    for (const [g, v] of pf.alloc) root.appendChild(row2(`${g}　${Math.round(v * 100 / total)}%`, E.ntD(v)));
  } else root.appendChild(el("p", "muted", "沒有正餘額的帳戶"));
}

/* ═══════════ 帳戶明細 ═══════════ */
function paintAccount(root, acc){
  const isStock = acc.type === "stock";
  const pf = E.portfolio([acc], AV.snaps.filter(x => x.account_id === acc.id));
  const s = pf.latest.get(acc.id) || null;
  const back = el("button", "link", "‹ 返回帳戶");
  back.addEventListener("click", closeAccount);
  const upd = el("button", null, "＄ 更新餘額"), ren = el("button", null, "✎ 改名");
  upd.addEventListener("click", () => balanceDialog(acc, s));
  ren.addEventListener("click", () => renameDialog(acc));
  add(root, back, el("h2", "vh", E.accountDisplay(acc, S.members)), add(el("div", "rowx"), upd, ren),
    el("p", "muted", s ? `最新餘額 ${E.ntD(s.balance)} · 基準日 ${s.snapshot_date}` : "尚未有餘額：按「＄ 更新餘額」記第一筆"));
  if (isStock && s && s.cost > 0){
    const pl = s.balance - s.cost, cls = pl >= 0 ? "gain" : "loss";
    root.appendChild(add(el("section", "card"), el("span", "muted", `目前${pl >= 0 ? "獲利" : "虧損"}（未實現）`),
      el("span", "big " + cls, (pl >= 0 ? "+" : "") + E.ntD(pl)), el("b", cls, `報酬率 ${E.signedPct(pl * 100 / s.cost)}%`),
      add(el("div", "stats"), add(el("div"), el("span", "muted", "市值"), el("b", null, E.ntD(s.balance))),
                              add(el("div"), el("span", "muted", "成本"), el("b", null, E.ntD(s.cost))))));
  }
  if (!isStock) spendToggle(root, acc);
  root.appendChild(el("h3", "vh", isStock ? "市值變化" : "餘額變化"));
  trendChart(root, pf.trend, (isStock ? "市值" : "餘額") + "變化折線圖");
  if (!isStock) accountTxns(root, acc);
}

/** 存款帳戶的流水（唯讀；點進來才抓、分頁抓完） */
function accountTxns(root, acc){
  root.appendChild(el("h3", "vh", "交易明細（轉帳/出入金）"));
  if (acc.spend_account !== true) root.appendChild(el("p", "note", "點任一筆轉出，可指定它要算成哪一類消費（房貸、保險、孝親…）。"));
  const got = AV.txns.get(acc.id);
  if (!got){
    AV.txns.set(acc.id, { rows: null, err: "" });
    Store.acctTxns(acc.id).then(async rows => { AV.txns.set(acc.id, { rows, auto: await transferMap(rows, acc), err: "" }); },
                                e => { AV.txns.set(acc.id, { rows: null, err: "讀取失敗：" + plainError(e) }); })
      .finally(() => { if (tab === "accounts" && history.state && history.state.acct === acc.id) paintAccounts(); });
  }
  if (!got || (!got.rows && !got.err)){ root.appendChild(el("p", "muted", "讀取中…")); return; }
  if (got.err){ root.appendChild(el("p", "warn", got.err)); AV.txns.delete(acc.id); return; }   // 下次畫面重試
  if (!got.rows.length){ root.appendChild(el("p", "muted", "此帳戶尚無交易明細（目前僅部分銀行對帳單有解析交易）")); return; }
  for (const t of got.rows.slice(0, AV.txShow)){
    const amt = Number(t.amount), plus = amt >= 0;
    const main = el(plus ? "div" : "button", "main"), sub = el("small");
    const tag = plus ? null : useTag(t, acc, got.auto);
    if (tag) sub.appendChild(el("span", "tag" + (tag.pending ? " warn" : ""), tag.text));
    sub.appendChild(document.createTextNode(t.occurred_at + (t.note ? ` · ${t.note}` : "") + (t.balance != null ? ` · 餘 ${E.ntD(t.balance)}` : "")));
    add(main, add(el("span", "m"), el("span", null, (plus ? "＋ " : "－ ") + (t.description || "（無摘要）")), sub),
      el("b", "a " + (plus ? "income" : "expense"), (plus ? "+" : "-") + E.ntD(Math.abs(amt))));
    if (!plus) main.addEventListener("click", () => purposeDialog(t, acc));
    root.appendChild(add(el("div", "li"), main));
  }
  if (got.rows.length > AV.txShow){
    const more = el("button", null, `再顯示 300 筆（共 ${got.rows.length} 筆）`);
    more.addEventListener("click", () => { AV.txShow += 300; paintAccounts(); });
    root.appendChild(more);
  }
}

/* ═══════════ 存款轉出的用途（帳戶明細與明細頁共用） ═══════════ */
/** 一筆轉出的用途標籤：{ text, pending }；沒有用途也不是待分類回 null。
 *  auto＝自動判成帳戶互轉的流水（transferMap）：跟分析頁同一個判定，兩邊的「待分用途」筆數才對得起來 */
function useTag(a, acc, auto = new Map()){
  if (a.exclude_state === "exclude") return null;
  const use = E.acctUseOf(a, acc, S.members, S.filterRules);
  if (use != null) return { text: E.useLabel(use, S.labels, E.acctFixedInfo(a, acc, S.members, use, S).bucket), pending: false };
  return acc.spend_account && !E.isCardFeeText(a) && !auto.has(a.id) ? { text: "待分用途", pending: true } : null;
}
/** 家用帳戶才需要：抓同期間「全部帳戶」的流水，找出哪些轉出其實是轉到自家另一個帳戶（頭尾各多抓 3 天，互轉最多差 2 天） */
async function transferMap(rows, acc){
  const dates = rows.filter(t => Number(t.amount) < 0).map(t => t.occurred_at).sort();
  if (acc.spend_account !== true || !dates.length) return new Map();
  const all = await Store.acctTxnsRange(E.addDays(dates[0], -3), E.addDays(dates[dates.length - 1], 4));
  return E.autoExclusions([], all, S.accounts, S.members)[1];
}
/** 家用帳戶開關：打開後，這個帳戶沒分用途的轉出會被列為待分類（分析頁會提醒） */
function spendToggle(root, acc){
  const [box, chk] = checkbox("家用帳戶：轉出要分用途", acc.spend_account === true);
  chk.addEventListener("change", async () => {
    chk.disabled = true;
    if (await guarded(() => Store.setSpendAccount(acc.id, chk.checked))) refreshData();
    else { chk.checked = !chk.checked; chk.disabled = false; }
  });
  add(root, box, el("p", "note", "例：配偶轉來的家用錢，之後再轉出去繳學費、孝親、日常花費，要一筆一筆分成固定支出或消費支出。"));
}
/** 這筆轉出的用途：選分類／不計／跟隨規則；可順手記成規則（同帳戶、同摘要、同金額以後都這樣算）。
 *  也可勾這筆是「固定支出」還是「消費支出」（預設只有貸款、保險、學費、孝親算固定），
 *  並選擇讓之前與往後相同（同帳戶＋同摘要＋同金額）的轉出也比照，存成不限日期的 fix: 規則。 */
function purposeDialog(a, acc){
  const f = formDialog("這筆轉出的用途");
  const followed = E.acctUseOf({ ...a, purpose: null }, acc, S.members, S.filterRules);
  const opts = [[`跟隨規則（目前：${followed == null ? "不計" : E.useLabel(followed, S.labels)}）`, ""], ["不計（轉帳）", "skip"],
    // 不給選 📈 投資：買股票由證券對帳單記成投資，存款轉去證券戶再算一次會重複（請選「不計」）
    ...E.categoryOptions(S.labels).filter(([k]) => k !== E.INVEST_CAT).map(([k, label]) => [label, k])];
  if (a.purpose && !opts.some(o => o[1] === a.purpose)) opts.push([E.labelOf(a.purpose, S.labels), a.purpose]);   // 分類已被刪掉也別悄悄改掉
  const pick = select(opts, a.purpose || "");
  const [remember, rememberChk] = checkbox("以後這個帳戶、同摘要、同金額的轉出都這樣算", false);
  // 沒摘要時規則只剩「帳戶＋金額」，會誤抓同額的其他轉出 → 不給記成規則
  const canRemember = E.normalizeMerchant(a.description) !== "";

  // ── 支出性質（固定支出／消費支出）：選「不計」時整區隱藏 ──
  const useNow = () => (pick.value === "skip" ? null : pick.value || followed);   // 算成哪一類；null＝不計
  const natOf = () => E.acctFixedInfo(a, acc, S.members, useNow(), S);
  const [fixedBox, fixedChk] = checkbox("這筆是固定支出（沒勾＝消費支出）", false);
  // 相同＝同帳戶＋摘要含關鍵字＋（預設）同金額；可先找找看有幾筆（sameBox，detail.js）
  const same = sameBox({ selfId: a.id, kw: a.description || "", amount: a.amount, acc });
  const basis = el("p", "note"), natSec = el("div", "dsec");
  add(natSec, el("b", null, "支出性質"), basis, fixedBox, same.box);
  let baseline = false, touched = false;
  const BASIS = { record: "目前依據：這筆手動設定", rule: "目前依據：規則", default: "目前依據：預設（只有貸款、保險、學費、孝親算固定）" };
  const refresh = () => {
    const use = useNow();
    natSec.hidden = use == null;
    if (use == null) return;
    const info = natOf();
    baseline = info.fixed;
    if (!touched) fixedChk.checked = baseline;
    basis.textContent = BASIS[info.by] + (info.by === "rule" && info.rule ? `（${E.filterRuleSummary(info.rule, S.labels)}）` : "");
  };
  const check = f.check = () => { rememberChk.disabled = !pick.value || !canRemember; if (rememberChk.disabled) rememberChk.checked = false; refresh(); };
  pick.addEventListener("change", check);
  fixedChk.addEventListener("change", () => { touched = true; refresh(); });
  add(f.body, el("b", null, a.description || "（無摘要）"), el("p", "muted", `${a.occurred_at} · ${E.ntD(Math.abs(a.amount))} · ${E.accountDisplay(acc, S.members)}`),
      E.bankNoteText(a.note, 200) ? el("p", "note", "📝 銀行備註：" + E.bankNoteText(a.note, 200)) : null,
    field("這筆算成", pick), remember, natSec,
    el("p", "note", "「不計」＝不算消費（例如繳卡費、自己帳戶間搬錢、轉去證券戶買股——股票由證券對帳單記成投資）；" +
      "選分類＝算成那一類的支出。"));
  check();
  f.save.addEventListener("click", async () => {
    const v = pick.value || null;
    // 只有「有算成支出」且勾的和目前判定不同才寫 fixed（不傳＝不動，沒跑 v96 也存得了用途）
    const counted = v !== "skip" && useNow() != null;
    const fixedChanged = counted && fixedChk.checked !== baseline;
    const ok = await f.submit(async () => {
      const fixRow = counted && same.on() ? same.rule(fixedChk.checked) : null;   // 條件不完整先擋（還沒寫任何東西）
      await Store.setPurpose(a.id, v, fixedChanged ? fixedChk.checked : undefined);
      const rules = [];
      if (v && rememberChk.checked) rules.push(E.useRuleRow(a, acc, v));
      if (fixRow) rules.push(fixRow);
      for (const row of rules) await Store.addFilterRule(row).catch(e => {
        refreshData();   // 用途已存：畫面先跟上，再報規則失敗
        throw new Error(`這筆已設好，但規則沒存到（${plainError(e)}）`);
      });
    });
    if (ok){ f.d.close(); refreshData(); }
  });
}

/* ═══════════ 寫入：更新餘額、改名、新增帳戶 ═══════════ */
const numText = v => (v == null ? "" : String(Number(v)));

/** ＄ 更新餘額：以今天記一筆（同日會覆蓋）。今天已記過且值不同 → 第一次只警告，再按一次才寫（App v48） */
function balanceDialog(acc, s){
  const isStock = acc.type === "stock";
  const f = formDialog("更新餘額");
  const bal = el("input"), cost = el("input");
  bal.inputMode = cost.inputMode = "decimal";
  bal.value = s ? numText(s.balance) : "";
  cost.value = s && s.cost != null ? numText(s.cost) : "";
  add(f.body, field("目前餘額（負數＝負債）", bal), isStock ? field("投資成本（算損益）", cost) : null,
    el("p", "note", "以今天日期記一筆餘額（同日會覆蓋）。" + (isStock ? "成本留白＝沿用上次的成本。" : "")));
  let armed = false;
  bal.addEventListener("input", () => { armed = false; f.err.textContent = ""; });
  f.save.addEventListener("click", async () => {
    const b = E.parseBalance(bal.value), today = E.todayIso();
    if (b == null){ f.err.textContent = "請填餘額（數字；負數＝負債）"; return; }
    // 股票：成本留白＝沿用上次（§6-17：App 會把成本洗成 null，損益從此消失）
    const c = !isStock ? null : cost.value.trim() ? E.parseBalance(cost.value) : s ? s.cost : null;
    if (isStock && cost.value.trim() && (c == null || c < 0)){ f.err.textContent = "成本只能填 0 以上的數字"; return; }
    if (s && s.snapshot_date === today && b !== s.balance && !armed){
      armed = true;
      f.err.textContent = `⚠️ 今天已記過餘額 ${E.ntD(s.balance)}，確定改成 ${E.ntD(b)} 請再按一次「儲存」`;
      return;
    }
    if (await f.submit(() => Store.setSnapshot(acc.id, b, c, today))){ f.d.close(); refreshData(); }
  });
}

/** ✎ 改名：只改 display_name；留空＝恢復原名（存 null） */
function renameDialog(acc){
  const f = formDialog("帳戶改名");
  const name = el("input");
  // 只預填「自己取過的」名字；沒取過就留空、用灰字提示目前顯示的名字——
  // 不然原封不動按儲存，會把自動補上的「(暱稱)」寫死成名字，之後改暱稱也不會跟著變
  name.value = acc.display_name || "";
  name.placeholder = E.accountDisplay(acc, S.members);
  add(f.body, field("顯示名稱", name), el("p", "note", "只改顯示名稱，不影響對帳單匯入與依人歸屬。留空＝恢復原名。"),
    el("p", "muted", `原名：${acc.name}`));
  f.save.addEventListener("click", async () => {
    if (await f.submit(() => Store.renameAccount(acc.id, name.value.trim() || null))){ f.d.close(); refreshData(); }
  });
}

/** ➕ 手動新增帳戶：餘額留白也會出現在列表（沒快照的帳戶照樣列出，§6-4） */
function addAccountDialog(){
  const f = formDialog("手動新增帳戶", "新增");
  const name = el("input"), type = el("select"), owner = el("select"), bal = el("input"), cost = el("input");
  name.placeholder = "如 某某證券·台積電 或 現金";
  for (const [label, v] of [["存款", "bank"], ["證券", "stock"], ["信用卡", "credit_card"], ["現金", "cash"], ["其他", "other"]]){
    const o = el("option", null, label); o.value = v; type.appendChild(o);
  }
  for (const [label, v] of [["（未指定）", ""], ...S.members.map(m => [E.nickOf(m), m.id])]){
    const o = el("option", null, label); o.value = v; owner.appendChild(o);
  }
  bal.inputMode = cost.inputMode = "decimal";
  const costFld = field("投資成本（算損益，可留空）", cost);
  const check = f.check = () => { costFld.hidden = type.value !== "stock"; f.save.disabled = f.sending || !name.value.trim(); };
  name.addEventListener("input", check);
  type.addEventListener("change", check);
  add(f.body, field("帳戶名", name), field("類型", type), field("歸屬成員", owner),
    field("目前餘額（負數＝負債，可留空）", bal), costFld);
  // 帳戶建好但餘額沒存到時，再按一次只補存餘額，不會再多建一個帳戶
  let created = null;
  f.d.addEventListener("close", () => { if (created) refreshData(); });
  f.save.addEventListener("click", async () => {
    const b = bal.value.trim() ? E.parseBalance(bal.value) : null;
    const c = type.value === "stock" && cost.value.trim() ? E.parseBalance(cost.value) : null;
    if (bal.value.trim() && b == null){ f.err.textContent = "餘額只能填數字（負數＝負債），或留空"; return; }
    if (cost.value.trim() && type.value === "stock" && (c == null || c < 0)){ f.err.textContent = "成本只能填 0 以上的數字，或留空"; return; }
    const ok = await f.submit(async () => {
      if (!created) created = await Store.addAccount(name.value.trim(), type.value, owner.value || null);
      if (b != null) await Store.setSnapshot(created.id, b, c, E.todayIso()).catch(e => {
        throw new Error(`帳戶已建立，但餘額沒存到（${plainError(e)}）；再按一次「新增」只會補存餘額`);
      });
    });
    if (ok) f.d.close();   // close 事件負責重抓
  });
  check();
}

/* ═══════════ 圖表（Chart.js 沒載到就退回文字，同分析頁） ═══════════ */
function chartBox(root, label, draw){
  const cv = el("canvas");
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", label);
  root.appendChild(add(el("div", "cwrap"), cv));
  requestAnimationFrame(() => { if (window.Chart && cv.isConnected) draw(cv); });
}
const row2 = (label, value) => add(el("div", "row"), el("span", null, label), el("span", null, value));
/** 折線（需兩個以上基準日）；沒有 Chart.js 時列出最近幾個點 */
function trendChart(root, trend, label){
  if (trend.length < 2){ root.appendChild(el("p", "muted", "資料點不足（需兩個以上基準日）")); return; }
  if (!window.Chart){
    root.appendChild(el("p", "warn", "圖表程式庫沒載入（可能網路不穩），改列最近幾個基準日："));
    for (const [d, v] of trend.slice(-6).reverse()) root.appendChild(row2(d, E.ntD(v)));
    return;
  }
  chartBox(root, label + `（${trend[0][0]} ${E.ntD(trend[0][1])} → ${trend[trend.length - 1][0]} ${E.ntD(trend[trend.length - 1][1])}）`, cv => {
    const sub = css("--sub");
    charts.push(new Chart(cv, { type: "line",
      data: { labels: trend.map(x => x[0].slice(2)), datasets: [{ data: trend.map(x => x[1]), borderColor: CHART_LINE,
              backgroundColor: CHART_LINE + "33", fill: true, pointRadius: trend.length > 30 ? 0 : 2, tension: .25 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => E.ntD(c.raw) } } },
                 scales: { x: { ticks: { color: sub, maxTicksLimit: 6 } },
                           y: { ticks: { color: sub, callback: v => E.compactNt(v) } } } } }));
  });
}
function donut(cv, alloc, total){
  charts.push(new Chart(cv, { type: "doughnut",
    data: { labels: alloc.map(([g, v]) => `${g} ${Math.round(v * 100 / total)}%`),
            datasets: [{ data: alloc.map(x => x[1]), backgroundColor: alloc.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]), borderWidth: 0 }] },
    options: { plugins: { legend: { position: "bottom", labels: { color: css("--ink"), boxWidth: 12 } },
                          tooltip: { callbacks: { label: c => `${c.label} ${E.ntD(c.raw)}` } } } } }));
}
