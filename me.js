// ═══════════════════════════════════════════════════════════════════════
//  家計簿「👤 我的」分頁＋「加入家庭」畫面（2026-11-02 第四階段）
//
//  對照 App：MainActivity.kt SettingsScreen（:2468）與其各區（InviteCodeRow :2425、MembersSection :2994、
//  CategoryLabelsSection :3514、RulesSection :2534、FilterRulesSection :2770、MailAccountSection :3768、
//  BankSourcesSection :3107、IngestSettingsSection :3431、BillRemindersSection :3672、AiSettingsSection :3720），
//  以及登入後的 SetupScreen（:202，建立／加入家庭）。刻意與 App 不同的地方見 DEPLOY.md「第四階段」與各函式註解。
//  與 index.html 共用全域（S、E、Store、LiveStore、sb、hid、uid、el/add/nt、dialog/formDialog/field/busy/toast、
//  fold、plainError、affected、must、refreshData、startSync、syncing、hhmm…）；一般 <script defer>。
//  編輯一律走對話框：頁面每分鐘可能因新資料整頁重畫，寫在頁面上的半截輸入會被洗掉，對話框不會。
//  祕密（Gmail 應用程式密碼、PDF 密碼、AI 金鑰）：只寫不讀——寫進 RPC（伺服器存 Vault），畫面只說「已設定」。
//  XSS：同 index.html，資料庫字串一律 textContent，全檔不用 innerHTML。
// ═══════════════════════════════════════════════════════════════════════
"use strict";

/* ═══════════ 資料存取（LiveStore 的「我的」部分；示範版在 demo.js 的 DemoStore） ═══════════ */
// 寫在這裡而不是 index.html：這些只有本頁用，index.html 不必再變胖。介面兩邊要一致。
Object.assign(LiveStore, {
  household: () => sb.from("households").select("id,name,invite_code").eq("id", hid).maybeSingle().then(must),
  /** 換一組邀請碼（v59 RPC，security definer：v94 拿掉 households 的 update 政策後照樣能用）→ 新碼 */
  rotateInvite: () => sb.rpc("rotate_invite_code", { hid }).then(must).then(c => {
    if (!c) throw new Error("伺服器沒有回傳新的邀請碼，請重新整理看看是否已經換好");
    return String(c);
  }),
  /** 加入家庭：回 household id；碼錯回 null（v59 刻意不丟例外，失敗次數才記得住）；錯太多次丟中文訊息 */
  joinHousehold: code => sb.rpc("join_household", { code }).then(must),
  /** 建立新家庭（同 App createHousehold）：id 自己產——建立者此刻還不是成員，insert 後讀不回來（RLS） */
  //  step 記著做到哪：中途失敗再按只補沒做完的（同一個 id；撞到 23505＝上次其實已經寫進去，只是回應沒收到）
  async createHousehold(name, step){
    step.id = step.id || crypto.randomUUID();
    if (!step.house){
      const { error } = await sb.from("households").insert({ id: step.id, name });
      if (error && error.code !== "23505") throw error;
      step.house = true;
    }
    if (!step.member){ must(await sb.from("household_members").insert({ household_id: step.id, user_id: uid, role: "owner" })); step.member = true; }
    must(await sb.rpc("seed_categories", { hid: step.id }));
  },

  // ── 成員（members：RLS 家庭成員 for all）──
  addMember: (name, nickname, sort_order) => affected(sb.from("members").insert({ household_id: hid, name, nickname, sort_order })),
  updateMember: (id, fields) => affected(sb.from("members").update(fields).eq("id", id)),
  deleteMember: id => affected(sb.from("members").delete().eq("id", id)),
  /** 「這是我」：先把選定成員連到我、確認有改到，再解除我原本連的其他成員。
   *  App 是先解除再設——第二步失敗就變成「沒有人是我」；這個順序最壞只是兩列暫時都是我，再按一次就好 */
  async setMemberAsMe(id){
    await affected(sb.from("members").update({ user_id: uid }).eq("id", id));
    must(await sb.from("members").update({ user_id: null }).eq("household_id", hid).eq("user_id", uid).neq("id", id));
  },

  // ── 分類清單與預算（category_labels）──
  seedLabels: keys => affected(sb.from("category_labels").insert(keys.map((k, i) =>
    ({ household_id: hid, key: k, label: k, sort_order: i, builtin: true, active: true })))),
  addLabel: (key, label, sort_order, budget) => affected(sb.from("category_labels")
    .insert({ household_id: hid, key, label, sort_order, budget, builtin: false })),
  updateLabel: (id, fields) => affected(sb.from("category_labels").update(fields).eq("id", id)),
  deleteLabel: id => affected(sb.from("category_labels").delete().eq("id", id)),

  // ── 已學習的規則：三張表都是「家庭成員 for all」，直接刪並確認刪到（App 走 RPC，但 RPC 回 void、看不出有沒有刪到）──
  deleteCatRule: id => affected(sb.from("category_rules").delete().eq("id", id)),
  deleteExcludeRule: id => affected(sb.from("exclude_rules").delete().eq("id", id)),
  deleteSubIgnore: pattern => affected(sb.from("subscription_ignores").delete().eq("household_id", hid).eq("pattern", pattern)),

  // ── 篩選器、繳費提醒 ──
  addFilterRule: row => affected(sb.from("filter_rules").insert({ household_id: hid, ...row })),
  setFilterActive: (id, active) => affected(sb.from("filter_rules").update({ active }).eq("id", id)),
  deleteFilterRule: id => affected(sb.from("filter_rules").delete().eq("id", id)),
  addReminder: (name, due_day) => affected(sb.from("bill_reminders").insert({ household_id: hid, name, due_day })),
  deleteReminder: id => affected(sb.from("bill_reminders").delete().eq("id", id)),

  // ── 信箱連結：表裡只有 gmail／稱呼；應用程式密碼走 RPC 進 Vault，明文只有伺服器的撈信程式讀得到 ──
  myMail: () => sb.from("mail_accounts").select("gmail,member_name").eq("household_id", hid).eq("user_id", uid)
    .limit(1).then(must).then(r => r[0] || null),
  /** 家人的信箱（新增帳單來源時，選成員自動帶入收信信箱用）；RLS 只讓本人與戶長讀得到，讀不到就是空的 */
  mailboxes: () => sb.from("mail_accounts").select("gmail,member_name").eq("household_id", hid).then(must),
  saveMail: (gmail, password, memberName) => sb.rpc("set_mail_account",
    { hid, p_gmail: gmail, p_member_name: memberName, p_app_password: password }).then(must),
  // 下面兩支 RPC 回 void、刪到 0 列也不報錯：先確認還在，不然「家人剛在 App 刪掉」時這裡會說成功
  async removeMail(){
    if (!(await LiveStore.myMail())) throw new Error("你的信箱連結已經不在了（可能在 App 解除過）；關掉這個視窗、重新整理頁面就會看到最新狀態");
    must(await sb.rpc("remove_mail_account", { hid }));
  },

  // ── 帳單來源：讀清單不含密碼；secret_id（Vault 的參照，不是密碼）讀到就轉成「有沒有設」，不留原值 ──
  sources: () => sb.from("bank_sources")
    .select("id,parser,name,kind,from_contains,subject_contains,member_hint,mailbox,active,sort_order,secret_id")
    .eq("household_id", hid).order("sort_order").then(must)
    .then(rows => rows.map(({ secret_id, ...x }) => ({ ...x, hasPw: secret_id != null }))),
  /** 新增（id 空）或更新；password 空字串＝密碼不變（RPC 的約定） */
  setSource: x => sb.rpc("set_bank_source", { hid, p_id: x.id || null, p_parser: x.parser, p_name: x.name, p_kind: x.kind,
    p_from: x.from, p_subject: x.subject, p_member: x.member, p_mailbox: x.mailbox, p_pdf_password: x.password }).then(must),
  async deleteSource(id){
    if (!must(await sb.from("bank_sources").select("id").eq("id", id)).length)
      throw new Error("這個來源已經不在了（可能家人剛刪掉）；關掉這個視窗、重新整理頁面就會看到最新清單");
    must(await sb.rpc("delete_bank_source", { hid, p_id: id }));
  },
  ignoreSource: id => sb.rpc("ignore_bank_source", { hid, p_id: id }).then(must),

  // ── 自動撈取設定（ingest_settings：一個家庭一列）──
  ingest: () => sb.from("ingest_settings").select("since_days,interval_value,interval_unit,email_enabled,notif_enabled," +
    "einvoice_enabled,auto_enabled,run_hour,last_run_at,last_error,last_error_at").eq("household_id", hid).limit(1)
    .then(must).then(r => r[0] || null),
  /** 只送畫面上的欄位：schedule_hours、last_run_at、ai_parser_enabled 等別人寫的欄位不覆寫（App 會把 schedule_hours 洗回 24） */
  saveIngest: fields => sb.from("ingest_settings").upsert({ household_id: hid, ...fields }, { onConflict: "household_id" })
    .select("household_id").then(must).then(r => { if (!r.length) throw new Error("沒有成功寫進去（可能沒有權限）"); }),
  lastDone: () => sb.from("sync_requests").select("finished_at").eq("household_id", hid).eq("status", "done")
    .order("finished_at", { ascending: false }).limit(1).then(must).then(r => (r[0] && r[0].finished_at) || null),

  // ── AI：表裡只讀得到「開關」與「有沒有金鑰」；金鑰走 RPC 進 Vault ──
  ai: () => sb.from("ai_settings").select("enabled,key_secret_id").eq("household_id", hid).limit(1).then(must)
    .then(r => ({ enabled: !!(r[0] && r[0].enabled), hasKey: !!(r[0] && r[0].key_secret_id) })),
  /** key 空字串＝只改開關、金鑰不變（RPC 的約定） */
  saveAi: (enabled, key) => sb.rpc("set_ai_settings", { hid, p_enabled: enabled, p_api_key: key }).then(must),
  signOut: () => sb.auth.signOut().then(({ error }) => { if (error) throw error; })
});

/* ═══════════ 本頁狀態 ═══════════ */
/** 第一次切到「我的」才讀，refreshData 時作廢（開著才重抓）。各區獨立：一區讀不到只影響那一區 */
const MV = { stale: true, loading: false, data: {}, errs: {}, showIgnored: false };
const ME_LOADS = {
  household: () => Store.household(), mail: () => Store.myMail(), mailboxes: () => Store.mailboxes(),
  sources: () => Store.sources(), ingest: () => Store.ingest(), lastDone: () => Store.lastDone(), ai: () => Store.ai()
};
function meStale(){ MV.stale = true; }
function loadMe(){
  if (MV.loading || !MV.stale || (!DEMO && !hid)) return;   // 還沒確認家庭（登入途中）不抓
  MV.loading = true; MV.stale = false;
  const keys = Object.keys(ME_LOADS);
  Promise.allSettled(keys.map(k => ME_LOADS[k]())).then(rs => rs.forEach((r, i) => {
    const k = keys[i];
    if (r.status === "fulfilled"){ MV.data[k] = r.value; delete MV.errs[k]; }
    else { MV.errs[k] = plainError(r.reason); console.warn(`「我的」頁 ${k} 讀取失敗`, r.reason && r.reason.code); }   // 舊資料留著
  })).finally(() => { MV.loading = false; if (MV.stale) loadMe(); else if (tab === "me") paintMe(); });
}
function retryMe(){ MV.stale = true; paintMe(); }
/** 一區的資料：還沒到 → 讀取中／失敗＋重試；到了就畫（失敗但有上一份＝畫舊的並註明） */
function need(box, key, draw){
  const has = key in MV.data, err = MV.errs[key];
  if (err){
    box.appendChild(el("p", "warn", `讀取失敗：${err}` + (has ? "（下方是上一次的資料）" : "")));
    if (!has){ const r = el("button", null, "重試"); r.addEventListener("click", retryMe); box.appendChild(r); return; }
  } else if (!has){ box.appendChild(el("p", "muted", "讀取中…")); return; }
  draw(MV.data[key]);
}
const loaded = key => key in MV.data;

/* ═══════════ 小工具 ═══════════ */
/** 一列設定：左邊標題＋小字，右邊按鈕 */
function setRow(titleText, sub, ...buttons){
  return add(el("div", "setrow"), add(el("span", "m"), el("span", null, titleText), sub ? el("small", null, sub) : null), ...buttons);
}
/** 小按鈕；aria 給只有符號的按鈕（🗑、✎）一個念得出來的名字 */
function btn(text, onClick, cls = "link", aria = null){
  const b = el("button", cls, text);
  if (aria) b.setAttribute("aria-label", aria);
  b.addEventListener("click", onClick);
  return b;
}
/** 需要確認的寫入（刪除、換碼…）：確認鈕紅色；成功關閉並重抓（done 可另外處理） */
function confirmWrite(titleText, lines, okText, write, done = refreshData){
  const f = formDialog(titleText, okText);
  f.save.classList.add("danger");
  for (const l of lines) if (l) f.body.appendChild(typeof l === "string" ? el("p", null, l) : l);
  f.save.addEventListener("click", async () => {
    if (await f.submit(write)){ f.d.close(); done(); }
  });
  return f;
}
/** 這個情境才認得的資料庫錯誤碼換成白話（其餘照丟，交給 plainError） */
const explain = map => e => { throw (e && map[e.code] ? new Error(map[e.code]) : e); };
const select = (pairs, value) => {
  const s = el("select");
  for (const [label, v] of pairs){ const o = el("option", null, label); o.value = v; if (v === value) o.selected = true; s.appendChild(o); }
  return s;
};
const checkbox = (label, on) => {
  const c = el("input"); c.type = "checkbox"; c.checked = !!on;
  return [add(el("label", "chk"), c, el("span", null, label)), c];
};
/** 祕密輸入框：遮住、不讓瀏覽器自動填／記住；值只在送出那一刻讀 */
function secretInput(){
  const i = el("input");
  // new-password：Chrome 不理 off，這樣才不會把已存的登入密碼自動填進來
  i.type = "password"; i.autocomplete = "new-password"; i.spellcheck = false;
  i.setAttribute("autocapitalize", "none");
  return i;
}
const sortBy = k => (a, b) => (a[k] ?? 0) - (b[k] ?? 0);

/* ═══════════ 畫面 ═══════════ */
function paintMe(){
  loadMe();
  resetCharts();
  const root = $("meView");
  root.replaceChildren();
  const ing = MV.data.ingest, src = MV.data.sources, ai = MV.data.ai, mail = MV.data.mail;
  const pend = src ? E.splitSources(src, isHidden).discovered.length : 0;
  add(root, houseCard(), syncCard(),
    el("h3", "vh", "🧾 記帳規則"),
    fold("me:labels", "🏷️ 消費分類與預算", `${S.labels.length} 類` +
      (S.labels.some(l => l.budget > 0) ? `，${S.labels.filter(l => l.budget > 0).length} 類有設預算` : "，都沒設預算"), labelsBody),
    fold("me:rules", "🧠 已學習的規則",
      `分類規則 ${S.catRules.length}・排除規則 ${S.excludeRules.length}・非訂閱 ${S.subIgnores.size}`, rulesBody),
    fold("me:filters", "🎛 篩選器（自動規則）", S.filterRules.length
      ? `${S.filterRules.length} 條（${S.filterRules.filter(r => r.active !== false).length} 條啟用中）` : "尚無篩選器", filtersBody),
    el("h3", "vh", "⚙️ 進階設定"),
    fold("me:mail", "📧 信箱連結", !loaded("mail") ? "設定要從哪個信箱撈帳單"
      : mail ? `✅ 已連結 ${mail.gmail}` : "你還沒連結信箱", mailBody),
    fold("me:sources", "📥 帳單來源", !src ? "哪個信箱撈哪家帳單"
      : `${src.filter(x => x.active).length} 個來源` + (pend ? `・📬 發現 ${pend} 個尚未設定的機構` : ""), sourcesBody),
    fold("me:ingest", "🕒 自動撈取", !loaded("ingest") ? "多久自動撈一次信箱" : ingestSummary(ing), ingestBody),
    fold("me:bills", "💳 繳費提醒", activeReminders().length ? `${activeReminders().length} 個提醒` : "帳單繳款日提醒", billsBody),
    fold("me:ai", "🤖 AI 金鑰", !ai ? "智能分類與 AI 帳單解析"
      : `${ai.enabled ? "已啟用" : "未啟用"}・${ai.hasKey ? "已設定金鑰" : "尚未設定金鑰"}`, aiBody),
    aboutCard());
}

/* ── 🏠 我們家：家名、邀請碼、成員 ── */
function houseCard(){
  const c = el("section", "card");
  need(c, "household", h => {
    if (!h){ c.appendChild(el("p", "warn", "讀不到家庭資料（可能已被移出這個家庭），請重新整理")); return; }
    add(c, el("h2", null, "🏠 " + (h.name || "我的家")), inviteRow(h));
  });
  c.appendChild(el("div", "hr"));
  membersPart(c);
  return c;
}
function inviteRow(h){
  const box = el("div");
  const code = el("span", "code", h.invite_code || "—");
  const copy = btn("📋 複製", async () => {
    try { await navigator.clipboard.writeText(h.invite_code); toast("已複製邀請碼"); }
    catch (_){ toast("這個瀏覽器不讓網頁複製，請長按邀請碼自己複製"); }
  });
  // 手機才有「分享到 LINE…」的系統選單；電腦瀏覽器多半沒有，就不放這顆
  const share = navigator.share ? btn("📤 分享", () => navigator.share({ title: "家計簿邀請",
    text: `加入我們的家計簿：用 Google 登入 ${location.origin + location.pathname} 後，輸入邀請碼 ${h.invite_code}` })
    .catch(() => { /* 使用者自己取消分享：不用講 */ })) : null;
  const rotate = btn("換一組", () => rotateDialog(h), "link", "更換邀請碼，舊的邀請碼會立刻失效");
  add(box, add(el("div", "rowx"), el("span", "muted", "邀請碼"), code), add(el("div", "rowx"), copy, share, rotate),
    el("p", "note", "傳給家人加入。覺得可能被別人看到就換一組。"));
  return box;
}
/** 換一組邀請碼：確認文案照 App（InviteCodeRow） */
function rotateDialog(h){
  let fresh = null;
  confirmWrite("要換一組邀請碼嗎？", [`換了以後，舊的邀請碼「${h.invite_code}」立刻失效。`,
    "已經加入的家人不受影響，還沒加入的人要用新的碼。"], "換一組",
  async () => { fresh = await Store.rotateInvite(); },
  () => { MV.data.household = { ...h, invite_code: fresh }; toast("✅ 已換成新的邀請碼，舊的已失效"); repaint(); });
}

function membersPart(c){
  add(c, el("h3", null, "👪 家庭成員"),
    el("p", "note", "名字要與對帳單上的姓名一致，匯入的交易才會自動歸給他。暱稱是畫面顯示用的短稱，沒填就用名字。"));
  if (!S.members.length) c.appendChild(el("p", "muted", "名冊還是空的：按下方「➕ 新增成員」加第一位。"));
  for (const m of S.members){
    const mine = uid != null && m.user_id === uid;
    const status = mine ? "👤 這是我（「＋ 記一筆」預設算我的）"
      : m.user_id ? "已連結登入帳號" : "未連結登入帳號（沒有帳號的家人也能入冊）";
    c.appendChild(setRow(m.name + (m.nickname ? `（${m.nickname}）` : ""), status,
      mine ? null : btn("這是我", () => setMeDialog(m)),
      btn("✎", () => memberDialog(m), "link", `編輯 ${m.name}`),
      btn("🗑", () => deleteMemberDialog(m), "link danger", `刪除 ${m.name}`)));
  }
  c.appendChild(btn("➕ 新增成員", () => memberDialog(null), ""));
}
/** 「這是我」：記一筆預設歸屬。選的人已連到別人的登入帳號時講清楚（App 會直接搶走） */
function setMeDialog(m){
  const other = m.user_id && m.user_id !== uid;
  const f = formDialog(`「${m.name}」是你嗎？`, "對，這是我");
  add(f.body, el("p", null, "設定後，你用「＋ 記一筆」記的帳預設算他的；原本連到你的成員會改回未連結。"),
    other ? el("p", "warn", `「${m.name}」目前連結的是另一個登入帳號（應該是另一位家人）。改成你之後，那位家人記帳的預設歸屬會跑掉——確定是你才按。`) : null);
  f.save.addEventListener("click", async () => {
    if (await f.submit(() => Store.setMemberAsMe(m.id))){ f.d.close(); toast(`已設「${m.name}」為你（記帳預設算這位，成員按鈕也排到最前面）`); refreshData(); }
  });
}
/** 新增（m＝null）或編輯成員：名字必填（App 清空名字時靜默不存，這裡擋下並說明） */
function memberDialog(m){
  const f = formDialog(m ? "編輯成員" : "新增成員", m ? "儲存" : "新增");
  const name = el("input"), nick = el("input");
  name.value = m ? m.name : ""; nick.value = m ? m.nickname || "" : "";
  name.maxLength = nick.maxLength = 30;
  add(f.body, field("名字（同對帳單）", name), el("p", "note", "名字要與對帳單姓名一致，未來匯入的交易才會自動歸給他。" +
      (m ? "改名後，對帳單上還是舊名字的帳單就對不上了；帳單來源的「歸屬成員」也要一起改。" : "")),
    field("暱稱（畫面顯示用，選填）", nick), el("p", "note", "暱稱會套用到他名下的帳戶顯示，如「某某銀行（暱稱）」；留空＝用名字。"));
  const check = f.check = () => { f.save.disabled = f.sending || !name.value.trim(); };
  name.addEventListener("input", check);
  check();
  f.save.addEventListener("click", async () => {
    const n = name.value.trim(), k = nick.value.trim() || null;
    const dup = explain({ "23505": `已有名字是「${n}」的成員，請換個名字` });
    const ok = await f.submit(() => (m ? Store.updateMember(m.id, { name: n, nickname: k })
      : Store.addMember(n, k, S.members.reduce((x, y) => Math.max(x, y.sort_order ?? 0), 0) + 1)).catch(dup));
    if (ok){ f.d.close(); refreshData(); }
  });
}
function deleteMemberDialog(m){
  confirmWrite(`刪除成員「${m.name}」？`, [
    "刪除後名冊上不再有他；之後匯入的帳單若寫的是這個名字，就不會自動歸給任何人。",
    "已經有交易或帳戶歸在他名下的成員不能刪（會告訴你），這時改名或保留就好。",
    uid != null && m.user_id === uid ? el("p", "warn", "這位是「你」：刪掉後，你記的帳預設會算第一位成員的。") : null
  ], "刪除", () => Store.deleteMember(m.id).catch(explain({
    "23503": `「${m.name}」名下還有交易或帳戶，無法刪除；可以改名或保留` })));
}

/* ── 🔄 同步狀態（按鈕就是頁首那顆的同一個動作） ── */
function syncCard(){
  const c = add(el("section", "card"), el("h3", null, "🔄 同步狀態"));
  need(c, "ingest", ing => {
    const last = [ing && ing.last_run_at, MV.data.lastDone].filter(Boolean).sort().pop();
    add(c, el("p", null, `上次同步：${last ? hhmm(last) : "—"}`));
    if (ing && ing.last_error){
      // 頁首只放得下最後一行的前 80 字；這裡給完整原因（App v58：壞掉時才知道是壞了，不是這幾天沒消費）
      const d = el("details", "errbox");
      add(d, el("summary", null, `⚠️ 上次自動撈取失敗（${hhmm(ing.last_error_at) || "時間不明"}）`),
        el("p", null, "資料沒有遺失，下次同步會重撈同一段時間。點這裡看原因："), el("pre", null, String(ing.last_error)));
      c.appendChild(d);
    }
  });
  // 結果（已送出／剛同步過／已有一次在跑）由 startSync 寫在頁首，這裡不另外說「已送出」——講的可能跟頁首相反
  const b = btn("🔄 立即同步", async () => {
    if (syncing) return;
    b.disabled = true;
    toast("進度與結果顯示在畫面最上方");
    await startSync();
    if (tab === "me") paintMe();   // 開始同步了＝按鈕要變灰；沒開始（太頻繁、送出失敗）＝恢復可按
  }, "");
  b.disabled = DEMO || syncing;
  add(c, b, el("p", "note", DEMO ? "示範模式不連線，無法同步。" : "撈取信箱帳單／通知並更新資料，大約 1–3 分鐘；離開這頁也會繼續。"));
  return c;
}

/* ── 🏷️ 消費分類與預算（category_labels） ── */
function labelsBody(b){
  b.appendChild(el("p", "note", "可改名稱、設每月預算（分析頁顯示花費／超支、明細頁跳超支提醒）。內建分類可改名不可刪，自己新增的可刪。"));
  const labels = S.labels.slice().sort(sortBy("sort_order"));
  if (!labels.length){
    // App 一開這頁就自動寫入；這裡改成按了才寫，看設定頁不該改到資料
    add(b, el("p", "muted", "分類清單還是空的（明細、分析目前用內建清單）。建立後才能改名、設預算。"),
      btn("建立內建分類清單", () => confirmWrite("建立內建分類清單？", [`會寫入 ${E.AI_CATS.length} 個內建分類（${E.AI_CATS.slice(0, 3).join("、")}…），之後可改名、設預算。`],
        // 撞 23505＝App（或另一台）剛好同時建好了：當作完成，重抓就看得到
        "建立", () => Store.seedLabels(E.AI_CATS).catch(e => { if (!e || e.code !== "23505") throw e; })), ""));
    return;
  }
  for (const l of labels){
    b.appendChild(setRow(l.label, (l.budget > 0 ? `每月預算 ${nt(l.budget)}` : "未設預算") + (l.builtin ? "" : "・自訂"),
      btn("✎", () => labelDialog(l), "link", `編輯 ${l.label}`),
      l.builtin ? null : btn("🗑", () => deleteLabelDialog(l), "link danger", `刪除 ${l.label}`)));
  }
  b.appendChild(btn("➕ 新增分類", () => labelDialog(null), ""));
}
/** 新增（l＝null）或編輯分類：名稱必填；預算留空＝不設 */
function labelDialog(l){
  const f = formDialog(l ? "編輯分類" : "新增分類", l ? "儲存" : "新增");
  const name = el("input"), budget = el("input");
  name.value = l ? l.label : ""; name.maxLength = 30;
  name.placeholder = "可加 emoji，如 🎮 娛樂";
  budget.inputMode = "numeric"; budget.value = l && l.budget > 0 ? String(l.budget) : "";
  add(f.body, field("顯示名稱", name), field("每月預算 NT$（留空＝不設）", budget),
    el("p", "note", l ? "改名只動顯示名稱，已學到的規則不受影響。" : "新分類會出現在「改分類」「記一筆」的選單裡。"));
  const check = f.check = () => { f.save.disabled = f.sending || !name.value.trim(); };
  name.addEventListener("input", check);
  check();
  f.save.addEventListener("click", async () => {
    const t = budget.value.trim(), bv = t ? E.intIn(t, 1, 999999999) : null;
    if (t && bv == null){ f.err.textContent = "預算只能填 1 以上的整數，或留空"; return; }
    const ok = await f.submit(() => (l ? Store.updateLabel(l.id, { label: name.value.trim(), budget: bv })
      : Store.addLabel(randomKey(), name.value.trim(), S.labels.reduce((x, y) => Math.max(x, y.sort_order ?? 0), 0) + 1, bv)));
    if (ok){ f.d.close(); refreshData(); }
  });
}
/** 自訂分類的 key（同 App：c_＋8 碼）；只在新增時用一次，之後改名不動 key，規則才不會斷 */
const randomKey = () => "c_" + [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, "0")).join("");
function deleteLabelDialog(l){
  const n = S.catRules.filter(r => r.category === l.key).length + S.filterRules.filter(r => r.action === "cat:" + l.key).length;
  confirmWrite(`刪除分類「${l.label}」？`, [
    "刪除後選單裡不再有這一類。",
    n ? el("p", "warn", `有 ${n} 條規則把商家歸到這一類；刪掉後它們會顯示成代碼。建議先到「已學習的規則」或篩選器把它們改掉或刪掉。`) : null
  ], "刪除", () => Store.deleteLabel(l.id));
}

/* ── 🧠 已學習的規則（清單長，放對話框裡搜尋與刪除） ── */
function rulesBody(b){
  add(b, el("p", "note", "「改分類就記住」「以後同商家都不納入」「非訂閱」會記成規則，之後自動套用。這裡可查詢與刪除。"),
    btn("查看與刪除…", rulesDialog, ""));
}
function rulesDialog(){
  const { body } = dialog("🧠 已學習的規則");
  const q = el("input");
  q.type = "search"; q.placeholder = "🔍 搜尋商家／分類";
  q.setAttribute("aria-label", "搜尋商家或分類");
  const list = el("div");
  // 對話框裡留一份自己的清單：刪了就地拿掉，背景再重抓（重抓完的 S 不會回頭蓋掉這裡）
  let cat = S.catRules.slice(), exc = S.excludeRules.slice(), ign = [...S.subIgnores].sort(), shown = 200;
  const del = (what, write, drop) => confirmWrite(`刪除${what}？`, ["刪掉後，之後的資料不再套用這條；之前已顯示的數字下次重抓就會跟著變。"],
    "刪除", write, () => { drop(); draw(); refreshData(); });
  const draw = () => {
    const r = E.ruleSearch(cat, exc, q.value, S.labels), qq = q.value.trim().toLowerCase();
    const ig = ign.filter(p => !qq || p.includes(qq));
    list.replaceChildren(el("h4", null, `分類規則（${r.cat.length}）`));
    if (!r.cat.length) list.appendChild(el("p", "muted", "（無）"));
    for (const x of r.cat.slice(0, shown))
      list.appendChild(setRow(`${x.merchant} → ${E.labelOf(x.category, S.labels)}`, x.source === "ai" ? "AI 自動" : "手動",
        btn("🗑", () => del(`分類規則「${x.merchant}」`, () => Store.deleteCatRule(x.id), () => { cat = cat.filter(y => y !== x); }),
          "link danger", `刪除分類規則 ${x.merchant}`)));
    if (r.cat.length > shown) list.appendChild(btn(`再顯示 200 條（共 ${r.cat.length} 條）`, () => { shown += 200; draw(); }, ""));
    list.appendChild(el("h4", null, `排除規則（${r.exc.length}）`));
    if (!r.exc.length) list.appendChild(el("p", "muted", "（無）"));
    for (const x of r.exc)
      list.appendChild(setRow(`${x.pattern} → ${x.exclude_state === "exclude" ? "不納入收支" : "納入收支"}`, x.source === "ai" ? "AI 自動" : "手動",
        btn("🗑", () => del(`排除規則「${x.pattern}」`, () => Store.deleteExcludeRule(x.id), () => { exc = exc.filter(y => y !== x); }),
          "link danger", `刪除排除規則 ${x.pattern}`)));
    list.appendChild(el("h4", null, `非訂閱清單（${ig.length}）`));
    list.appendChild(el("p", "note", "在分析頁「定期扣款/訂閱」點過「非訂閱」的商家；刪掉＝撤銷（之後又會被自動偵測）。"));
    if (!ig.length) list.appendChild(el("p", "muted", "（無）"));
    for (const p of ig)
      list.appendChild(setRow(`${p} → 不列為訂閱`, null,
        btn("🗑", () => del(`非訂閱標記「${p}」`, () => Store.deleteSubIgnore(p), () => { ign = ign.filter(y => y !== p); }),
          "link danger", `撤銷非訂閱 ${p}`)));
  };
  q.addEventListener("input", () => { shown = 200; draw(); });
  add(body, q, list);
  draw();
}

/* ── 🎛 篩選器（filter_rules） ── */
function filtersBody(b){
  const err = el("p", "warn");
  err.setAttribute("role", "alert");
  add(b, el("p", "note", "符合條件（關鍵字／帳戶／金額範圍／方向）就自動套用分類或狀態（不納入／納入）。" +
    "多條依「優先序」小者先套，第一個命中就生效；優先於商家分類／排除規則。"), err);
  if (!S.filterRules.length) b.appendChild(el("p", "muted", "（尚無篩選器）"));
  for (const r of S.filterRules.slice().sort(sortBy("priority"))){
    const on = r.active !== false;
    const tg = btn(on ? "停用" : "啟用", () => busy(tg, err, () => Store.setFilterActive(r.id, !on)).then(ok => ok && refreshData()),
      "link", `${on ? "停用" : "啟用"}篩選器 ${r.name || ""}`);
    const row = setRow((r.name ? `${r.name}：` : "") + E.filterRuleSummary(r, S.labels), `優先序 ${r.priority ?? 100}` + (on ? "" : " · 已停用"),
      tg, btn("🗑", () => confirmWrite("刪除這條篩選器？", [E.filterRuleSummary(r, S.labels), "刪掉後，符合條件的交易回到一般規則判斷。"],
        "刪除", () => Store.deleteFilterRule(r.id)), "link danger", `刪除篩選器 ${r.name || ""}`));
    if (!on) row.classList.add("off");
    b.appendChild(row);
  }
  b.appendChild(btn("➕ 新增篩選器", filterDialog, ""));
}
/** 新增篩選器（App FilterRuleDialog）：至少一個條件才可新增 */
function filterDialog(){
  const f = formDialog("新增篩選器", "新增");
  const name = el("input"), kw = el("input"), account = el("input"), amin = el("input"), amax = el("input"), pri = el("input");
  amin.inputMode = amax.inputMode = pri.inputMode = "numeric";
  pri.value = "100";
  const dir = select([["全部", "any"], ["支出", "expense"], ["收入", "income"]], "any");
  const act = select([["設分類", "cat"], ["不納入收支", "exclude"], ["納入收支", "include"]], "cat");
  const opts = E.categoryOptions(S.labels);
  const cat = select(opts.map(([k, label]) => [label, k]), opts.length ? opts[0][0] : "");
  const catFld = field("分類", cat);
  add(f.body, field("名稱（可空）", name), field("關鍵字：商家／摘要含", kw), field("帳戶／來源含（可空）", account),
    add(el("div", "rowx"), field("金額 ≥", amin), field("金額 ≤", amax)), field("方向", dir), field("動作", act), catFld,
    field("優先序（小者先，預設 100）", pri));
  const hasCond = () => [kw, account, amin, amax].some(i => i.value.trim()) || dir.value !== "any";
  const check = f.check = () => { catFld.hidden = act.value !== "cat"; f.save.disabled = f.sending || !hasCond(); };
  for (const i of [kw, account, amin, amax]) i.addEventListener("input", check);
  dir.addEventListener("change", check); act.addEventListener("change", check);
  check();
  f.save.addEventListener("click", async () => {
    const num = (i, what) => { const t = i.value.trim(); if (!t) return null; const v = E.intIn(t, 0, 999999999); if (v == null) throw new Error(`${what}只能填 0 以上的整數，或留空`); return v; };
    let row;
    try {
      const lo = num(amin, "金額下限"), hi = num(amax, "金額上限");
      if (lo != null && hi != null && lo > hi) throw new Error("金額下限不能大於上限");
      const p = pri.value.trim() ? E.intIn(pri.value, 0, 99999) : 100;
      if (p == null) throw new Error("優先序只能填 0～99999 的整數");
      row = { name: name.value.trim(), priority: p, kw: kw.value.trim(), account: account.value.trim(), amount_min: lo, amount_max: hi,
              direction: dir.value, action: act.value === "cat" ? "cat:" + cat.value : act.value };
    } catch (e){ f.err.textContent = e.message; return; }
    if (await f.submit(() => Store.addFilterRule(row))){ f.d.close(); refreshData(); }
  });
}

/* ── 📧 信箱連結（只管自己的） ── */
function mailBody(b){
  need(b, "mail", m => {
    if (m) add(b, el("p", "income", `✅ 已連結：${m.gmail}` + (m.member_name ? `（${m.member_name}）` : "")),
      add(el("div", "rowx"), btn("更新", () => mailDialog(m), ""), btn("解除連結", () => confirmWrite("解除信箱連結？", [
        `雲端撈取之後不再讀「${m.gmail}」；存在伺服器上的應用程式密碼會一併刪除。`,
        "想完全斷開，也可以到 Google 帳戶撤銷這組應用程式密碼。"], "解除", () => Store.removeMail()), "warnline")));
    else add(b, el("p", "muted", "你還沒連結信箱。連結後，雲端撈取會從這個信箱讀帳單與消費通知。"), btn("連結我的信箱", () => mailDialog(null), "primary"));
  });
  b.appendChild(el("p", "note", "這裡只管你自己的信箱；家人的信箱請他用自己的帳號登入家計簿後設定。"));
}
/** 連結／更新：伺服器每次都要密碼（RPC 檢查 ≥16 字），所以更新也要重填 */
function mailDialog(m){
  const f = formDialog(m ? "更新信箱連結" : "連結我的信箱", m ? "更新" : "連結");
  const gmail = el("input"), pw = secretInput(), name = el("input");
  gmail.type = "email"; gmail.autocomplete = "off"; gmail.placeholder = "你的 Gmail 地址";
  gmail.value = m ? m.gmail : "";
  const me = S.members.find(x => uid != null && x.user_id === uid);
  // 預設用名冊的「名字」不用暱稱：新增帳單來源選成員時是拿名字比對這一欄來自動帶信箱（engine mailboxFor）
  name.value = m ? m.member_name : me ? me.name : "";
  name.maxLength = 30;
  add(f.body, field("Gmail 地址", gmail), field(m ? "應用程式密碼（16 個字母，要重填）" : "應用程式密碼（16 個字母）", pw),
    field("我的稱呼（如：媽）", name),
    el("p", "note", "需先開「兩步驟驗證」，再到 Google 帳戶的「應用程式密碼」頁產生。這組密碼只能讀信，可隨時在 Google 帳戶撤銷；" +
      "存進伺服器的加密保險箱，之後畫面上只會顯示「已連結」，任何人都讀不回來。"));
  const check = f.check = () => { f.save.disabled = f.sending || !gmail.value.includes("@") || E.appPassword(pw.value).length < 16; };
  gmail.addEventListener("input", check); pw.addEventListener("input", check);
  check();
  f.save.addEventListener("click", async () => {
    const ok = await f.submit(() => Store.saveMail(gmail.value.trim(), E.appPassword(pw.value), name.value.trim()));
    if (ok){ pw.value = ""; f.d.close(); toast("✅ 已儲存，下次撈信生效"); refreshData(); }
  });
}

/* ── 📥 帳單來源 ── */
// 「暫時隱藏」只記在這台瀏覽器（App 是記在那支手機）；讀寫失敗（私密瀏覽）就當沒隱藏。
// 存的是雜湊不是「信箱|網域」明文（共用電腦不留家人信箱）；早期存成明文的（含 @ 或 |）讀的時候換算，下次寫入就換掉
const HIDE_KEY = "kakeibo.hiddenSources";
function hiddenKeys(){
  try { return new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || "[]").map(k => (/[@|]/.test(k) ? E.hideHash(k) : k))); }
  catch (_){ return new Set(); }
}
const hideKey = x => E.hideHash(E.sourceKey(x));
const isHidden = x => hiddenKeys().has(hideKey(x));
function setHidden(x, on){
  const s = hiddenKeys();
  if (on) s.add(hideKey(x)); else s.delete(hideKey(x));
  try { localStorage.setItem(HIDE_KEY, JSON.stringify([...s])); }
  catch (_){ toast("這個瀏覽器記不住隱藏設定（可能是私密瀏覽）"); }
  repaint();
}
const srcName = x => x.name || x.from_contains;

function sourcesBody(b){
  add(b, el("p", "note", "設定哪個信箱撈哪家銀行／信用卡對帳單。PDF 密碼加密存在伺服器，畫面上看不到。" +
    "清單只列已支援解析的機構；沒有你的機構＝需請開發者加解析器（給一份對帳單樣本即可）。沒有對帳單的帳戶可到「帳戶」頁手動新增。"));
  need(b, "sources", list => {
    const g = E.splitSources(list, isHidden);
    if (g.discovered.length){
      const box = add(el("div", "info"), el("b", null, `📬 同步時在信箱發現 ${g.discovered.length} 個尚未設定的機構對帳單`));
      for (const d of g.discovered)
        box.appendChild(setRow(srcName(d), `${d.from_contains} · ${d.mailbox}`,
          btn("設定啟用", () => sourceDialog(d)), btn("忽略", () => ignoreDialog(d))));
      box.appendChild(el("p", "note", "「設定啟用」＝補歸屬成員與 PDF 密碼後，下次同步開始自動匯入；機構不在清單時可選「清單裡沒有我的機構」。"));
      b.appendChild(box);
    }
    if (!g.active.length) b.appendChild(el("p", "muted", "尚無啟用的帳單來源（按下方新增）"));
    for (const x of g.active){
      const def = E.parserDef(x.parser);
      const row = setRow(x.name, [x.mailbox, x.member_hint, def ? def.label : x.parser || "尚無解析器", x.hasPw ? "PDF 密碼已設定" : ""]
        .filter(Boolean).join(" · "), btn("✎", () => sourceDialog(x), "link", `編輯 ${x.name}`),
        btn("🗑", () => confirmWrite(`刪除帳單來源「${x.name}」？`, ["之後不再從這個來源撈帳單；已經匯入的交易不受影響。",
          "存在伺服器上的 PDF 密碼會一併刪除。"], "刪除", () => Store.deleteSource(x.id)), "link danger", `刪除 ${x.name}`));
      b.appendChild(row);
    }
    b.appendChild(btn("➕ 新增帳單來源", () => sourceDialog(null), ""));
    const n = g.ignored.length + g.hiddenLocal.length;
    if (!n) return;
    const h = btn(`${MV.showIgnored ? "▾" : "▸"} 🚫 已忽略的機構（${n}）`, () => { MV.showIgnored = !MV.showIgnored; repaint(); }, "link");
    h.setAttribute("aria-expanded", String(MV.showIgnored));
    b.appendChild(add(el("div"), h));
    if (!MV.showIgnored) return;
    b.appendChild(el("p", "note", "復原永久忽略＝刪除忽略紀錄，下次同步重新偵測後，發現卡片會再次出現。"));
    for (const d of g.ignored)
      b.appendChild(setRow(srcName(d), `${d.from_contains} · ${d.mailbox} · 永久忽略（全家）`,
        btn("復原", () => confirmWrite(`復原偵測「${srcName(d)}」？`, ["將刪除忽略紀錄；下次同步重新偵測到帳單信時，發現卡片會重新出現（全家裝置都恢復偵測）。"],
          "復原偵測", () => Store.deleteSource(d.id)))));
    for (const d of g.hiddenLocal)
      b.appendChild(setRow(srcName(d), `${d.from_contains} · ${d.mailbox} · 只在這台瀏覽器隱藏`,
        btn("取消隱藏", () => setHidden(d, false))));
  });
}
/** 忽略發現的機構：永久（全家記住）或暫時（只這台瀏覽器）——文案照 App */
function ignoreDialog(d){
  const f = confirmWrite(`忽略「${srcName(d)}」？`, ["永久忽略＝記住這個機構，全家所有裝置都不再偵測提示。",
    "暫時隱藏＝只在這台瀏覽器隱藏，其他裝置仍會提示。", "兩種都可以之後在「🚫 已忽略的機構」自己復原。"],
  "永久忽略", () => Store.ignoreSource(d.id));
  f.save.before(btn("暫時隱藏", () => { f.d.close(); setHidden(d, true); }, ""));
}
/** 新增／編輯／啟用發現的來源（App BankSourceDialog） */
function sourceDialog(x){
  const discovered = x != null && !x.active;
  const f = formDialog(!x ? "新增帳單來源" : discovered ? "啟用偵測到的帳單來源" : "編輯帳單來源");
  const first = E.PARSER_DEFS[0];
  // 目前的值不在選單裡（舊的解析器代號、名冊已改名的成員）也要列出來：不然選單默默跳到第一項，一存就把原值洗掉
  const keep = (pairs, v, label) => (v && !pairs.some(p => p[1] === v) ? [...pairs, [label(v), v]] : pairs);
  const parser = select(keep([["（清單裡沒有我的機構）", ""], ...E.PARSER_DEFS.map(d => [d.label, d.id])], x && x.parser,
    v => `${v}（目前的設定）`), x ? x.parser || "" : first.id);
  const name = el("input"), mailbox = el("input"), pw = secretInput(), from = el("input"), subject = el("input");
  name.value = x ? x.name : ""; mailbox.value = x ? x.mailbox : "";
  from.value = x ? x.from_contains : first.from; subject.value = x ? x.subject_contains : first.subject;
  mailbox.type = "email"; mailbox.autocomplete = "off"; from.autocomplete = subject.autocomplete = "off";
  const solo = S.members.length === 1;   // 只有一位成員：自動歸他，不多問（同 App）
  const member = select(keep([["（未指定）", ""], ...S.members.map(m => [m.name, m.name])], x && x.member_hint,
    v => `${v}（名冊裡沒有這個名字）`), (x && x.member_hint) || (solo ? S.members[0].name : ""));
  const guess = () => E.mailboxFor(member.value, MV.data.mailboxes || [], MV.data.sources || []);
  if (solo && !mailbox.value) mailbox.value = guess() || "";
  const unknown = el("p", "warn", "這家機構還沒有專屬解析器：仍可先啟用（會用猜的，可能抓不齊明細）。把一份帳單樣本交給開發者即可正式支援。");
  const kindNote = el("p", "note");
  const adv = add(el("details", "dsec"), el("summary", null, "進階（系統認出帳單信用，已自動填好，一般不用改）"),
    field("寄件網域", from), field("主旨關鍵字", subject), kindNote);
  const kindOf = () => (E.parserDef(parser.value) || {}).kind || (x && x.kind) || "credit_card";
  add(f.body, field("選擇機構", parser), unknown, field("顯示名稱", name), solo ? null : field("歸屬成員", member),
    field("收信 Gmail（選成員自動帶入，可修改）", mailbox),
    field(!x ? "PDF 密碼（沒有就留空）" : x.hasPw ? "PDF 密碼（已設定；留空＝不變）" : "PDF 密碼（目前沒有；沒有就留空）", pw),
    el("p", "note", "通常是身分證字號。存進伺服器的加密保險箱，之後畫面上只顯示「已設定」。"),
    adv, el("p", "note", "存好後，下次系統收信時才會生效（可按「🔄 立即同步」）。"));
  parser.addEventListener("change", () => {
    const d = E.parserDef(parser.value);
    if (d){
      if (!discovered){ from.value = d.from; subject.value = d.subject; }   // 偵測到的列保留實際寄件網域／主旨
      if (!name.value.trim()) name.value = d.label;
    }
    check();
  });
  member.addEventListener("change", () => { const g = member.value && guess(); if (g) mailbox.value = g; check(); });
  const check = f.check = () => {
    unknown.hidden = !!parser.value;
    kindNote.textContent = `類型：${kindOf() === "bank" ? "銀行／證券對帳單" : "信用卡帳單"}（依機構自動）`;
    if (!parser.value || !from.value.trim()) adv.open = true;   // 沒機構或網域空白：欄位一定要看得到，不然存不了又找不到原因
    f.save.disabled = f.sending || !name.value.trim() || !mailbox.value.includes("@") || !from.value.trim();
  };
  for (const i of [name, mailbox, from]) i.addEventListener("input", check);
  check();
  f.save.addEventListener("click", async () => {
    const ok = await f.submit(() => Store.setSource({ id: x && x.id, parser: parser.value, name: name.value.trim(), kind: kindOf(),
      from: from.value.trim(), subject: subject.value, member: member.value, mailbox: mailbox.value.trim(), password: pw.value.trim() })
      .catch(explain({ "23505": "已有同名、同收信信箱、同歸屬成員的帳單來源，請換個顯示名稱" })));
    if (ok){ pw.value = ""; f.d.close(); toast("✅ 已儲存，下次撈信生效"); refreshData(); }
  });
}

/* ── 🕒 自動撈取（ingest_settings） ── */
const UNITS = [["天", "day"], ["週", "week"], ["月", "month"]];
const unitLabel = u => (UNITS.find(x => x[1] === u) || ["週"])[0];
/** 沒有設定列時的預設＝App IngestSettings 的預設 */
const ingestOf = ing => ({ since_days: 60, interval_value: 1, interval_unit: "week", email_enabled: true, notif_enabled: true,
  einvoice_enabled: true, auto_enabled: false, run_hour: null, ...(ing || {}) });
const ingestSummary = ing => { const v = ingestOf(ing); return v.auto_enabled ? `每 ${v.interval_value} ${unitLabel(v.interval_unit)}自動撈一次` : "自動排程未開"; };
function ingestBody(b){
  need(b, "ingest", ing => {
    const v = ingestOf(ing), on = x => (x ? "開" : "關");
    add(b, el("p", null, ingestSummary(ing) + `，每次往回撈 ${v.since_days} 天`),
      el("p", "muted", `信箱帳單 ${on(v.email_enabled)}・消費通知信 ${on(v.notif_enabled)}・電子發票 ${on(v.einvoice_enabled)}` +
        `・偏好時段 ${v.run_hour == null ? "不限" : v.run_hour + " 時"}`),
      el("p", "muted", `上次自動撈取：${v.last_run_at ? hhmm(v.last_run_at) : "尚未"}`),
      btn("修改", () => ingestDialog(v), ""),
      el("p", "note", "雲端每天喚醒一次，依上面頻率判斷是否該撈——不用開電腦也會跑。"));
  });
}
function ingestDialog(v){
  const f = formDialog("自動撈取設定");
  const iv = el("input"), days = el("input");
  iv.inputMode = days.inputMode = "numeric";
  iv.value = String(v.interval_value); days.value = String(v.since_days);
  const unit = select(UNITS, v.interval_unit);
  const [eRow, email] = checkbox("📧 信箱帳單", v.email_enabled), [nRow, notif] = checkbox("🔔 消費通知信", v.notif_enabled),
        [iRow, inv] = checkbox("🧾 電子發票", v.einvoice_enabled), [aRow, auto] = checkbox("🕒 開啟自動排程", v.auto_enabled);
  const hour = select([["不限", ""], ...Array.from({ length: 24 }, (_, h) => [`${h} 時`, String(h)])], v.run_hour == null ? "" : String(v.run_hour));
  add(f.body, add(el("div", "rowx"), field("每", iv), field("單位", unit)), field("每次往回撈幾天的帳單（1–365）", days),
    eRow, nRow, iRow, aRow, field("偏好時段（桌機用；雲端固定早上）", hour));
  f.save.addEventListener("click", async () => {
    const n = E.intIn(iv.value, 1, 99), d = E.intIn(days.value, 1, 365);
    if (n == null){ f.err.textContent = "「每」只能填 1～99 的整數"; return; }
    if (d == null){ f.err.textContent = "往回撈的天數只能填 1～365 的整數"; return; }
    const ok = await f.submit(() => Store.saveIngest({ interval_value: n, interval_unit: unit.value, since_days: d,
      email_enabled: email.checked, notif_enabled: notif.checked, einvoice_enabled: inv.checked, auto_enabled: auto.checked,
      run_hour: hour.value === "" ? null : +hour.value }));
    if (ok){ f.d.close(); toast(`✅ 已儲存，每 ${n} ${unitLabel(unit.value)}撈一次，下次生效`); refreshData(); }
  });
}

/* ── 💳 繳費提醒（bill_reminders） ── */
const activeReminders = () => S.reminders.filter(r => r.active !== false).sort(sortBy("due_day"));
function billsBody(b){
  b.appendChild(el("p", "note", "設每月第幾日繳款（1–28）；到期前 7 天內，明細頁會跳提醒。"));
  const list = activeReminders();
  if (!list.length) b.appendChild(el("p", "muted", "（尚無提醒）"));
  for (const r of list)
    b.appendChild(setRow(`${r.name} · 每月 ${r.due_day} 日`, null, btn("🗑", () => confirmWrite(`刪除提醒「${r.name}」？`,
      ["明細頁不再提醒這筆繳款。"], "刪除", () => Store.deleteReminder(r.id)), "link danger", `刪除提醒 ${r.name}`)));
  b.appendChild(btn("➕ 新增提醒", reminderDialog, ""));
}
function reminderDialog(){
  const f = formDialog("新增繳費提醒", "新增");
  const name = el("input"), day = el("input");
  name.placeholder = "如 某某信用卡"; name.maxLength = 30; day.inputMode = "numeric"; day.placeholder = "1～28";
  add(f.body, field("名稱", name), field("每月幾日繳款", day), el("p", "note", "限 1～28 日，避開大小月與二月的差異。"));
  const check = f.check = () => { f.save.disabled = f.sending || !name.value.trim() || E.intIn(day.value, 1, 28) == null; };
  name.addEventListener("input", check); day.addEventListener("input", check);
  check();
  f.save.addEventListener("click", async () => {
    if (await f.submit(() => Store.addReminder(name.value.trim(), E.intIn(day.value, 1, 28)))){ f.d.close(); refreshData(); }
  });
}

/* ── 🤖 AI 金鑰 ── */
function aiBody(b){
  b.appendChild(el("p", "note", "關鍵字沒涵蓋的商家交給 AI 自動歸類；沒有專屬解析器的機構帳單也由 AI 解析（標 ⚠️ 待核對）。" +
    "填哪家的金鑰都行、自動判別：Anthropic／OpenAI／Google Gemini／OpenRouter／Groq／xAI。金鑰加密存在伺服器，畫面上看不到。"));
  need(b, "ai", a => add(b, el("p", null, `AI 分類：${a.enabled ? "已啟用" : "未啟用"}`),
    el("p", a.hasKey ? "income" : "muted", a.hasKey ? "✅ 已設定金鑰" : "尚未設定金鑰"), btn("修改", () => aiDialog(a), "")));
}
function aiDialog(a){
  const f = formDialog("AI 設定");
  const [row, on] = checkbox("啟用 AI 分類", a.enabled);
  const key = secretInput();
  key.placeholder = "sk-…／AIza…／gsk_…／xai-…";
  const warn = el("p", "warn");
  add(f.body, row, field(a.hasKey ? "API 金鑰（已設定；留空＝不變）" : "API 金鑰（任一家）", key), warn,
    el("p", "note", "存進伺服器的加密保險箱；之後只顯示「已設定」，任何人都讀不回來。"));
  const check = f.check = () => {
    warn.textContent = on.checked && !a.hasKey && !key.value.trim() ? "還沒有金鑰：開了也不會分類，記得填金鑰。" : "";
    f.save.disabled = f.sending;
  };
  on.addEventListener("change", check); key.addEventListener("input", check);
  check();
  f.save.addEventListener("click", async () => {
    if (await f.submit(() => Store.saveAi(on.checked, key.value.trim()))){ key.value = ""; f.d.close(); toast("✅ 已儲存，下次撈信生效"); refreshData(); }
  });
}

/* ── ℹ️ 關於＋登出 ── */
function aboutCard(){
  const c = add(el("section", "card"), el("h3", null, "ℹ️ 關於網頁版"),
    el("p", "note", "網頁版會自動更新，不用重裝；可用瀏覽器選單「加到主畫面」當 App 用。字太小可用瀏覽器縮放（手機雙指放大、電腦 Ctrl＋）。"));
  if (!DEMO) c.appendChild(btn("登出", () => confirmWrite("確定要登出？", ["登出後需要重新用 Google 登入才能看到帳本。資料都在雲端，不會不見。"],
    "登出", () => Store.signOut(), () => location.reload()), "warnline"));
  return c;
}

/* ═══════════ 沒加入家庭的畫面：輸入邀請碼加入／建立新家庭（App SetupScreen） ═══════════ */
function bindJoin(){
  const code = $("joinCode"), go = $("btnJoin"), msg = $("joinMsg");
  const join = async () => {
    // 送出中再按（Enter 連按、Enter 後又點按鈕）不再送：每送一次錯碼伺服器就記一次失敗，5 次鎖一小時
    if (go.disabled) return;
    const c = E.normInviteCode(code.value);
    msg.className = "err";
    if (!c){ msg.textContent = "請先輸入邀請碼"; return; }
    go.disabled = true; msg.textContent = "";
    let joined = false;
    try {
      // 碼錯＝回 null（不是錯誤）；錯太多次＝資料庫丟中文訊息，plainError 會照講
      if (!(await Store.joinHousehold(c))){ msg.textContent = "邀請碼不存在，請再確認一次（英數字 8 碼）"; return; }
      joined = true;
      msg.className = "muted"; msg.textContent = "✅ 已加入，載入中…";
      location.reload();
    } catch (e){
      console.warn("加入家庭失敗", e && e.code);
      msg.textContent = plainError(e);
    } finally { if (!joined) go.disabled = false; }
  };
  go.addEventListener("click", join);
  // 中文輸入法選字時按的 Enter 是「確定選字」，不是送出
  code.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) join(); });

  // 建立新家庭：收在摺疊裡＋確認（家人誤按會變成兩本分開的帳）。中途失敗再按只補做沒完成的步驟，不會多建一本
  let step = {};
  const create = $("btnCreateHouse");
  create.addEventListener("click", () => {
    let name = $("newHouseName").value.trim();
    if (!name){ $("createMsg").textContent = "請先取個家庭名稱"; return; }
    $("createMsg").textContent = "";
    // 上次失敗後改了名字：還沒成為成員＝重新來過（舊那列沒有成員、沒人看得到，不會混進誰的帳）；
    // 已經是成員了就不能再開一本，沿用原本的名字只補做剩下的步驟（網頁與 App 都沒有改家名的功能）
    if (step.name && step.name !== name){
      if (step.member) name = step.name; else step = {};
    }
    step.name = name;
    create.disabled = true;   // 確認框開著時不能再開第二個（兩個一起按確認會同時跑同一組步驟）
    const f = confirmWrite(`建立「${name}」？`, ["會建立一本全新的空帳本，你是第一位成員；之後在「👤 我的」頁拿邀請碼給家人加入。",
      el("p", "warn", "家人已經在用家計簿的話，請按取消、改用邀請碼加入。")], "建立",
    () => Store.createHousehold(name, step).catch(e => {
      if (step.member) throw new Error(`帳本「${name}」已建立，但預設分類沒建好（${plainError(e)}）；再按一次「建立」只會補做這一步`);
      throw e;
    }), () => location.reload());
    f.d.addEventListener("close", () => { create.disabled = false; });
  });
}
