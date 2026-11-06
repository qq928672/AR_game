/**
 * Lamby 老師後台：後端（Google Apps Script）
 *
 * 架構（每位老師用自己的試算表和 Drive）：
 * - 這支程式綁在「管理者」的總表試算表上，總表的 teachers 工作表記錄每位老師的代碼、email、題庫位置
 * - 每位老師的題庫試算表、圖片資料夾都在老師自己的 Google Drive（老師是擁有者），
 *   題庫試算表分享給管理者（編輯者），讓這支程式能讀寫
 * - 圖片由老師的瀏覽器直接上傳到老師自己的 Drive，不經過這裡
 *
 * - 學生端：GET  <網址>?action=questions&code=老師代碼   → 不用登入
 * - 老師端：POST <網址>  { idToken, action, ... }         → 驗證 Google 登入 + teachers 名單
 *
 * 設定方式請看 GOOGLE-SETUP.md。
 */

// ======== 需要你填的設定 ========
const CLIENT_ID = '請貼上 OAuth 用戶端 ID（xxxx.apps.googleusercontent.com）';
const SITE_URL  = 'https://qq928672.github.io/AR_game/';   // 匯入舊題庫、舊圖片時使用
// ================================

const T_SHEET = 'teachers';
const T_HEAD = ['code', 'email', 'name', 'enabled', 'sheetId', 'folderId', 'linkedAt'];
const Q_SHEET = 'questions';
const Q_HEAD = ['id', 'q', 'sheep', 'image',
                'opt1', 'opt2', 'opt3', 'opt4',
                'optImg1', 'optImg2', 'optImg3', 'optImg4',
                'answerIndex', 'clueCode', 'clueText', 'updatedAt', 'updatedBy'];
const DATA_COLS = 15;   // 前 15 欄是題目內容，後 2 欄是修改時間、修改者

/* =========================================================
 * 對外入口
 * ========================================================= */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if ((p.action || 'questions') !== 'questions') return json_({ ok: false, error: '未知的操作' });
  try {
    const t = p.code ? findTeacher_('code', p.code) : defaultTeacher_();   // 舊的 QR Code 沒有老師代碼
    if (!t || !t.enabled || !t.sheetId) return json_({ ok: false, error: '找不到這位老師的題目' });
    const cache = CacheService.getScriptCache(), key = 'q_' + t.code;
    let body = cache.get(key);
    if (!body) {
      body = JSON.stringify({ ok: true, code: t.code, questions: readQuestions_(t).questions });
      try { cache.put(key, body, 60); } catch (_) { /* 太大就不快取 */ }
    }
    return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return json_({ ok: false, error: '題目讀取失敗' });
  }
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (_) { return json_({ ok: false, error: '資料格式錯誤' }); }
  try {
    const t = verifyUser_(req.idToken);
    switch (req.action) {
      case 'whoami':
        return json_({ ok: true, email: t.email, name: t.name, code: t.code,
                       linked: !!t.sheetId, sheetId: t.sheetId, folderId: t.folderId, ownerEmail: ownerEmail_() });
      case 'link':
        return json_(link_(t, req.sheetId, req.folderId));
      case 'list':
        needLinked_(t);
        return json_(Object.assign({ ok: true }, readQuestions_(t)));
      case 'save':
        needLinked_(t);
        return json_(saveQuestions_(t, req.questions, req.baseVersion));
    }
    throw fail_('未知的操作');
  } catch (err) {
    return json_({ ok: false, error: err.message, code: err.code || '' });
  }
}

/* =========================================================
 * 登入驗證：Google ID Token + teachers 名單
 * ========================================================= */
function verifyUser_(idToken) {
  if (!idToken) throw fail_('請先用 Google 帳號登入。', 'auth');
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
  let info = cache.get(key);
  info = info ? JSON.parse(info) : null;
  if (!info) {
    const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
                                { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw fail_('登入已過期，請重新登入。', 'auth');
    info = JSON.parse(r.getContentText());
    if (info.aud !== CLIENT_ID) throw fail_('登入憑證不屬於這個網站。', 'auth');
    if (['accounts.google.com', 'https://accounts.google.com'].indexOf(info.iss) < 0) throw fail_('登入憑證來源不正確。', 'auth');
    if (String(info.email_verified) !== 'true') throw fail_('這個 Google 帳號的 email 尚未驗證。', 'auth');
    const ttl = Math.min(600, Number(info.exp) - Math.floor(Date.now() / 1000));
    if (ttl > 5) cache.put(key, JSON.stringify(info), ttl);
  }
  if (Number(info.exp) * 1000 < Date.now()) throw fail_('登入已過期，請重新登入。', 'auth');
  const email = String(info.email).toLowerCase();
  const t = findTeacher_('email', email);
  if (!t || !t.enabled) throw fail_('這個帳號（' + email + '）沒有使用權限，請聯絡管理者把你加入名單。', 'forbidden');
  return t;
}

/* =========================================================
 * teachers 名單（總表）
 * ========================================================= */
function teachers_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(T_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, T_HEAD.length).getValues().map(function (r, i) {
    return {
      row: i + 2,
      code: String(r[0]).trim().toLowerCase(),
      email: String(r[1]).trim().toLowerCase(),
      name: String(r[2]).trim(),
      enabled: r[3] === '' || r[3] === true || String(r[3]).toUpperCase() === 'TRUE',
      sheetId: String(r[4]).trim(),
      folderId: String(r[5]).trim()
    };
  }).filter(function (t) { return t.code && t.email; });
}
function findTeacher_(field, value) {
  value = String(value).trim().toLowerCase();
  return teachers_().filter(function (t) { return t[field] === value; })[0] || null;
}
function defaultTeacher_() {
  return teachers_().filter(function (t) { return t.enabled && t.sheetId; })[0] || null;
}
function ownerEmail_() { return (Session.getEffectiveUser().getEmail() || '').toLowerCase(); }
function needLinked_(t) {
  if (!t.sheetId) throw fail_('你還沒有建立題庫，請先按「建立我的題庫」。', 'unlinked');
}

/** 老師在後台按「建立我的題庫」後，記錄他的試算表和圖片資料夾 */
function link_(t, sheetId, folderId) {
  if (!/^[\w-]{20,}$/.test(sheetId || '') || !/^[\w-]{20,}$/.test(folderId || '')) throw fail_('試算表或資料夾 ID 不正確');
  let file;
  try { file = DriveApp.getFileById(sheetId); }
  catch (_) { throw fail_('管理者無法開啟你的試算表，請確認已分享給 ' + ownerEmail_() + '（編輯者）。'); }
  // 只能連結「自己擁有」的試算表，避免把別人的題庫接到自己名下
  const owner = file.getOwner() && file.getOwner().getEmail().toLowerCase();
  if (owner !== t.email) throw fail_('這份試算表的擁有者不是你（' + t.email + '）。');
  if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) throw fail_('這不是 Google 試算表');

  const ss = SpreadsheetApp.openById(sheetId);
  let qs = ss.getSheetByName(Q_SHEET);
  if (!qs) { qs = ss.getSheets()[0]; qs.setName(Q_SHEET); }
  qs.getRange(1, 1, 1, Q_HEAD.length).setValues([Q_HEAD]).setFontWeight('bold');
  qs.setFrozenRows(1);

  const sh = SpreadsheetApp.getActive().getSheetByName(T_SHEET);
  sh.getRange(t.row, 5, 1, 3).setValues([[sheetId, folderId, new Date()]]);
  CacheService.getScriptCache().remove('q_' + t.code);
  return { ok: true, code: t.code, sheetId: sheetId, folderId: folderId };
}

/* =========================================================
 * 題庫：讀取與儲存（在老師自己的試算表）
 * ========================================================= */
function questionSheet_(t) {
  let ss;
  try { ss = SpreadsheetApp.openById(t.sheetId); }
  catch (_) { throw fail_('打不開你的題庫試算表。它可能被刪除了，或沒有分享給管理者 ' + ownerEmail_() + '。'); }
  const sh = ss.getSheetByName(Q_SHEET);
  if (!sh) throw fail_('你的題庫試算表裡找不到「' + Q_SHEET + '」工作表。');
  return sh;
}

function rawRows_(sh) {
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, Q_HEAD.length).getValues()
           .filter(function (r) { return String(r[0]).trim() !== ''; });
}

/** 版本號 = 題目內容的雜湊；有人直接改試算表也會改變，用來避免互相蓋掉 */
function versionOf_(rows) {
  const data = rows.map(function (r) { return r.slice(0, DATA_COLS).map(String); });
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(data)));
}

function readQuestions_(t) {
  const rows = rawRows_(questionSheet_(t));
  return {
    version: versionOf_(rows),
    questions: rows.map(rowToQuestion_).sort(function (a, b) { return a.id - b.id; })
  };
}

function rowToQuestion_(r) {
  const o = {};
  Q_HEAD.forEach(function (h, i) { o[h] = r[i]; });
  const s = function (v) { return v == null ? '' : String(v); };
  let opts = [o.opt1, o.opt2, o.opt3, o.opt4].map(s);
  let imgs = [o.optImg1, o.optImg2, o.optImg3, o.optImg4].map(s);
  let n = 4;
  while (n > 0 && !opts[n - 1] && !imgs[n - 1]) n--;           // 去掉後面空白的選項
  opts = opts.slice(0, n); imgs = imgs.slice(0, n);
  const ai = Number(o.answerIndex) || 0;
  return {
    id: Number(o.id),
    q: s(o.q),
    sheep: Number(o.sheep) || 1,
    image: s(o.image),
    options: opts,
    optionImages: imgs.some(Boolean) ? imgs : [],
    answerIndex: ai,
    answer: opts[ai] || ('圖片 ' + (ai + 1)),
    clue: { code: s(o.clueCode), text: s(o.clueText) }
  };
}

function saveQuestions_(t, list, baseVersion) {
  validate_(list);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = questionSheet_(t);
    const cur = rawRows_(sh);
    if (baseVersion != null && baseVersion !== versionOf_(cur)) {
      throw fail_('題目在你載入之後被修改過（可能是其他裝置或直接改了試算表）。為了不蓋掉那些修改，請先記下你改的內容，按「重新載入」後再改一次。', 'conflict');
    }
    // 沒有變動的題目保留原本的修改時間和修改者
    const old = {};
    cur.forEach(function (r) {
      old[String(r[0])] = { key: JSON.stringify(r.slice(0, DATA_COLS).map(String)), at: r[15], by: r[16] };
    });
    const now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
    const rows = list.slice().sort(function (a, b) { return a.id - b.id; }).map(function (q) {
      const opts = q.options.concat(['', '', '', '']).slice(0, 4);
      const imgs = (q.optionImages || []).concat(['', '', '', '']).slice(0, 4);
      const r = [q.id, q.q, q.sheep || 1, q.image || ''].concat(opts, imgs,
                [q.answerIndex, (q.clue && q.clue.code) || '', (q.clue && q.clue.text) || '']).map(String);
      const prev = old[String(q.id)];
      const same = prev && prev.key === JSON.stringify(r);
      return r.map(safeCell_).concat([same ? String(prev.at) : now, same ? String(prev.by) : t.email]);
    });
    if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, Q_HEAD.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, Q_HEAD.length).setNumberFormat('@').setValues(rows);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('q_' + t.code);
    return Object.assign({ ok: true }, readQuestions_(t));
  } finally {
    lock.releaseLock();
  }
}

function validate_(list) {
  if (!Array.isArray(list)) throw fail_('資料格式錯誤');
  if (list.length > 300) throw fail_('題目太多（最多 300 題）');
  const seen = {};
  list.forEach(function (q) {
    if (!(Number.isInteger(q.id) && q.id >= 1)) throw fail_('題號要是 1 以上的整數');
    if (seen[q.id]) throw fail_('題號 ' + q.id + ' 重複了');
    seen[q.id] = true;
    if (!q.q || String(q.q).length > 300) throw fail_('第 ' + q.id + ' 題的題目是空的或太長');
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) throw fail_('第 ' + q.id + ' 題要有 2～4 個選項');
    if (!(q.answerIndex >= 0 && q.answerIndex < q.options.length)) throw fail_('第 ' + q.id + ' 題沒有設定正確答案');
    [q.image].concat(q.optionImages || []).forEach(function (u) {
      if (u && !/^(https:\/\/|images\/)/.test(u)) throw fail_('第 ' + q.id + ' 題有圖片還沒上傳完成');
    });
  });
}

/** 開頭是 = 的文字加上 '，避免被試算表當成公式 */
function safeCell_(v) { return /^=/.test(v) ? "'" + v : v; }

/* =========================================================
 * 小工具
 * ========================================================= */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function fail_(message, code) { const e = new Error(message); e.code = code || ''; return e; }

/* =========================================================
 * 管理者在 Apps Script 編輯器手動執行的函式
 * ========================================================= */

/** 1. 第一次使用：建立 teachers 工作表，並把管理者自己加進去（代碼 main） */
function setup() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(T_SHEET) || ss.insertSheet(T_SHEET);
  sh.getRange(1, 1, 1, T_HEAD.length).setValues([T_HEAD]).setFontWeight('bold');
  sh.setFrozenRows(1);
  const owner = ownerEmail_();
  if (sh.getLastRow() < 2 && owner) sh.appendRow(['main', owner, '管理者', true, '', '', '']);
  // 讓授權畫面一次把需要的權限都要齊
  DriveApp.getRootFolder(); UrlFetchApp.getRequest('https://www.google.com');
  Logger.log('完成！請到 teachers 工作表確認。接著部署網頁應用程式，並在後台登入建立你的題庫。');
}

/**
 * 2. 把 GitHub 網站上的 questions.json 和 images/ 圖片搬到「main」老師（管理者自己）的題庫。
 *    請先在後台登入並按「建立我的題庫」，再執行這個函式（只需執行一次）。
 */
function importFromSite() {
  const t = findTeacher_('code', 'main');
  if (!t || !t.sheetId || !t.folderId) throw new Error('請先在後台用管理者帳號登入，按「建立我的題庫」');
  const folder = DriveApp.getFolderById(t.folderId);
  const list = JSON.parse(UrlFetchApp.fetch(SITE_URL + 'questions.json?_=' + Date.now()).getContentText());
  const moved = {};
  const move = function (u) {
    if (!u || /^https:\/\//.test(u)) return u || '';
    if (moved[u]) return moved[u];
    const blob = UrlFetchApp.fetch(SITE_URL + u).getBlob().setName(u.split('/').pop());
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return (moved[u] = 'https://lh3.googleusercontent.com/d/' + file.getId());
  };
  list.forEach(function (q) {
    q.image = move(q.image);
    q.optionImages = (q.optionImages || []).map(move);
    if (q.answerIndex == null) q.answerIndex = Math.max(0, q.options.indexOf(q.answer));
  });
  const r = saveQuestions_(t, list, null);
  Logger.log('匯入 ' + r.questions.length + ' 題，搬移 ' + Object.keys(moved).length + ' 張圖片。');
}
