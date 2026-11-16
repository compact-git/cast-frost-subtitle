/* Cast Frost 字幕(補助exe)
 * Cast Frost Web から字幕のデータを受け取り(127.0.0.1 の WebSocket)、
 * 自分の画面に「枠なし・透明・最前面・クリックが通り抜ける」窓で表示する。
 * あわせて、アプリが登録した「全体ホットキー」を Windows に登録し、押されたらアプリへ知らせる
 * (ゲーム中などブラウザが手前にない時でもエフェクトを出せるように)。
 */
'use strict';
const { app, BrowserWindow, Tray, Menu, screen, globalShortcut, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

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
let win = null, tray = null, wss = null, editing = false, clients = 0, lastPayload = null;
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');           // 全画面のゲームなどより手前に
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });  // クリックは後ろの窓へ通り抜ける
  win.loadFile(path.join(__dirname, 'overlay.html'));
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

// ---------- WebSocket サーバー(127.0.0.1 だけで待つ) ----------
function startServer() {
  wss = new WebSocketServer({
    host: '127.0.0.1', port: cfg.port, maxPayload: 4 * 1024 * 1024,
    verifyClient: (info, cb) => { const ok = originOk(info.origin); if (!ok) console.warn('拒否:', info.origin); cb(ok, 403, 'Forbidden origin'); },
  });
  wss.on('connection', ws => {
    clients++; sendState(); buildMenu();
    // 保存場所(表示用)と、ホットキーに対応していることをアプリに伝える
    ws.send(JSON.stringify({ app: EXE_ID, version: VERSION, path: EXE_PATH, features: ['subtitle', 'hotkeys'], hotkeysOn: cfg.hotkeysOn !== false }));
    if (lastPayload && win) win.webContents.send('payload', lastPayload);
    ws.on('message', raw => {
      let d; try { d = JSON.parse(String(raw)); } catch (e) { return; }
      if (!d || d.app !== APP_ID) return;
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
      if (!clients) clearHotkeys();   // アプリを閉じたら、ほかのアプリのじゃまをしないようにホットキーを外す
      sendState(); buildMenu();
    });
  });
  wss.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      dialog.showErrorBox(NAME, `ポート ${cfg.port} がほかのアプリで使われています。\n${NAME} がもう起動していないか確認してね。\n(ポートは トレイ →「設定ファイルを開く」で変えられます。アプリ側のポートも同じにしてね)`);
      app.quit();
    } else console.error(e);
  });
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
    createWindow();
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
    tray.on('click', () => tray.popUpContextMenu());
    buildMenu();
    startServer();
    if (!globalShortcut.register(SHORTCUT, () => setEditing(!editing))) console.warn('shortcut taken:', SHORTCUT);
    ipcMain.on('end-edit', () => setEditing(false));
    screen.on('display-removed', () => { if (!cfg.bounds && win) win.setBounds(fullBounds()); buildMenu(); });
    screen.on('display-added', buildMenu);
  });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); if (wss) wss.close(); });
  app.on('window-all-closed', () => app.quit());
}
