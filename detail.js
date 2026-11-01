// ═══════════════════════════════════════════════════════════════════════
//  家計簿「🧾 明細」分頁＋「編輯這筆」＋「＋ 記一筆」（2026-11-01 第三階段）
//
//  對照 App：MainActivity.kt DetailScreen（:560-1406）與 QuickEntry（:331-443）。
//  數字一律由 engine.js 的 detailView 一次算好，這裡只負責畫與寫入。
//  與 index.html 共用全域（S、E、Store、sel、hid、uid、el/add/nt、dialog/formDialog/field/busy/toast、
//  refreshData、setTab、addDays…）；一般 <script defer>，在 index.html 內嵌程式之後執行。
//  XSS：同 index.html，資料庫字串一律 textContent，全檔不用 innerHTML。
// ═══════════════════════════════════════════════════════════════════════
"use strict";

/** 明細頁的畫面狀態：換期間、重抓都保留（同 App） */
const DV = {
  view: "expense",       // expense／income／bank／excluded
  flat: false,           // 支出：依分類（false）或依日期（true）
  open: new Set(),       // 展開的分組
  q: "", found: null, searchErr: "", seq: 0, timer: 0,   // 跨月搜尋
  aged: null, agedStale: true,   // 超過 45 天沒對到帳單的刷卡通知（全家、不隨期間）；重抓時先留著舊的，新的到了再換
  v: null, d: null,      // 目前畫面用的 detailView 結果與期間資料
  top: null, search: null, exportBtn: null, body: null   // 固定的版面節點（搜尋框不重建，打字才不會掉焦點）
};
/** 一筆交易的顯示名：商家，沒有就備註，再沒有就 none */
const title = (t, none = "（無備註）") => t.merchant || t.note || none;
const ownerName = t => { const m = S.members.find(m => m.id === E.txOwnerId(t, S.members)); return m ? E.nickOf(m) : ""; };

/** refreshData 時呼叫：逾期通知下次畫面時重抓 */
function detailStale(){ DV.agedStale = true; }
/** 寫入成功後：重抓資料；正在搜尋就連結果一起更新（不然改完的那筆在結果裡還是舊的） */
function saved(){
  if (DV.q.trim()) runSearch();
  return refreshData();
}

/* ═══════════ 版面 ═══════════ */
function paintDetail(d, p){
  if (!DV.top) buildDetailFrame();
  DV.d = d;
  DV.v = E.detailView({ ...S, ...d }, p, sel);
  DV.exportBtn.disabled = !DV.v.txs.length;
  paintAlerts();
  drawBody();
}
/** 只建一次的骨架：提醒列／搜尋列／內容。之後只換提醒與內容，搜尋框留在原地 */
function buildDetailFrame(){
  const root = $("detailView");
  DV.top = el("div");
  DV.search = el("input");
  DV.search.type = "search";
  DV.search.placeholder = "🔍 搜尋（跨月、全家）";
  DV.search.setAttribute("aria-label", "搜尋商家或備註（跨月、全家）");
  DV.search.addEventListener("input", () => { DV.q = DV.search.value; runSearch(); });
  DV.exportBtn = el("button", null, "⬇ 匯出");
  DV.exportBtn.title = "把本期（目前成員）的明細存成 CSV";
  DV.exportBtn.addEventListener("click", exportCsv);
  DV.body = el("div");
  add(root, DV.top, add(el("div", "searchrow"), DV.search, DV.exportBtn), DV.body);
}

/** 提醒列：超支（整月才比）、帳單到期、待確認收入（點 → 已排除） */
function paintAlerts(){
  const { over, due, income } = DV.v;
  DV.top.replaceChildren();
  if (!over.length && !due.length && !income.pendingN) return;
  const box = el("div", "alert");
  box.setAttribute("role", "note");
  for (const o of over) box.appendChild(el("div", null, `⚠️ ${o.label} 超支：已花 ${nt(o.spent)} / 預算 ${nt(o.budget)}`));
  for (const x of due) box.appendChild(el("div", null, `💳 ${x.name} ${x.days === 0 ? "今天" : `${x.days} 天後`}到期（每月 ${x.day} 日）`));
  if (income.pendingN){
    const b = el("button", null, `💰 ${income.pendingN} 筆待確認收入（${nt(income.pendingAmt)}）：自家轉入放超過 45 天仍找不到對應轉出，` +
      "可能是漏記的收入 → 點這裡到「已排除」逐筆確認、真收入按「納入」。");
    b.addEventListener("click", () => { DV.view = "excluded"; drawBody(); });
    box.appendChild(b);
  }
  DV.top.appendChild(box);
}

/** 內容區：搜尋中就只顯示搜尋結果（同 App），否則四個檢視之一 */
function drawBody(){
  const b = DV.body, v = DV.v;
  b.replaceChildren();
  if (DV.q.trim()) return drawSearch(b);
  if (v.empty){
    const who = S.members.find(m => m.id === sel);
    b.appendChild(add(el("div", "card"), el("p", "muted", `${who ? E.nickOf(who) + " " : ""}本期尚無資料`)));
    return;
  }
  const chips = el("div", "chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "檢視");
  for (const [k, label] of [["expense", `支出 ${E.compactNt(v.te)}`], ["income", `收入 ${E.compactNt(v.income.total)}`],
                            ["bank", `存款 ${v.bank.rows.length}`], ["excluded", `已排除 ${v.excluded.count}`]]){
    const c = el("button", "chip" + (DV.view === k ? " active" : ""), label);
    c.setAttribute("aria-pressed", String(DV.view === k));
    c.addEventListener("click", () => { DV.view = k; drawBody(); });
    chips.appendChild(c);
  }
  b.appendChild(chips);
  agedChip(b);
  ({ expense: drawExpense, income: drawIncome, bank: drawBank, excluded: drawExcluded })[DV.view](b, v);
}

/** 「🔎 N 筆刷卡通知超過 45 天還沒對到帳單」：全家、不隨期間（同 App）；第一次畫才抓 */
function agedChip(b){
  if (DV.agedStale){
    DV.agedStale = false;   // 抓的期間不重複發請求；畫面先用舊的（不然每次存檔後提示都會閃一下）
    Store.aged(addDays(E.todayIso(), -45))
      .then(r => { DV.aged = r; if (tab === "detail" && !DV.q.trim()) drawBody(); },
            e => { console.warn("逾期通知讀取失敗", e); });   // 只是提示，讀不到就不顯示（同 App）
  }
  if (!DV.aged || !DV.aged.length) return;
  const sum = DV.aged.reduce((a, t) => a + t.amount, 0);
  const c = el("button", "info", `🔎 有 ${DV.aged.length} 筆刷卡通知超過 45 天還沒對到帳單（${E.compactNt(sum)}）——可能帳單漏收或漏抓，點看`);
  c.addEventListener("click", agedDialog);
  b.appendChild(c);
}
function agedDialog(){
  const { body, close } = dialog("超過 45 天沒對到帳單的刷卡通知");
  close.textContent = "知道了";
  add(body, el("p", "note", "下面這些是「收到刷卡通知、但過了 45 天帳單還是沒對上」的消費。它們已經算進你的統計（是真的花費）；" +
    "列出來只是提醒你確認：是不是有哪家的帳單沒設定收信來源、或那個月的帳單漏抓了。"));
  for (const t of DV.aged)
    body.appendChild(add(el("div", "li"), add(el("div", "main"),
      add(el("span", "m"), el("span", null, t.merchant || "（暫無商店資訊）"), el("small", null, `${t.occurred_at} · ${E.statSource(t)}`)),
      el("b", "a", nt(t.amount)))));
  add(body, el("p", "note", "要補帳單來源：到手機 App「我的 → 進階設定 → 帳單來源」新增；下次同步就會回頭對帳。"));
}

/* ═══════════ 四個檢視 ═══════════ */
/** 可展開的分組標題列（依分類／收入分類共用）；key 以檢視區分，避免支出與收入同名分類一起開合 */
function groupHead(key, label, g, amountCls){
  const open = DV.open.has(key);
  const h = el("button", "ghead");
  h.setAttribute("aria-expanded", String(open));
  add(h, el("span", "m", `${open ? "▾" : "▸"} ${label}（${g.rows.length} 筆${g.off ? `，${g.off} 未計` : ""}）` +
                          (g.suspect ? `  ⚠️${g.suspect}` : "")),
      el("span", "a " + (amountCls || ""), nt(g.total)));
  h.addEventListener("click", () => { open ? DV.open.delete(key) : DV.open.add(key); drawBody(); });
  return h;
}

function drawExpense(b, v){
  if (!v.expRows.length){ b.appendChild(el("p", "muted", "本期無支出紀錄（可切「收入」看進帳）")); return; }
  if (v.provisional > 0)
    b.appendChild(el("p", "note", `其中 ${E.compactNt(v.provisional)} 尚未對帳（來自刷卡通知），帳單到會自動校正金額`));
  const toAnalysis = el("button", "link", "看佔比圖表與趨勢 → 「📊 分析」");
  toAnalysis.addEventListener("click", () => setTab("analysis"));
  add(b, el("p", "note", `支出 ${nt(v.te)} · 共 ${v.expRows.length} 筆 · 點分類展開、點單筆改分類/編輯/不納入`), toAnalysis);
  const mode = el("div", "chips");
  for (const [flat, label] of [[false, "依分類"], [true, "依日期"]]){
    const c = el("button", "chip" + (DV.flat === flat ? " active" : ""), label);
    c.setAttribute("aria-pressed", String(DV.flat === flat));
    c.addEventListener("click", () => { DV.flat = flat; drawBody(); });
    mode.appendChild(c);
  }
  b.appendChild(mode);
  if (DV.flat){ for (const r of v.expRows) b.appendChild(expenseRow(r)); return; }
  for (const g of v.groups){
    const key = "exp:" + g.key;
    b.appendChild(groupHead(key, E.labelOf(g.key, S.labels), g));
    if (DV.open.has(key)) for (const r of g.rows) b.appendChild(expenseRow(r));
  }
}

/** 支出單列（App ExpenseTxRow）：未計灰字刪除線＋白話原因；疑似重複可就地確認 */
function expenseRow(r){
  const { t, ex, why, suspect } = r;
  const box = el("div", "li" + (ex ? " off" : ""));
  const main = el("button", "main");
  add(main, add(el("span", "m"), el("span", null, (suspect ? "⚠️ " : "") + title(t)),
                el("small", null, `${t.occurred_at} · ${E.statSource(t)}` + (ex && why ? ` · ${E.friendlyReason(why)}（未計）` : ""))),
      el("span", "a" + (ex || suspect ? " dim" : t.kind === "expense" ? " expense" : " income"), (t.kind === "expense" ? "−" : "＋") + nt(t.amount)));
  main.addEventListener("click", () => editTx(t, r));
  box.appendChild(main);
  if (suspect){
    const yes = el("button", "link ok", "真的有這筆 ✓"), no = el("button", "link danger", "是重複的 ✕"), err = el("span", "warn");
    yes.addEventListener("click", async () => { if (await busy([yes, no], err, () => Store.setDedup(t.id, "unique"))) saved(); });
    no.addEventListener("click", () => confirmDuplicate(t));
    box.appendChild(add(el("div", "dup"), el("span", null, "疑似重複："), yes, no, err));
  }
  return box;
}
/** 「是重複的」先確認再剔除（App v49：按鈕常駐在清單上，滑動時容易誤觸） */
function confirmDuplicate(t){
  const f = formDialog("這筆是重複的？", "是重複的，不要算");
  f.save.classList.add("danger");
  add(f.body, el("p", null, `「${t.merchant || t.note}」${nt(t.amount)}（${t.occurred_at}）`),
    el("p", "muted", "確認後這筆不再計入支出（重複的兩筆只算一筆）。"));
  f.save.addEventListener("click", async () => {
    if (await f.submit(() => Store.setDedup(t.id, "merged"))){ f.d.close(); saved(); }
  });
}

function drawIncome(b, v){
  const inc = v.income;
  if (!inc.rows.length){ b.appendChild(el("p", "muted", "本期無收入紀錄（薪資/利息/配息/賣出/退款/轉入等）")); return; }
  b.appendChild(el("p", "note", `收入 ${nt(inc.total)} · 共 ${inc.rows.length} 筆 · 點分類展開、點單筆可設不納入`));
  for (const g of inc.groups){
    const key = "inc:" + g.key;
    b.appendChild(groupHead(key, g.key, g, "income"));
    if (!DV.open.has(key)) continue;
    for (const r of g.rows){
      const { i, ex, why } = r;
      const row = el("button", "main");
      add(row, add(el("span", "m"), el("span", null, i.desc),
                   el("small", null, `${i.date} · ${i.source}` + (ex && why ? ` · ${E.friendlyReason(why)}（未計）` : ""))),
          el("span", "a" + (ex ? " dim" : " income"), nt(i.amount)));
      row.addEventListener("click", () => {
        // 交易表的收入 → 完整編輯（狀態沿用這一列的收入判定）；存款存入 → 只能設納入／不納入
        const t = i.kind === "tx" ? DV.d.txsAll.find(t => t.id === i.id) : null;
        if (t) editTx(t, r);
        else excludeDialog({ kind: "acct", id: i.id, state: i.exclude_state, pattern: i.desc, excluded: ex, label: i.desc, blocked: ruleBlocked(r.rule) });
      });
      b.appendChild(add(el("div", "li" + (ex ? " off" : "")), row));
    }
  }
}

function drawBank(b, v){
  const bank = v.bank;
  if (!bank.rows.length){ b.appendChild(el("p", "muted", "本期無存款帳戶交易（永豐綜合對帳單／玉山每日帳務）")); return; }
  b.appendChild(el("p", "note", `存入 ${nt(bank.inSum)}｜轉出/扣款 ${nt(bank.outSum)}　共 ${bank.rows.length} 筆` +
    "（灰字＝不計入收支，多為帳戶互轉、卡費扣繳、股票款）"));
  for (const { a, ex, why, account, rule } of bank.rows){
    const row = el("button", "main");
    const sub = el("small");
    if (ex && why) sub.appendChild(el("span", "tag", E.friendlyReason(why)));
    sub.appendChild(document.createTextNode(`${a.occurred_at} · ${account}`));
    add(row, add(el("span", "m"), el("span", null, a.description || "（無摘要）"), sub),
        add(el("span", "a"), el("span", ex ? "dim" : a.amount < 0 ? "expense" : "income", (a.amount < 0 ? "−" : "＋") + nt(Math.abs(a.amount))),
            a.balance != null ? el("small", null, "餘 " + Math.round(a.balance).toLocaleString("en-US")) : null));
    row.addEventListener("click", () => excludeDialog({ kind: "acct", id: a.id, state: a.exclude_state, pattern: a.description,
                                                        excluded: ex, label: a.description || "（無摘要）", blocked: ruleBlocked(rule) }));
    b.appendChild(add(el("div", "li" + (ex ? " off" : "")), row));
  }
}

function drawExcluded(b, v){
  const x = v.excluded;
  b.appendChild(el("p", "note", "不計入收支的：投資買入/轉帳、帳戶互轉/家人互轉/自家轉入/信用卡退款/跨表重複/篩選器、或你手動排除的。點「納入」可改回。" +
    (x.invTotal > 0 ? `　本期投資投入 ${nt(x.invTotal)}` : "")));
  if (!x.count){ b.appendChild(el("p", "muted", "本期沒有不計入收支的項目。")); return; }
  // 投資／轉帳：要改成計入就得改「類型」，所以按鈕開的是完整編輯（App 寫「納入」，其實開的是編輯，§6-18）
  for (const { t, tag } of x.other)
    b.appendChild(excludedRow(title(t, tag), `${t.occurred_at} · ${E.statSource(t)}`, -t.amount, tag, "編輯", () => editTx(t)));
  for (const { t, why, rule } of x.exp){
    const label = title(t, "支出");
    b.appendChild(excludedRow(label, `${t.occurred_at} · ${E.statSource(t)}`, -t.amount, why, "納入",
      () => excludeDialog({ kind: "tx", id: t.id, state: t.exclude_state, pattern: title(t, ""), excluded: true, label,
                            blocked: ruleBlocked(rule, t) })));
  }
  for (const { i, why, rule } of x.inc)
    b.appendChild(excludedRow(i.desc, `${i.date} · ${i.source}`, i.amount, why, "納入",
      () => excludeDialog({ kind: i.kind, id: i.id, state: i.exclude_state, pattern: i.desc, excluded: true, label: i.desc, blocked: ruleBlocked(rule) })));
}
/** 已排除單列（App ExcludedRow）：原因徽章（待確認收入醒目標示）＋帶號金額＋右側按鈕 */
function excludedRow(desc, sub, amount, reason, act, onAct){
  const s = el("small");
  if (reason) s.appendChild(el("span", "tag" + (reason.includes("待確認") ? " warn" : ""), E.friendlyReason(reason)));
  s.appendChild(document.createTextNode(sub));
  const btn = el("button", "link", act);
  btn.addEventListener("click", onAct);
  return add(el("div", "li off"), add(el("div", "main"), add(el("span", "m"), el("span", null, desc), s),
    el("span", "a", (amount < 0 ? "−" : "") + nt(Math.abs(amount))), btn));
}

/* ═══════════ 搜尋（跨月、全家，同 App）與匯出 ═══════════ */
function runSearch(){
  clearTimeout(DV.timer);
  const my = ++DV.seq, q = DV.q.trim();   // 序號：晚回來的舊搜尋不能蓋掉新的
  DV.found = null; DV.searchErr = "";
  drawBody();
  if (!q) return;
  DV.timer = setTimeout(async () => {
    try {
      const r = await Store.search(q);   // 特殊字元在 Store.search 裡處理（PostgREST 語法字元）
      if (my === DV.seq){ DV.found = r.filter(t => t.dedup_status !== "aux"); drawBody(); }
    } catch (e){
      if (my === DV.seq){ DV.searchErr = "搜尋失敗：" + plainError(e); drawBody(); }
    }
  }, 350);
}
function drawSearch(b){
  const q = DV.q.trim();
  if (DV.searchErr){ b.appendChild(el("p", "warn", DV.searchErr)); return; }
  if (!DV.found){ b.appendChild(el("p", "muted", "搜尋中…")); return; }
  if (!DV.found.length){ b.appendChild(el("p", "muted", `找不到符合「${q}」的交易`)); return; }
  b.appendChild(el("p", "note", `找到 ${DV.found.length} 筆（最多 300）· 點單筆可編輯、改分類`));
  for (const t of DV.found){
    const owner = ownerName(t);
    const row = el("button", "main");
    add(row, add(el("span", "m"), el("span", null, title(t)),
                 el("small", null, `${t.occurred_at} · ${E.labelOf(E.classifyF(t, S.catRules, S.filterRules, S.cats), S.labels)}` +
                                   (owner ? ` · ${owner}` : "") + (t.dedup_status === "suspect" ? " · ⚠️疑似重複" : ""))),
        el("span", "a " + (t.kind === "expense" ? "expense" : t.kind === "income" ? "income" : "dim"), nt(t.amount)));
    row.addEventListener("click", () => editTx(t));
    b.appendChild(add(el("div", "li"), row));
  }
}
/** 匯出本期（目前成員）的列成 CSV：含疑似重複（狀態欄註明），分類欄與畫面一致（classifyF） */
function exportCsv(){
  const v = DV.v;
  const csv = E.monthCsv(v.txs, S, t => { const [ex, why] = v.txExc(t); return ex ? E.friendlyReason(why) : ""; });
  const name = `moneybook_${E.Period.fileTag(lastPeriod)}.csv`, blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  // iPhone 加到主畫面的 App 模式裡 <a download> 常常沒反應：那裡改叫系統分享（可存到檔案、傳 LINE…）
  const file = typeof File === "function" ? new File([blob], name, { type: blob.type }) : null;
  if (navigator.standalone && file && navigator.canShare && navigator.canShare({ files: [file] })){
    navigator.share({ files: [file], title: name }).catch(e => { if (e.name !== "AbortError") console.warn("分享失敗", e); });
    return;
  }
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/* ═══════════ 編輯這筆（App editingTx） ═══════════ */
/** st＝呼叫端那一列的判定 { ex, why, rule }（收入列用收入的規則判定，跟清單上看到的一致）。
 *  沒給（搜尋結果）就用本期的判定；不在本期的那筆，自動偵測（互轉、退款）要看那個月才算得出來。 */
function editTx(t, st){
  const p = lastPeriod, inPeriod = p && t.occurred_at >= E.Period.startDate(p) && t.occurred_at < E.Period.endExclusive(p);
  const [exNow] = st ? [st.ex] : DV.v.txExc(t);
  const rule = st ? st.rule : E.txExclusionFilter(t, S.filterRules);
  const { d, body } = dialog("編輯這筆");
  add(body, el("b", null, title(t)),
    el("p", "muted", `${t.occurred_at} · ${E.kindLabel(t.kind)} ${nt(t.amount)}` + (exNow ? " · 目前不計收支" : "")),
    st || inPeriod ? null : el("p", "note", "這筆不在目前期間：互轉、退款這類自動判定，以那個月的明細為準。"));
  const edit = el("button", "primary", "✏️ 編輯名稱/金額/日期/類型");
  const exc = el("button", null, exNow ? "↩︎ 納入收支" : "🚫 不納入收支");
  const del = el("button", "danger", "🗑 刪除");
  edit.addEventListener("click", () => { d.close(); editFields(t); });
  exc.addEventListener("click", () => {
    d.close();
    excludeDialog({ kind: "tx", id: t.id, state: t.exclude_state, pattern: title(t, ""), excluded: exNow, label: title(t, "這筆"),
                    blocked: ruleBlocked(rule, t) });
  });
  del.addEventListener("click", () => { d.close(); deleteDialog(t); });
  add(body, edit, add(el("div", "rowx"), exc, del));
  if (t.kind === "expense"){ body.appendChild(tripSection(t)); body.appendChild(categorySection(t, d)); }
}

/** ✈️ 行程歸屬（App v78）：只影響「這趟花多少」，與「不納入收支」是兩回事。有行程才出現。 */
function tripSection(t){
  const sec = el("details", "dsec");
  sec.hidden = true;
  const sum = el("summary", null, "✈️ 行程歸屬"), hint = el("small"), list = el("div"), err = el("p", "warn");
  add(sec, add(sum, hint), list, err);
  let trips = [], ov = new Map();
  const draw = () => {
    const inN = trips.filter(tp => E.inTrip(t, tp, ov.get(tp.id))).length;
    hint.textContent = inN ? `目前算在 ${inN} 趟行程裡；點開可加入或移出` : "點開可把這筆加進某趟行程（只影響旅遊統計）";
    list.replaceChildren();
    for (const tp of E.tripsByRelevance(t, trips, ov)){
      const o = ov.get(tp.id), isIn = E.inTrip(t, tp, o);
      const b = el("button", "pick", `${isIn ? "☑" : "☐"} ${tp.name}（${tp.start_date}~${tp.end_date}）`);
      b.setAttribute("aria-pressed", String(isIn));
      b.addEventListener("click", async () => {
        const a = E.tripTxAction(tp, t.occurred_at, !isIn);
        const ok = await busy([...list.querySelectorAll("button")], err,
          () => (a == null ? Store.clearTripTx(tp.id, t.id) : Store.setTripTx(tp.id, t.id, a)));
        if (!ok) return;
        if (a == null) o.delete(t.id); else o.set(t.id, a);
        draw(); reloadTrips();   // 分析頁的旅遊區塊跟著更新
      });
      list.appendChild(b);
      // 點一下就回到日期預設（App 寫「點兩下」，其實一下就回去了，§6-21）
      if (o.has(t.id)) list.appendChild(el("p", "note", "　↳ 手動調整過；再點一下可回到依日期自動判定"));
    }
  };
  (async () => {
    trips = await Store.trips();
    ov = new Map(trips.map(tp => [tp.id, new Map()]));
    for (const r of await Store.tripTx(trips.map(tp => tp.id))) ov.get(r.trip_id)?.set(r.transaction_id, r.action);
    if (trips.length){ sec.hidden = false; draw(); }
  })().catch(e => { sec.hidden = false; hint.textContent = "讀取行程失敗：" + plainError(e); });
  return sec;
}

/** 分類（§6-1、6-3）：「目前」用 classifyF（含手記的 category_id 與篩選器）。
 *  手記改的是這一筆的 category_id；匯入的寫全家商家規則（同商家以後都歸這類）。 */
function categorySection(t, d){
  const cur = E.classifyF(t, S.catRules, S.filterRules, S.cats);
  const manual = !!t.category_id;
  const sec = el("details", "dsec"), err = el("p", "warn");
  add(sec, add(el("summary", null, "分類"), el("small", null, `目前：${E.labelOf(cur, S.labels)}；` +
    (manual ? "點開改這一筆的分類" : "點開改分類，同商家以後都歸這類（全家、所有月份）"))));
  if (!manual){
    const f = E.matchFilterRule(t.merchant, t.note, E.statSource(t), t.amount, t.kind, S.filterRules);
    if (f && String(f.action).startsWith("cat:"))
      sec.appendChild(el("p", "warn", `這筆由篩選規則「${f.name || "未命名"}」分類，商家規則不會蓋過它。`));
    if (!String(t.merchant || "").trim()){
      sec.appendChild(el("p", "note", "這筆沒有商家名，無法用商家規則；可用上面的「✏️ 編輯」補上名稱。"));
      return sec;
    }
  }
  const opts = E.categoryOptions(S.labels);
  // 目前分類不在選單裡（例如手記的舊分類）也列出來，才看得出現在是哪一類
  if (!opts.some(([k]) => k === cur)) opts.unshift([cur, E.labelOf(cur, S.labels)]);
  const picks = opts.map(([k, label]) => {
    const b = el("button", "pick", `${k === cur ? "●" : "○"} ${label}`);
    b.setAttribute("aria-pressed", String(k === cur));
    b.disabled = k === cur;
    b.addEventListener("click", async () => {
      const ok = await busy(picks, err, async () => {
        if (manual) await Store.updateTx(t.id, { category_id: await ensureCategory(k) });
        else await Store.setCategoryRule(t.merchant, k);
      });
      if (ok){ d.close(); saved(); }
      else for (const p of picks) p.disabled = p.getAttribute("aria-pressed") === "true";   // 目前那類維持不能點
    });
    return b;
  });
  add(sec, ...picks, err);
  return sec;
}
/** 分類 key（如「🛒 網購」）對應的 categories 列 id；沒有就建一列（手記才用得到） */
async function ensureCategory(key){
  const hit = E.findCategory(key, S.cats);
  if (hit) return hit.id;
  const row = await Store.addCategory(E.newCategory(key, S.cats));
  S.cats.push(row);   // 馬上找得到：重抓之前再選同一類不會重複建
  return row.id;
}

/** ✏️ 編輯明細（App editFieldsTx）：名稱、金額、日期、備註、類型 */
function editFields(t){
  const f = formDialog("編輯明細");
  const today = E.todayIso();
  const name = el("input"), amt = el("input"), date = el("input"), note = el("input");
  name.value = t.merchant || "";
  amt.inputMode = "numeric"; amt.value = String(t.amount); amt.maxLength = 9;
  date.type = "date"; date.max = today; date.value = t.occurred_at;
  note.value = t.note || "";
  let kind = t.kind;
  const kinds = el("div", "chips");
  for (const [k, label] of [["expense", "支出"], ["income", "收入"], ["invest", "投資"], ["transfer", "轉帳"]]){
    const c = el("button", "chip", label);
    c.dataset.k = k;
    c.addEventListener("click", () => { kind = k; check(); });
    kinds.appendChild(c);
  }
  const check = f.check = () => {
    amt.value = amt.value.replace(/\D/g, "").slice(0, 9);
    for (const c of kinds.children){ c.classList.toggle("active", c.dataset.k === kind); c.setAttribute("aria-pressed", String(c.dataset.k === kind)); }
    f.save.disabled = f.sending || E.parseAmount(amt.value) == null || !date.value || date.value > today;
  };
  for (const x of [amt, date]) x.addEventListener("input", check);
  if (t.source !== "manual") f.body.appendChild(el("p", "warn", "此筆來自對帳單；改內容後下次匯入可能重複。"));
  add(f.body, field("名稱/商家", name), field("金額 NT$（正整數）", amt), field("日期", date), field("備註", note),
    el("span", "muted", "類型"), kinds, el("p", "note", "投資/轉帳不計入收支（買股票是資產轉移，非消費）。"));
  f.save.addEventListener("click", async () => {
    const fields = { amount: E.parseAmount(amt.value), merchant: name.value.trim(), note: note.value, kind, occurred_at: date.value };
    if (await f.submit(() => Store.updateTx(t.id, fields))){ f.d.close(); saved(); }
  });
  check();
}

/** 「以後同 X 都…」的永久規則對這筆不會照字面生效時，說明原因（可以用就回 null）。
 *  rule＝決定這筆納不納入的篩選規則（優先序在商家排除規則前面，規則蓋不過它）；t＝交易表那一筆（有的話）。 */
function ruleBlocked(rule, t){
  if (rule) return `這筆納不納入是由篩選規則「${rule.name || "未命名"}」決定的，商家規則蓋不過它，所以這裡不提供永久規則。` +
                   "要改這一筆請用下方的「只這一筆」；要改規則本身，請到手機 App 的篩選器。";
  // 記一筆沒寫備註時，名稱就是分類名（如「網購」）：拿它當規則會套到所有名稱含這兩個字的消費
  const c = t && t.source === "manual" && t.category_id && S.cats.find(c => c.id === t.category_id);
  if (c && String(t.merchant || "").trim() === c.name)
    return `這筆是手記，名稱「${c.name}」就是分類名；當成規則會套到全家所有名稱含「${c.name}」的消費，所以這裡不提供。請用「只這一筆」。`;
  return null;
}

/** 🚫 不納入／↩︎ 納入（App excludeTarget）。
 *  { kind: tx|acct, id, state（原本的 exclude_state）, pattern, excluded, label, blocked（ruleBlocked 的說明或 null） } */
function excludeDialog({ kind, id, state, pattern, excluded, label, blocked = null }){
  const verb = excluded ? "納入" : "不納入", target = excluded ? "include" : "exclude";
  const f = formDialog(excluded ? "改回納入收支" : "不納入收支", `只這一筆${verb}`);
  const rule = el("button", "warnline", `⚠ 以後同「${label}」都${verb}（永久規則）`);
  const ruleOk = !blocked && !!String(pattern || "").trim();
  rule.disabled = !ruleOk;
  const others = ruleOk ? [rule] : [];   // 送出中一起停用；本來就不能按的別在失敗後被打開
  add(f.body, el("b", null, label),
    el("p", "muted", (excluded ? "這筆目前不計入收支。" : "") + (blocked ? ""
      : excluded ? `可只改這一筆，或以後同「${label}」都納入。` : `可只排除這一筆，或以後同「${label}」都自動不納入（會記成規則）。`)),
    rule, blocked ? el("p", "warn", blocked)
                  : el("p", "note", "永久規則套用到全家、所有月份。要刪除規則目前請到手機 App「我的 → 已學習的規則」。"));
  f.save.addEventListener("click", async () => {
    if (await f.submit(() => Store.setExclude(kind, id, target), others)){ f.d.close(); saved(); }
  });
  rule.addEventListener("click", async () => {
    // 兩個寫入依序等完再重抓一次（§6-11：App 兩個各自重抓，第一次可能抓到改一半的狀態）。
    // 這筆原本有單筆設定的話要清掉，不然單筆設定優先、規則管不到它
    const ok = await f.submit(async () => {
      await Store.setExcludeRule(pattern.trim(), target);
      if (state != null) await Store.setExclude(kind, id, null);
    }, others);
    if (ok){ f.d.close(); saved(); }
  });
}

/** 🗑 刪除（App deletingTx）：手記真刪；匯入的標剔除 */
function deleteDialog(t){
  const f = formDialog("刪除這筆？", "刪除");
  f.save.classList.add("danger");
  add(f.body, el("b", null, title(t)), el("p", null, t.source === "manual" ? "將永久刪除這筆手動記帳。"
    : "此筆來自對帳單，會標為剔除（不計入、下次匯入也不再出現）。"));
  f.save.addEventListener("click", async () => {
    if (await f.submit(() => Store.deleteTx(t))){ f.d.close(); saved(); }
  });
}

/* ═══════════ ＋ 記一筆（App QuickEntry） ═══════════ */
function quickEntry(){
  const f = formDialog("記一筆", "存");
  const today = E.todayIso();
  let kind = "expense", cat = null;
  const kinds = el("div", "chips"), amt = el("input"), note = el("input"), date = el("input"), noteLbl = el("span");
  amt.inputMode = "numeric"; amt.maxLength = 9; amt.placeholder = "0"; amt.style.fontSize = "24px";
  date.type = "date"; date.value = today; date.max = today;
  // 算誰的：預設＝登入者本人的成員，沒有就第一位（成員只有一位就不問）
  const owner = el("select");
  for (const m of S.members){ const o = el("option", null, E.nickOf(m)); o.value = m.id; owner.appendChild(o); }
  owner.value = (S.members.find(m => m.user_id != null && m.user_id === uid) || S.members[0] || {}).id || "";
  // 分類：跟改分類同一套（category_labels，§6-2），點一下選定
  const cats = el("div", "chips grid");
  for (const [k, label] of E.categoryOptions(S.labels)){
    const c = el("button", "chip", label);
    c.dataset.k = k;
    c.addEventListener("click", () => { cat = k; check(); });
    cats.appendChild(c);
  }
  const catBox = add(el("div"), el("span", "muted", "分類（點一下選定）"), cats);
  for (const [k, label] of [["expense", "支出"], ["income", "收入"]]){
    const c = el("button", "chip", label);
    c.dataset.k = k;
    c.addEventListener("click", () => { kind = k; check(); });
    kinds.appendChild(c);
  }
  const check = f.check = () => {
    amt.value = amt.value.replace(/\D/g, "").slice(0, 9);
    const mark = (box, v) => { for (const c of box.children){ c.classList.toggle("active", c.dataset.k === v); c.setAttribute("aria-pressed", String(c.dataset.k === v)); } };
    mark(kinds, kind); mark(cats, cat);
    catBox.hidden = kind !== "expense";
    noteLbl.textContent = kind === "income" ? "來源/備註（如 薪資、紅包）" : "備註（可空白）";
    f.save.textContent = kind === "income" ? "存為收入" : "存";
    f.save.disabled = f.sending || E.parseAmount(amt.value) == null || !date.value || date.value > today || (kind === "expense" && !cat);
  };
  for (const x of [amt, date]) x.addEventListener("input", check);
  add(f.body, kinds, field("金額 NT$", amt), add(el("label", "fld"), noteLbl, note), field("日期", date),
    S.members.length > 1 ? field("算誰的", owner) : null, catBox);
  f.save.addEventListener("click", async () => {
    // 按下當時的內容先定下來：寫入途中再點別的分類／類型，存的與提示的都還是按下時那一筆
    const k = kind, c = cat, amount = E.parseAmount(amt.value), memo = note.value.trim();
    const row = { household_id: hid, member_id: uid, created_by: uid, family_member_id: owner.value || null,
      kind: k, amount, note: memo, occurred_at: date.value, source: "manual", dedup_status: "unique",
      // 支出：商家＝備註，沒寫就用分類名（去掉圖示）；收入：備註或「收入」
      merchant: memo || (k === "expense" ? E.newCategory(c, []).name : "收入"), category_id: null };
    const ok = await f.submit(async () => {
      if (k === "expense") row.category_id = await ensureCategory(c);
      await Store.addTx(row);
    });
    if (!ok) return;
    f.d.close();
    toast(k === "expense" ? `✅ 已記一筆 ${nt(amount)} → ${E.labelOf(c, S.labels)}` : `✅ 已記收入 ${nt(amount)}`);
    refreshData();
  });
  check();
}
