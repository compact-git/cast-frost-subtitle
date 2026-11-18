/* Cast Frost 字幕(補助exe)
 * Cast Frost Web から字幕のデータを受け取り(127.0.0.1 の WebSocket)、
 * 自分の画面に「枠なし・透明・最前面・クリックが通り抜ける」窓で表示する。
 * あわせて、アプリが登録した「全体ホットキー」を Windows に登録し、押されたらアプリへ知らせる
 * (ゲーム中などブラウザが手前にない時でもエフェクトを出せるように)。
 * YouTube Live のチャットも、アプリの代わりにこのPCから読む(ブラウザからは直接読めないため)。
 * OBS 用の「動画プレーヤー」(http://localhost:ポート/player)も出す。フリップの「Twitch 動画」を OBS で流すためのページ
 * (Twitch の埋め込みは、パソコンに保存したファイルでは動かないので、このPCの中だけで見られるページとして出す)。
 */
'use strict';
const { app, BrowserWindow, Tray, Menu, screen, globalShortcut, ipcMain, dialog, shell, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');
const youtube = require('./youtube');

const VERSION = app.getVersion();
const NAME = 'Cast Frost 字幕';
const SHORTCUT = 'Control+Alt+C';          // 位置とサイズの調整
const SHORTCUT_LABEL = 'Ctrl+Alt+C';
const PROTOCOL = 'castfrost';
const APP_ID = 'castfrost';                // アプリ → exe
const EXE_ID = 'castfrost-exe';            // exe → アプリ
const DEFAULT_PORT = 50230;                // Yomi Frost 字幕(50210)と同時に使えるように別の番号
/** exe の本当の場所(portable 版は一時フォルダに展開して動くので、元の exe の場所を使う) */
const EXE_PATH = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
const DEFAULT_ORIGINS = ['https://cast.rider.tokyo', 'https://*.pages.dev', 'http://localhost:*', 'http://127.0.0.1:*'];
const MAX_HOTKEYS = 40;

// ---------- 設定(ユーザーデータのフォルダに保存) ----------
let cfgPath = '';
let cfg = { port: DEFAULT_PORT, displayId: null, bounds: null, origins: DEFAULT_ORIGINS, visible: true, hotkeysOn: true };
function loadCfg() {
  cfgPath = path.join(app.getPath('userData'), 'config.json');
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(cfgPath, 'utf8'))); } catch (e) { /* 初回 */ }
  if (!Array.isArray(cfg.origins) || !cfg.origins.length) cfg.origins = DEFAULT_ORIGINS;
  if (!Number.isInteger(Number(cfg.port)) || cfg.port < 1024 || cfg.port > 65535) cfg.port = DEFAULT_PORT;
}
function saveCfg() { try { fs.mkdirSync(path.dirname(cfgPath), { recursive: true }); fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); } catch (e) {} }

/** 接続してよいページか(ほかのサイトから勝手に字幕を出されないように) */
function originOk(origin) {
  if (!origin || origin === 'null') return false;
  return cfg.origins.some(p => {
    const re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$', 'i');
    return re.test(origin);
  });
}

// ---------- 窓 ----------
let win = null, tray = null, wss = null, server = null, editing = false, clients = 0, lastPayload = null;
const players = new Set();     // OBS の動画プレーヤー(/player)のつながり
const vids = new Map();        // 流している最中の Twitch 動画(key → アプリから来た start のメッセージ)。後から開いたプレーヤーにも送る
function targetDisplay() {
  const all = screen.getAllDisplays();
  return all.find(d => d.id === cfg.displayId) || screen.getPrimaryDisplay();
}
function fullBounds() { return targetDisplay().bounds; }
function createWindow() {
  const b = cfg.bounds || fullBounds();
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true, frame: false, hasShadow: false, resizable: false, movable: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false, backgroundColor: '#00000000',
    title: NAME, icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.setAlwaysOnTop(true, 'screen-saver');           // 全画面のゲームなどより手前に
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });  // クリックは後ろの窓へ通り抜ける
  // http://localhost から開く(Twitch の埋め込みを使うため)。開けない時は、パソコンの中のファイルで開く
  let tries = 0;
  const open = () => win.loadURL(`http://localhost:${cfg.port}/overlay.html`).catch(() => {});
  win.webContents.on('did-fail-load', (_e, code, _d, url, isMain) => {
    if (!isMain || !/^http:\/\/localhost/.test(url || '')) return;   // 中の Twitch の枠などの失敗は無視
    if (++tries <= 6) setTimeout(open, 500); else win.loadFile(path.join(__dirname, 'overlay.html'));
  });
  setTimeout(open, 200);
  win.once('ready-to-show', () => { if (cfg.visible !== false) win.showInactive(); sendState(); });
  const remember = () => { if (editing && win) { cfg.bounds = win.getBounds(); saveCfg(); } };
  win.on('moved', remember); win.on('resized', remember);
  win.on('closed', () => { win = null; });
}
function setEditing(on) {
  editing = !!on;
  if (!win) return;
  if (editing && !win.isVisible()) { win.showInactive(); cfg.visible = true; }
  win.setIgnoreMouseEvents(!editing, { forward: true });
  win.setResizable(editing); win.setMovable(editing); win.setFocusable(editing);
  if (editing) win.focus();
  sendState(); buildMenu();
}
function sendState() {
  if (win) win.webContents.send('state', { editing, clients, port: cfg.port, version: VERSION, shortcut: SHORTCUT_LABEL });
}
function resetBounds() {
  cfg.bounds = null; saveCfg();
  if (win) win.setBounds(fullBounds());
}
function setVisible(v) {
  cfg.visible = v; saveCfg();
  if (!win) return;
  if (v) win.showInactive(); else win.hide();
  buildMenu();
}

// ---------- 全体ホットキー(アプリから登録される) ----------
/** 今登録しているホットキー: accelerator → {id, label} */
let hotkeys = new Map();
/** Electron の accelerator として受け付ける形か(Ctrl/Alt/Shift/Win + キー) */
function validAccel(a) {
  if (typeof a !== 'string' || a.length > 60) return false;
  const parts = a.split('+');
  if (parts.length < 2) return false;   // 修飾キーなしの単独キーは、ふだんの入力を奪うので受け付けない
  const mods = /^(Control|Ctrl|Alt|Shift|Super|Meta|CommandOrControl|CmdOrCtrl)$/i;
  const key = parts.pop();
  if (!parts.every(p => mods.test(p))) return false;
  return /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Num[0-9]|num[0-9]|Space|Tab|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|[-=\[\];',./`\\])$/i.test(key);
}
function clearHotkeys() {
  for (const a of hotkeys.keys()) { try { globalShortcut.unregister(a); } catch (e) {} }
  hotkeys = new Map();
}
/** アプリから届いた一覧で登録し直し、結果(登録できた/できなかった)を返す */
function setHotkeys(list) {
  clearHotkeys();
  const results = [];
  if (!cfg.hotkeysOn) return (list || []).map(k => ({ id: String(k.id), accel: k.accel, ok: false, reason: 'off' }));
  for (const k of (Array.isArray(list) ? list.slice(0, MAX_HOTKEYS) : [])) {
    const id = String(k && k.id || '').slice(0, 64), accel = String(k && k.accel || '');
    if (!id) continue;
    if (!validAccel(accel)) { results.push({ id, accel, ok: false, reason: 'invalid' }); continue; }
    if (accel.toLowerCase() === SHORTCUT.toLowerCase() || hotkeys.has(accel)) { results.push({ id, accel, ok: false, reason: 'duplicate' }); continue; }
    let ok = false;
    try { ok = globalShortcut.register(accel, () => fireHotkey(id)); } catch (e) { ok = false; }
    if (ok) hotkeys.set(accel, { id, label: String(k.label || '').slice(0, 40) });
    results.push({ id, accel, ok, reason: ok ? '' : 'taken' });   // taken: ほかのアプリが使っている
  }
  buildMenu();
  return results;
}
function fireHotkey(id) {
  const msg = JSON.stringify({ app: EXE_ID, type: 'hotkey', id, at: Date.now() });
  if (wss) for (const c of wss.clients) { if (c.readyState === 1) { try { c.send(msg); } catch (e) {} } }
}
// ---------- YouTube Live のチャット(アプリから頼まれて読む) ----------
const YT_OPS = { resolve: d => youtube.resolve(d.q), init: d => youtube.init(d.v), next: d => youtube.next(d.body || {}), latest: d => youtube.latest(d.q, d.n), vinfo: d => youtube.vinfo(d.v) };
let ytBusy = 0;
async function ytRequest(ws, d) {
  const reqId = String(d.reqId || '').slice(0, 40);
  const reply = o => { try { if (ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ app: EXE_ID, type: 'res', reqId }, o))); } catch (e) {} };
  const op = YT_OPS[d.op];
  if (!op) return reply({ ok: false, error: { code: 'badop', message: 'unknown op' } });
  if (ytBusy >= 8) return reply({ ok: false, error: { code: 'busy', message: '補助exeが混み合っています' } });
  ytBusy++;
  try { reply({ ok: true, data: await op(d) }); }
  catch (e) { reply({ ok: false, error: { code: e.code || 'failed', status: e.status || 0, message: String(e.message || e) } }); }
  finally { ytBusy--; }
}

// ---------- DeepL(アプリから頼まれて呼ぶ。Cloudflare の中継を使わないため) ----------
const DEEPL_PATH = /^\/v2\/(translate|usage)$/;
let deeplBusy = 0;
async function deeplRequest(ws, d) {
  const reqId = String(d.reqId || '').slice(0, 40);
  const reply = o => { try { if (ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ app: EXE_ID, type: 'res', reqId }, o))); } catch (e) {} };
  const p = String(d.path || ''), key = String(d.key || '').trim();
  if (!DEEPL_PATH.test(p)) return reply({ ok: false, error: { code: 'badop', message: 'unknown path' } });
  if (!key || key.length > 200 || /[\r\n]/.test(key)) return reply({ ok: false, error: { code: 'nokey', message: 'DeepLのAPIキーがありません' } });
  if (deeplBusy >= 8) return reply({ ok: false, error: { code: 'busy', message: '補助exeが混み合っています' } });
  deeplBusy++;
  try {
    const base = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const opt = { headers: { Authorization: 'DeepL-Auth-Key ' + key }, signal: AbortSignal.timeout(12000) };
    if (d.body && p === '/v2/translate') { opt.method = 'POST'; opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(d.body); }
    const r = await fetch(base + p, opt);
    const json = await r.json().catch(() => ({}));
    reply({ ok: true, data: { status: r.status, json } });   // DeepL のエラー(403・456 など)も status で返して、アプリ側で判断する
  } catch (e) { reply({ ok: false, error: { code: 'failed', message: 'DeepLにつながりません: ' + String(e.message || e) } }); }
  finally { deeplBusy--; }
}

function setHotkeysOn(on) {
  cfg.hotkeysOn = !!on; saveCfg();
  if (!on) clearHotkeys();
  // 有効に戻した時は、アプリが次に一覧を送ってきた時に登録される(接続中ならすぐ送ってもらう)
  const msg = JSON.stringify({ app: EXE_ID, type: 'hotkeys-request' });
  if (on && wss) for (const c of wss.clients) { if (c.readyState === 1) { try { c.send(msg); } catch (e) {} } }
  buildMenu();
}

// ---------- トレイ ----------
function buildMenu() {
  if (!tray) return;
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay().id;
  const cur = targetDisplay().id;
  const hk = [...hotkeys.entries()];
  const menu = Menu.buildFromTemplate([
    { label: `${NAME} v${VERSION}`, enabled: false },
    { label: clients ? `🟢 アプリと接続中(${clients})` : `⚪ アプリを待っています(ポート ${cfg.port})`, enabled: false },
    { type: 'separator' },
    { label: `📺 OBS の動画プレーヤー:${players.size ? `🟢 OBS で開いています(${players.size})` : '⚪ OBS で開いていません'}${vids.size ? ` ・ ${vids.size} 件再生中` : ''}`, enabled: false },
    { label: '📋 動画プレーヤーの URL をコピー(OBS のブラウザソース用)', click: () => clipboard.writeText(`http://localhost:${cfg.port}/player`) },
    { type: 'separator' },
    { label: '字幕を表示する', type: 'checkbox', checked: cfg.visible !== false, click: m => setVisible(m.checked) },
    { label: `位置とサイズを調整する(${SHORTCUT_LABEL})`, type: 'checkbox', checked: editing, click: m => setEditing(m.checked) },
    { label: '画面いっぱいに戻す', click: resetBounds },
    {
      label: '表示するモニター', submenu: displays.map((d, i) => ({
        label: `モニター${i + 1}(${d.size.width}×${d.size.height})${d.id === primary ? ' ・メイン' : ''}`, type: 'radio', checked: d.id === cur,
        click: () => { cfg.displayId = d.id; cfg.bounds = null; saveCfg(); if (win) win.setBounds(fullBounds()); buildMenu(); },
      })),
    },
    { type: 'separator' },
    { label: 'エフェクトのホットキーを使う', type: 'checkbox', checked: cfg.hotkeysOn !== false, click: m => setHotkeysOn(m.checked) },
    {
      label: `登録中のホットキー(${hk.length})`, enabled: hk.length > 0,
      submenu: hk.length ? hk.map(([a, v]) => ({ label: `${a.replace(/Control/g, 'Ctrl')} … ${v.label || v.id}`, enabled: false })) : [{ label: 'なし', enabled: false }],
    },
    { type: 'separator' },
    { label: 'Windows の起動時に起動する', type: 'checkbox', checked: loginItem(), click: m => setLoginItem(m.checked) },
    { label: '設定ファイルを開く(ポート・許可するサイト)', click: () => { saveCfg(); shell.openPath(cfgPath); } },
    { label: '終了', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(clients ? `${NAME}:アプリと接続中` : `${NAME}:アプリを待っています`);
}

// ---------- サーバー(127.0.0.1 だけで待つ):WebSocket と、OBS 用の動画プレーヤーのページ ----------
const JS = 'text/javascript; charset=utf-8', HTML = 'text/html; charset=utf-8';
const PAGES = { '/player': ['player.html', HTML], '/twplay.js': ['twplay.js', JS],
  // 字幕の窓も http://localhost から開く(Twitch の埋め込みは、パソコンの中のファイルでは動かないため)
  '/overlay.html': ['overlay.html', HTML], '/overlay.js': ['overlay.js', JS], '/overlay-fx.js': ['overlay-fx.js', JS], '/subrender.js': ['subrender.js', JS], '/fxengine.js': ['fxengine.js', JS] };
// ---- OBS 用のページ(字幕・演出):中身はアプリが作って送ってくる(OBS の接続先・パスワード入り)。この PC の中だけで開ける ----
const OBS_PAGES = ['sub', 'fx'];
const obsPages = {};
const obsDir = () => path.join(app.getPath('userData'), 'obs-pages');
function loadObsPages() { OBS_PAGES.forEach(k => { try { obsPages[k] = fs.readFileSync(path.join(obsDir(), k + '.html'), 'utf8'); } catch (e) {} }); }
function saveObsPages(pages) {
  try { fs.mkdirSync(obsDir(), { recursive: true }); } catch (e) {}
  OBS_PAGES.forEach(k => {
    const h = pages && pages[k];
    if (typeof h !== 'string' || h.length > 3 * 1024 * 1024 || !/^\s*<!DOCTYPE html>/i.test(h)) return;
    obsPages[k] = h;
    try { fs.writeFileSync(path.join(obsDir(), k + '.html'), h, 'utf8'); } catch (e) {}
  });
}
const WAIT_PAGE = '<!DOCTYPE html><meta charset="utf-8"><body style="margin:0;background:transparent;font:700 16px sans-serif;color:#fff"><div style="position:fixed;left:10px;bottom:10px;background:rgba(20,10,40,.7);padding:4px 10px;border-radius:8px">Cast Frost:アプリを開くと表示されます</div><script>setTimeout(()=>location.reload(),3000)</script>';
function serveHttp(req, res) {
  const u = String(req.url || '/').split('?')[0];
  const om = u.match(/^\/obs\/(sub|fx)\/?$/);
  if (om && req.method === 'GET') { res.writeHead(200, { 'Content-Type': HTML, 'Cache-Control': 'no-store' }); res.end(obsPages[om[1]] || WAIT_PAGE); return; }
  const pg = PAGES[u === '/player/' ? '/player' : u];
  if (req.method !== 'GET' || !pg) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(`${NAME}: OBS の動画プレーヤーは http://localhost:${cfg.port}/player です`); return; }
  fs.readFile(path.join(__dirname, pg[0]), (err, buf) => {
    if (err) { res.writeHead(500); res.end('read error'); return; }
    res.writeHead(200, { 'Content-Type': pg[1], 'Cache-Control': 'no-store' }); res.end(buf);
  });
}
/** アプリ(プレーヤー以外のつながり)へ送る */
const toApps = obj => { const s = JSON.stringify(obj); let n = 0; if (wss) wss.clients.forEach(c => { if (!players.has(c) && c.readyState === 1) { try { c.send(s); n++; } catch (e) {} } }); return n; };
const playersChanged = () => { buildMenu(); toApps({ app: EXE_ID, type: 'players', n: players.size }); };
const toPlayers = obj => { const s = JSON.stringify(obj); players.forEach(p => { try { p.send(s); } catch (e) {} }); };
function onVid(d) {
  if (d.cmd === 'start' && d.key) { vids.set(d.key, d); if (!d.hold && d.durMs > 0) setTimeout(() => { if (vids.get(d.key) === d) vids.delete(d.key); }, d.durMs + 1000); }
  else if (d.cmd === 'stop' && d.key) vids.delete(d.key);
  else if (d.cmd === 'stopAll') vids.clear();
  toPlayers(Object.assign({}, d, { app: EXE_ID, type: 'vid' }));
  buildMenu();
}
function startServer() {
  server = http.createServer(serveHttp);
  wss = new WebSocketServer({
    server, maxPayload: 4 * 1024 * 1024,
    verifyClient: (info, cb) => { const ok = originOk(info.origin); if (!ok) console.warn('拒否:', info.origin); cb(ok, 403, 'Forbidden origin'); },
  });
  wss.on('connection', (ws, req) => {
    // OBS の動画プレーヤー(/player のページ)
    if (String(req.url || '').startsWith('/player')) {
      players.add(ws); playersChanged();
      // プレーヤーから:クリップの動画ファイルの URL がほしい → アプリ(Twitch の OAuth を持っている)に頼む
      ws.on('message', raw => {
        let d; try { d = JSON.parse(String(raw)); } catch (e) { return; }
        if (!d || d.type !== 'need-clip' || !d.rid) return;
        const s = JSON.stringify({ app: EXE_ID, type: 'need-clip', rid: String(d.rid).slice(0, 40), id: String(d.id || '').slice(0, 120), bid: String(d.bid || '').slice(0, 40) });
        const sent = toApps(JSON.parse(s)) > 0;
        if (!sent) try { ws.send(JSON.stringify({ app: EXE_ID, type: 'clip-url', rid: d.rid, url: null })); } catch (e) {}
      });
      vids.forEach(d => { try { ws.send(JSON.stringify(Object.assign({}, d, { app: EXE_ID, type: 'vid' }))); } catch (e) {} });
      ws.on('close', () => { players.delete(ws); playersChanged(); });
      return;
    }
    clients++; sendState(); buildMenu();
    // 保存場所(表示用)と、ホットキー・YouTube・動画プレーヤーに対応していることをアプリに伝える
    ws.send(JSON.stringify({ app: EXE_ID, version: VERSION, path: EXE_PATH, features: ['subtitle', 'hotkeys', 'youtube', 'player', 'fx', 'obspages', 'overlay-http', 'deepl', 'ytlatest', 'ytvinfo'], hotkeysOn: cfg.hotkeysOn !== false, playerUrl: `http://localhost:${cfg.port}/player`, players: players.size }));
    if (lastPayload && win) win.webContents.send('payload', lastPayload);
    ws.on('message', raw => {
      let d; try { d = JSON.parse(String(raw)); } catch (e) { return; }
      if (!d || d.app !== APP_ID) return;
      if (d.type === 'yt') { ytRequest(ws, d); return; }
      if (d.type === 'deepl') { deeplRequest(ws, d); return; }
      if (d.type === 'vid') { onVid(d); return; }
      if (d.type === 'obs-pages') { saveObsPages(d.pages); try { ws.send(JSON.stringify({ app: EXE_ID, type: 'obs-pages-ok', have: OBS_PAGES.filter(k => obsPages[k]) })); } catch (e) {} return; }
      if (d.type === 'clip-url') { toPlayers({ app: EXE_ID, type: 'clip-url', rid: d.rid, url: d.url || null }); if (win) win.webContents.send('clip-url', { rid: d.rid, url: d.url || null }); return; }
      if (d.type === 'fx') { if (win && d.m) win.webContents.send('fx', d.m); return; }   // 演出・フリップ(自分の画面の窓に出す)   // クリップの動画ファイルの URL(プレーヤーが頼んだもの)
      if (d.type === 'hotkeys') {
        const results = setHotkeys(d.keys);
        try { ws.send(JSON.stringify({ app: EXE_ID, type: 'hotkeys-result', results, hotkeysOn: cfg.hotkeysOn !== false })); } catch (e) {}
        return;
      }
      if (!d.boxes) return;   // 字幕
      lastPayload = d;
      if (win) win.webContents.send('payload', d);
    });
    ws.on('close', () => {
      clients = Math.max(0, clients - 1);
      if (!clients) { clearHotkeys(); vids.clear(); toPlayers({ app: EXE_ID, type: 'vid', cmd: 'stopAll' }); }   // アプリを閉じたら、ホットキーを外し、流している動画も止める
      sendState(); buildMenu();
    });
  });
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      dialog.showErrorBox(NAME, `ポート ${cfg.port} がほかのアプリで使われています。\n${NAME} がもう起動していないか確認してね。\n(ポートは トレイ →「設定ファイルを開く」で変えられます。アプリ側のポートも同じにしてね)`);
      app.quit();
    } else console.error(e);
  });
  server.listen(cfg.port, '127.0.0.1');
  // OBS などで localhost が IPv6(::1)になっても届くように、::1 でも待つ(使えない PC では何もしない)
  try { const s6 = http.createServer(serveHttp); s6.on('upgrade', (req, sock, head) => server.emit('upgrade', req, sock, head)); s6.on('error', () => {}); s6.listen(cfg.port, '::1'); } catch (e) {}
}

// ---------- 起動 ----------
/**
 * 自分の保存場所を Windows に登録する(castfrost:// リンクで、アプリから起動できるようにする)。
 * exe を移動・入れ替えた時も、新しい exe を一度起動すれば登録し直される。
 */
function registerProtocol() {
  try {
    if (process.defaultApp) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '.')]);
    else app.setAsDefaultProtocolClient(PROTOCOL, EXE_PATH, []);
  } catch (e) { console.warn('protocol', e); }
}
function loginItem() { try { return app.getLoginItemSettings({ path: EXE_PATH }).openAtLogin; } catch (e) { return false; } }
function setLoginItem(on) { try { app.setLoginItemSettings({ openAtLogin: !!on, path: EXE_PATH }); } catch (e) {} buildMenu(); }
const fromLink = argv => (argv || []).some(a => String(a).toLowerCase().startsWith(PROTOCOL + '://'));

registerProtocol();
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', (_e, argv) => {
    if (fromLink(argv)) { if (cfg.visible === false) setVisible(true); return; }   // アプリから起動された:表示するだけ
    setEditing(true);                                                            // exe をもう一度ダブルクリック:位置とサイズの調整
  });
  app.whenReady().then(() => {
    loadCfg();
    loadObsPages();
    startServer();
    createWindow();
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
    tray.on('click', () => tray.popUpContextMenu());
    buildMenu();
    if (!globalShortcut.register(SHORTCUT, () => setEditing(!editing))) console.warn('shortcut taken:', SHORTCUT);
    ipcMain.on('end-edit', () => setEditing(false));
    // 字幕の窓の演出から:素材がほしい・クリップの動画ファイルの URL がほしい → アプリに頼む
    ipcMain.on('fx-need', (_e, ids) => toApps({ app: EXE_ID, type: 'fx-need', ids: Array.isArray(ids) ? ids.slice(0, 50).map(String) : [] }));
    ipcMain.on('need-clip', (_e, d) => { if (!d || !d.rid) return; if (!toApps({ app: EXE_ID, type: 'need-clip', rid: String(d.rid).slice(0, 40), id: String(d.id || '').slice(0, 120), bid: String(d.bid || '').slice(0, 40) }) && win) win.webContents.send('clip-url', { rid: d.rid, url: null }); });
    screen.on('display-removed', () => { if (!cfg.bounds && win) win.setBounds(fullBounds()); buildMenu(); });
    screen.on('display-added', buildMenu);
  });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); if (wss) wss.close(); if (server) server.close(); });
  app.on('window-all-closed', () => app.quit());
}
