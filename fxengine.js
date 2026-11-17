/* Cast Frost Web - エフェクトの描画エンジン(アプリのプレビューと、OBS用エフェクトファイルで共用)
 *
 * エフェクトは「設定ファイル(JSON)」だけで表す。プログラムは含めない(AIで作った時も、ここで形と値の範囲を確かめてから使う)。
 * 画面は 1920×1080 の座標で作り、表示する場所の大きさに合わせて拡大・縮小する。
 */
(function (root) {
  'use strict';
  const W = 1920, H = 1080;
  const FONTS = ['Dela Gothic One', 'M PLUS Rounded 1c', 'Noto Sans JP', 'Kosugi Maru', 'Zen Kaku Gothic New'];
  const ANIM_IN = ['none', 'fade', 'pop', 'zoom', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'drop', 'spin'];
  const ANIM_OUT = ['none', 'fade', 'pop', 'zoom', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'drop', 'spin'];
  const LOOPS = ['none', 'shake', 'bounce', 'pulse', 'spin', 'float', 'swing', 'rainbow', 'ssBounce', 'ssDrift', 'ssTickerH', 'ssTickerV', 'ssCircle', 'ssEight', 'ssEdge'];
  const LAYER_TYPES = ['text', 'image', 'video', 'sound', 'particles', 'flash', 'shake', 'board', 'twitch'];
  const TW_SRC = ['clips', 'videos', 'list'], TW_PERIOD = ['week', 'month', 'year', 'all'], TW_VTYPE = ['all', 'archive', 'highlight', 'upload'], TW_ORDER = ['expand', 'random', 'inOrder'];
  const PLATES = ['solid', 'grad', 'none'];
  const PARTICLE_MODES = ['confetti', 'rain', 'burst', 'float', 'snow'];
  const VARS = ['name', 'num', 'unit', 'amount', 'currency', 'message', 'count', 'months', 'tier', 'reward', 'viewers', 'level', 'kind'];

  // ================= 形と値の範囲のチェック(AIの出力・読み込んだファイルにも使う) =================
  const num = (v, min, max, def) => { v = Number(v); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };
  const str = (v, max, def) => (typeof v === 'string' ? v.slice(0, max) : (v == null ? def : String(v).slice(0, max)));
  const oneOf = (v, list, def) => (list.includes(v) ? v : def);
  const color = (v, def) => (typeof v === 'string' && /^(#[0-9a-fA-F]{3,8}|transparent)$/.test(v.trim()) ? v.trim() : def);
  const bool = (v, def) => (typeof v === 'boolean' ? v : def);
  const id = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : '');
  function cleanLayer(l, errors, i) {
    if (!l || typeof l !== 'object') { errors.push(`${i + 1}番目の部品の形が正しくありません`); return null; }
    const type = l.type;
    if (!LAYER_TYPES.includes(type)) { errors.push(`${i + 1}番目の部品の種類「${String(type).slice(0, 20)}」は使えません`); return null; }
    const o = {
      type, start: num(l.start, 0, 60, 0), dur: l.dur == null || l.dur === '' ? null : num(l.dur, 0.1, 120, null),
      x: num(l.x, -50, 150, 50), y: num(l.y, -50, 150, 50), scale: num(l.scale, 0.05, 10, 1), rot: num(l.rot, -360, 360, 0), opacity: num(l.opacity, 0, 1, 1),
      in: oneOf(l.in, ANIM_IN, 'pop'), out: oneOf(l.out, ANIM_OUT, 'fade'), loop: oneOf(l.loop, LOOPS, 'none'),
      inDur: num(l.inDur, 0, 5, 0.4), outDur: num(l.outDur, 0, 5, 0.4), speed: num(l.speed, 0.1, 5, 1),
    };
    if (type === 'text') Object.assign(o, {
      text: str(l.text, 200, 'テキスト'), font: oneOf(l.font, FONTS, FONTS[0]), size: num(l.size, 8, 400, 72),
      color: color(l.color, '#ffffff'), stroke: color(l.stroke, '#1b1036'), strokeW: num(l.strokeW, 0, 40, 8), bg: color(l.bg, 'transparent'),
      maxW: num(l.maxW, 10, 100, 90),
    });
    // 画像・動画の大きさ:size=100 で「元の縦横比のまま画面いっぱい」(はみ出さない最大)。古い w(画面の横幅に対する%)は size に読み替える
    const size = (def) => num(l.size != null ? l.size : l.w, 1, 300, def);
    if (type === 'image') Object.assign(o, { asset: id(l.asset), emoji: str(l.emoji, 16, ''), size: size(l.asset ? 100 : 30) });
    if (type === 'video') Object.assign(o, { asset: id(l.asset), size: size(100), volume: num(l.volume, 0, 1, 0.8), chroma: bool(l.chroma, false) });
    if (type === 'sound') Object.assign(o, { asset: id(l.asset), volume: num(l.volume, 0, 1, 0.8) });
    if (type === 'particles') Object.assign(o, { emoji: str(l.emoji, 40, '🎉🎊✨'), asset: id(l.asset), count: num(l.count, 1, 200, 40), mode: oneOf(l.mode, PARTICLE_MODES, 'confetti'), size: num(l.size, 8, 300, 56) });
    if (type === 'flash') Object.assign(o, { color: color(l.color, '#ffffff'), power: num(l.power, 0, 1, 0.7) });
    if (type === 'board') Object.assign(o, {
      text: str(l.text, 300, 'ただいま離席中です'), font: oneOf(l.font, FONTS, 'M PLUS Rounded 1c'), color: color(l.color, '#ffffff'),
      plate: oneOf(l.plate, PLATES, 'solid'), plateColor: color(l.plateColor, l.plate === 'grad' ? '#22d3ee' : '#12102a'), stroke: color(l.stroke, '#1b1036'), strokeW: num(l.strokeW, 0, 40, 10),
      size: num(l.size, 1, 300, 50), aspect: num(l.aspect, 0.1, 12, 16 / 9), textPct: num(l.textPct, 10, 100, 70),
    });
    if (type === 'shake') Object.assign(o, { power: num(l.power, 1, 80, 18) });
    // 🎬 Twitch 動画(フリップ用):配信者自身のクリップ・動画を次々に流す。流すものの一覧(items)はアプリが再生の直前に Twitch から取ってくる
    if (type === 'twitch') Object.assign(o, {
      src: oneOf(l.src, TW_SRC, 'clips'), period: oneOf(l.period, TW_PERIOD, 'all'), vtype: oneOf(l.vtype, TW_VTYPE, 'all'), urls: str(l.urls, 2000, ''),
      order: oneOf(l.order, TW_ORDER, 'expand'), excerptMin: num(l.excerptMin, 0, 600, 0.5), volume: num(l.volume, 0, 1, 0.6), size: num(l.size, 5, 100, 60),
    });
    if ((type === 'video' || type === 'sound') && !o.asset) errors.push(`${i + 1}番目の部品(${type === 'video' ? '動画' : '音'})の素材が選ばれていません`);
    return o;
  }
  /** エフェクトの設定を確かめて、使える形に直す。{ ok, effect, errors } */
  function validate(e) {
    const errors = [];
    if (!e || typeof e !== 'object' || Array.isArray(e)) return { ok: false, effect: null, errors: ['エフェクトの形(JSON のオブジェクト)ではありません'] };
    const t = e.trigger && typeof e.trigger === 'object' ? e.trigger : {};
    const kinds = Array.isArray(t.kinds) ? t.kinds.filter(k => typeof k === 'string' && /^[a-z]{2,20}$/.test(k)).slice(0, 30) : [];
    const effect = {
      v: 1, id: id(e.id) || ('e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      name: str(e.name, 40, '新しいエフェクト') || '新しいエフェクト', icon: str(e.icon, 8, '✨') || '✨', enabled: bool(e.enabled, true),
      trigger: {
        kinds, minAmount: num(t.minAmount, 0, 1e9, 0), maxAmount: num(t.maxAmount, 0, 1e9, 0),
        keywords: str(t.keywords, 300, ''), keywordMode: oneOf(t.keywordMode, ['contains', 'exact', 'command'], 'contains'),
        reward: str(t.reward, 80, ''), manual: bool(t.manual, true), hotkey: str(t.hotkey, 60, ''),
      },
      cooldown: num(e.cooldown, 0, 3600, 0), mode: oneOf(e.mode, ['queue', 'overlap'], 'queue'),
      duration: num(e.duration, 0.3, 120, 5),
      // ボタン(フリップ)用:once=押すたびに1回 / toggle=押すと出しっぱなし、もう一度で消す。z=重なり順(大きいほど上)。bgm=BGM の素材
      btnMode: oneOf(e.btnMode, ['once', 'toggle'], 'once'), z: num(e.z, 1, 9, 5), bgm: id(e.bgm), bgmVol: num(e.bgmVol, 0, 1, 0.8), bgmLoop: bool(e.bgmLoop, false),
      layers: [],
    };
    const ls = Array.isArray(e.layers) ? e.layers.slice(0, 30) : [];
    if (!ls.length) errors.push('部品(文字・画像など)が1つもありません');
    ls.forEach((l, i) => { const c = cleanLayer(l, errors, i); if (c) effect.layers.push(c); });
    return { ok: effect.layers.length > 0, effect, errors };
  }
  /** {name} などを差し込む */
  function fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null && vars[k] !== '' ? String(vars[k]) : (VARS.includes(k) ? '' : m)));
  }

  // ================= 描画 =================
  const CSS = `
  .cfx-root{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;overflow:hidden;pointer-events:none}
  .cfx-fx{position:absolute;inset:0}
  .cfx-l{position:absolute;left:0;top:0;transform-origin:50% 50%;will-change:transform,opacity}
  .cfx-in{display:inline-block;vertical-align:top;transform-origin:50% 50%}
  .cfx-text{white-space:pre-wrap;text-align:center;line-height:1.15;font-weight:800;paint-order:stroke fill}
  .cfx-flash{position:absolute;inset:0}
  .cfx-p{position:absolute;left:0;top:0;line-height:1;will-change:transform,opacity}
  .cfx-plate{border-radius:28px;display:flex;align-items:center;justify-content:center;box-sizing:border-box}
  .cfx-ptext{width:100%;height:100%;box-sizing:border-box;padding:6% 7%;display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre-wrap;word-break:break-word;line-height:1.2;font-weight:800;overflow:hidden}
  `;
  function ensureCss(doc) {
    if (doc.getElementById('cfx-css')) return;
    const s = doc.createElement('style'); s.id = 'cfx-css'; s.textContent = CSS; doc.head.appendChild(s);
  }
  /** 表示する場所(host)の中に 1920×1080 の舞台を作り、大きさに合わせる */
  function mount(host) {
    ensureCss(host.ownerDocument);
    let r = host.querySelector(':scope > .cfx-root');
    if (!r) { r = host.ownerDocument.createElement('div'); r.className = 'cfx-root'; host.appendChild(r); }
    const fit = () => { const k = Math.min(host.clientWidth / W, host.clientHeight / H) || 0; r.style.transform = `translate(${(host.clientWidth - W * k) / 2}px,${(host.clientHeight - H * k) / 2}px) scale(${k})`; };
    fit();
    if (!r._ro && typeof ResizeObserver !== 'undefined') { r._ro = new ResizeObserver(fit); r._ro.observe(host); }
    return r;
  }
  const kfIn = (a, rot) => ({
    none: [{ opacity: 1 }, { opacity: 1 }],
    fade: [{ opacity: 0 }, { opacity: 1 }],
    pop: [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1.15)', offset: 0.7 }, { opacity: 1, transform: 'scale(1)' }],
    zoom: [{ opacity: 0, transform: 'scale(3)' }, { opacity: 1, transform: 'scale(1)' }],
    slideUp: [{ opacity: 0, transform: 'translateY(300px)' }, { opacity: 1, transform: 'translateY(0)' }],
    slideDown: [{ opacity: 0, transform: 'translateY(-300px)' }, { opacity: 1, transform: 'translateY(0)' }],
    slideLeft: [{ opacity: 0, transform: 'translateX(500px)' }, { opacity: 1, transform: 'translateX(0)' }],
    slideRight: [{ opacity: 0, transform: 'translateX(-500px)' }, { opacity: 1, transform: 'translateX(0)' }],
    drop: [{ opacity: 0, transform: 'translateY(-700px)' }, { opacity: 1, transform: 'translateY(30px)', offset: 0.75 }, { opacity: 1, transform: 'translateY(0)' }],
    spin: [{ opacity: 0, transform: 'rotate(-540deg) scale(.2)' }, { opacity: 1, transform: 'rotate(0) scale(1)' }],
  })[a];
  const kfOut = a => {
    const k = kfIn(a); if (!k) return null;
    return k.slice().reverse().map((f, i, arr) => Object.assign({}, f, f.offset != null ? { offset: 1 - f.offset } : {}));
  };
  const kfLoop = {
    shake: [{ transform: 'translate(0,0)' }, { transform: 'translate(-10px,4px)' }, { transform: 'translate(8px,-6px)' }, { transform: 'translate(-6px,-3px)' }, { transform: 'translate(0,0)' }],
    bounce: [{ transform: 'translateY(0)' }, { transform: 'translateY(-40px)' }, { transform: 'translateY(0)' }],
    pulse: [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
    spin: [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }],
    float: [{ transform: 'translateY(0)' }, { transform: 'translateY(-18px)' }, { transform: 'translateY(0)' }],
    swing: [{ transform: 'rotate(-10deg)' }, { transform: 'rotate(10deg)' }, { transform: 'rotate(-10deg)' }],
    rainbow: [{ filter: 'hue-rotate(0deg)' }, { filter: 'hue-rotate(360deg)' }],
  };
  const loopDur = { shake: 300, bounce: 700, pulse: 900, spin: 1500, float: 1600, swing: 1200, rainbow: 2000 };
  // タイマーは描く先の窓のものを使う(アプリのタブが裏でも、見えている小窓のタイマーは間引かれない)
  const sleep = (ms, sig, w) => new Promise(res => { const W0 = w || root; const t = W0.setTimeout(res, ms); if (sig) sig.push(() => { W0.clearTimeout(t); res(); }); });

  // ---------- 色(ボードの板) ----------
  function rgbOf(hex) {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [18, 16, 42];
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const mixc = (c, d, t) => c.map((v, i) => Math.round(v + (d[i] - v) * t));
  const lum = c => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  function hueShift(c, deg, light) {
    let [r, g, b] = c.map(v => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s2 = 0; const l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s2 = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    h = (h + deg / 360 + 1) % 1; const l2 = Math.min(1, Math.max(0, l + (light || 0)));
    const q = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2, p2 = 2 * l2 - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p2 + (q - p2) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p2 + (q - p2) * (2 / 3 - t) * 6 : p2; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
  }
  /** ボード:板(大きさ% と縦横比で決まる箱)と、その中に収まるように大きさを合わせた文字 */
  function boardEl(doc, L) {
    const bw0 = W * L.size / 100, bh0 = H * L.size / 100;
    let w, h; if (bw0 / bh0 > L.aspect) { h = bh0; w = h * L.aspect; } else { w = bw0; h = w / L.aspect; }
    const plate = doc.createElement('div'); plate.className = 'cfx-plate';
    Object.assign(plate.style, { width: w + 'px', height: h + 'px' });
    const c = rgbOf(L.plateColor);
    if (L.plate === 'solid') {
      const dark = lum(c) < 0.55;
      Object.assign(plate.style, { background: `linear-gradient(180deg,${rgba(mixc(c, [255, 255, 255], 0.08), 0.86)},${rgba(c, 0.86)})`,
        border: `3px solid ${dark ? 'rgba(255,255,255,.18)' : 'rgba(27,16,54,.12)'}`, boxShadow: '0 8px 30px rgba(0,0,0,.35)' });
    } else if (L.plate === 'grad') {
      Object.assign(plate.style, { background: `linear-gradient(135deg,${rgba(c, 0.95)},${rgba(hueShift(c, 55, -0.06), 0.95)})`, border: '3px solid rgba(255,255,255,.9)', boxShadow: '0 8px 30px rgba(0,0,0,.35)' });
    }
    const t = doc.createElement('div'); t.className = 'cfx-ptext';
    t.textContent = L.text;
    Object.assign(t.style, { fontFamily: `'${L.font}',sans-serif`, color: L.color });
    if (L.plate === 'none') Object.assign(t.style, { WebkitTextStroke: `${Math.max(2, L.strokeW)}px ${L.stroke}`, paintOrder: 'stroke fill' });
    plate.appendChild(t);
    return plate;
  }
  /** 文字を板の中に収まる、いちばん大きい大きさにする */
  function fitText(t, pct) {
    let lo = 8, hi = 600;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2; t.style.fontSize = mid + 'px';
      if (t.scrollWidth <= t.clientWidth + 1 && t.scrollHeight <= t.clientHeight + 1) lo = mid; else hi = mid;
    }
    t.style.fontSize = Math.max(8, lo * (pct || 100) / 100) + 'px';
  }

  // ---------- 画面全体を使う動き(スクリーンセーバー型) ----------
  const MOVES = ['ssBounce', 'ssDrift', 'ssTickerH', 'ssTickerV', 'ssCircle', 'ssEight', 'ssEdge'];
  function startMove(win, outer, L, bw, bh, isAlive) {
    const sw = bw * L.scale, sh = bh * L.scale, sp = L.speed;
    const ax = Math.max(0, (W - sw) / 2), ay = Math.max(0, (H - sh) / 2);
    const bx = L.x / 100 * W, by = L.y / 100 * H;
    const r = Math.random, p1 = r() * 6.28, p2 = r() * 6.28, p3 = r() * 6.28, p4 = r() * 6.28;
    let cx = W / 2, cy = H / 2, vx = (r() < 0.5 ? -1 : 1) * 260 * sp, vy = (r() < 0.5 ? -1 : 1) * 200 * sp, last = 0;
    if (L.loop === 'ssBounce') { cx = Math.min(W - sw / 2, Math.max(sw / 2, bx)); cy = Math.min(H - sh / 2, Math.max(sh / 2, by)); }
    const t0 = win.performance.now();
    const per = 2 * (2 * ax + 2 * ay) || 1;
    function frame(now) {
      if (!isAlive() || !outer.isConnected) return;
      const t = (now - t0) / 1000 * sp, dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
      switch (L.loop) {
        case 'ssBounce':
          cx += vx * dt; cy += vy * dt;
          if (cx < sw / 2) { cx = sw / 2; vx = Math.abs(vx); } if (cx > W - sw / 2) { cx = W - sw / 2; vx = -Math.abs(vx); }
          if (cy < sh / 2) { cy = sh / 2; vy = Math.abs(vy); } if (cy > H - sh / 2) { cy = H - sh / 2; vy = -Math.abs(vy); }
          break;
        case 'ssDrift': cx = W / 2 + ax * (0.65 * Math.sin(0.23 * t + p1) + 0.35 * Math.sin(0.51 * t + p2)); cy = H / 2 + ay * (0.65 * Math.sin(0.19 * t + p3) + 0.35 * Math.sin(0.43 * t + p4)); break;
        case 'ssTickerH': cx = W + sw / 2 - ((t * 220) % (W + sw)); cy = by; break;
        case 'ssTickerV': cy = H + sh / 2 - ((t * 160) % (H + sh)); cx = bx; break;
        case 'ssCircle': cx = W / 2 + ax * 0.85 * Math.cos(0.5 * t); cy = H / 2 + ay * 0.85 * Math.sin(0.5 * t); break;
        case 'ssEight': cx = W / 2 + ax * 0.85 * Math.sin(0.45 * t); cy = H / 2 + ay * 0.85 * Math.sin(0.9 * t); break;
        case 'ssEdge': {
          let d = (t * 260) % per; const wv = 2 * ax, hv = 2 * ay;
          if (d < wv) { cx = sw / 2 + d; cy = sh / 2; } else if ((d -= wv) < hv) { cx = W - sw / 2; cy = sh / 2 + d; }
          else if ((d -= hv) < wv) { cx = W - sw / 2 - d; cy = H - sh / 2; } else { d -= wv; cx = sw / 2; cy = H - sh / 2 - d; }
          break;
        }
      }
      outer.style.transform = `translate(${cx - bw / 2}px,${cy - bh / 2}px) rotate(${L.rot}deg) scale(${L.scale})`;
      win.requestAnimationFrame(frame);
    }
    win.requestAnimationFrame(frame);
  }

  /**
   * エフェクトを再生する。
   * opts: { assets: id → URL を返す関数, muted: 音を出さない, vars: 差し込む値, hold: 出しっぱなし(release() まで続ける) }
   * 戻り値:{ done: Promise, stop()(すぐ消す), release()(消えかたを見せて終える) }
   */
  function play(host, effect, opts) {
    opts = opts || {};
    const doc = host.ownerDocument, root = mount(host), win = doc.defaultView;
    const fx = doc.createElement('div'); fx.className = 'cfx-fx';
    fx.style.zIndex = String(10 + (Number(effect.z) || 5));
    // 重なり順:z の小さいものを下に
    const later = [...root.querySelectorAll(':scope > .cfx-fx')].find(n => Number(n.style.zIndex) > Number(fx.style.zIndex));
    root.insertBefore(fx, later || null);
    const stops = [], media = [], twStops = [];
    let stopped = false, released = false, relRes;
    const relP = new Promise(r => { relRes = r; });
    const hold = !!opts.hold;
    const total = hold ? Infinity : effect.duration * 1000;
    const asset = idd => (idd && opts.assets ? opts.assets(idd) : null);
    const vars = opts.vars || {};
    const alive = () => !stopped && !released;
    const waitLife = ms => (ms === Infinity ? Promise.race([relP, new Promise(r => stops.push(r))]) : sleep(ms, stops, win));
    // BGM(ボタン):出しっぱなしの間はくり返し、一回のものは最後まで(または全体の長さまで)
    if (effect.bgm && !opts.muted) {
      const u = asset(effect.bgm);
      if (u) {
        const a = new win.Audio(u); a.volume = num(effect.bgmVol, 0, 1, 0.8); a.loop = hold || !!effect.bgmLoop; media.push(a);
        a.play().catch(() => {});
      }
    }
    const jobs = effect.layers.map(L => (async () => {
      await sleep(L.start * 1000, stops, win); if (stopped) return;
      const life = L.dur != null ? Math.max(100, L.dur * 1000) : (total === Infinity ? Infinity : Math.max(100, total - L.start * 1000));
      if (L.type === 'sound') {
        const u = asset(L.asset); if (!u || opts.muted) return;
        const a = new win.Audio(u); a.volume = L.volume; a.loop = life === Infinity; media.push(a);
        try { await a.play(); } catch (e) { return; }
        await Promise.race([new Promise(r => { a.onended = r; }), waitLife(life)]);
        a.pause(); return;
      }
      if (L.type === 'flash') {
        const d = doc.createElement('div'); d.className = 'cfx-flash'; d.style.background = L.color; fx.appendChild(d);
        await d.animate([{ opacity: L.power }, { opacity: 0 }], { duration: Math.min(life, 1500), easing: 'ease-out', fill: 'forwards' }).finished.catch(() => {});
        d.remove(); return;
      }
      if (L.type === 'shake') {
        const steps = []; for (let i = 0; i < 10; i++) steps.push({ transform: `translate(${(Math.random() * 2 - 1) * L.power}px,${(Math.random() * 2 - 1) * L.power}px)` });
        steps.push({ transform: 'translate(0,0)' });
        // 舞台(root)には画面の大きさに合わせる transform が付いているので、揺れは「足し算」で重ねる(上書きすると小窓やプレビューで位置と大きさがずれる)
        let an;
        try { an = root.animate(steps, { duration: Math.min(life, 2000), easing: 'linear', composite: 'add' }); }
        catch (e) { an = fx.animate(steps, { duration: Math.min(life, 2000), easing: 'linear' }); }
        await an.finished.catch(() => {});
        return;
      }
      if (L.type === 'particles') { await particles(doc, fx, L, life, asset(L.asset), alive); return; }
      // 位置を持つ部品(文字・画像・動画・ボード)
      const outer = doc.createElement('div'); outer.className = 'cfx-l';
      const inner = doc.createElement('div'); inner.className = 'cfx-in';
      outer.appendChild(inner);
      if (L.type === 'text') {
        const t = doc.createElement('div'); t.className = 'cfx-text';
        t.textContent = fill(L.text, vars);
        Object.assign(t.style, { fontFamily: `'${L.font}',sans-serif`, fontSize: L.size + 'px', color: L.color, maxWidth: (L.maxW / 100 * W) + 'px',
          WebkitTextStroke: L.strokeW ? `${L.strokeW}px ${L.stroke}` : '', background: L.bg !== 'transparent' ? L.bg : '', padding: L.bg !== 'transparent' ? '.15em .5em' : '', borderRadius: '.3em' });
        inner.appendChild(t);
      } else if (L.type === 'image') {
        const u = asset(L.asset);
        if (u) { const im = doc.createElement('img'); im.src = u; Object.assign(im.style, { width: (L.size / 100 * W) + 'px', height: (L.size / 100 * H) + 'px', objectFit: 'contain', display: 'block' }); inner.appendChild(im); }
        else { const s = doc.createElement('div'); s.textContent = L.emoji || '⭐'; s.style.fontSize = (L.size / 100 * H * 0.85) + 'px'; s.style.lineHeight = '1'; inner.appendChild(s); }
      } else if (L.type === 'video') {
        const u = asset(L.asset); if (!u) return;
        const v = doc.createElement('video'); v.src = u; v.muted = !!opts.muted || L.volume === 0; v.volume = L.volume; v.playsInline = true; v.loop = life === Infinity;
        Object.assign(v.style, { width: (L.size / 100 * W) + 'px', height: (L.size / 100 * H) + 'px', objectFit: 'contain', display: 'block' }); inner.appendChild(v); media.push(v);
        v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
      } else if (L.type === 'board') {
        inner.appendChild(boardEl(doc, L));
      } else if (L.type === 'twitch') {
        // 16:9 の枠。小窓など(opts.twitch)では本当に流し、プレビューでは置き場所だけを見せる
        const box = doc.createElement('div');
        Object.assign(box.style, { position: 'relative', width: (L.size / 100 * W) + 'px', height: (L.size / 100 * H) + 'px', borderRadius: '10px', overflow: 'hidden' });
        inner.appendChild(box);
        if (opts.twitch && globalThis.CFTw && (opts.twitch.noEmbed || !/^file:/.test(win.location.protocol))) {   // noEmbed:動画ファイルだけで流す(補助exe の窓)
          // Twitch は「見えている」ことを自動再生の条件にしている(縮小・半透明・ほかの物に隠れていると、止まったままになる)。
          // そのため、縮小した舞台の中ではなく、表示先にそのままの大きさで重ね、いちばん上に置く(400×300 ピクセル以上が必要)
          box.style.visibility = 'hidden';
          const vbox = doc.createElement('div');
          Object.assign(vbox.style, { position: 'absolute', zIndex: '2147483000', borderRadius: '10px', overflow: 'hidden', background: '#000', pointerEvents: 'auto' });   // 押せる(Twitch の「ミュート解除」など)
          // 動画は「最前面」でないと Twitch が止めるので、opts.twitch.host(いちばん上の層)があればそこに重ねる
          const th = (opts.twitch.host && opts.twitch.host.isConnected) ? opts.twitch.host : host;
          const place = () => {
            const k = Math.min(th.clientWidth / W, th.clientHeight / H) || 0;
            let w = L.size / 100 * W * k, h = L.size / 100 * H * k;
            if (h < 300) { h = 300; w = 300 * 16 / 9; }   // Twitch は 400×300 ピクセルより小さいと自動で再生しないので、小さい窓では広げる
            Object.assign(vbox.style, { left: ((th.clientWidth - W * k) / 2 + L.x / 100 * W * k - w / 2) + 'px', top: ((th.clientHeight - H * k) / 2 + L.y / 100 * H * k - h / 2) + 'px', width: w + 'px', height: h + 'px' });
          };
          place(); th.appendChild(vbox);
          const ro = typeof win.ResizeObserver !== 'undefined' ? new win.ResizeObserver(place) : null; if (ro) ro.observe(th);
          const tw = globalThis.CFTw.run(vbox, L, opts.twitch);
          const end = () => { if (ro) ro.disconnect(); tw.stop(); vbox.remove(); };
          outer._tw = { stop: end }; twStops.push(end);
        }
        else {
          Object.assign(box.style, { background: 'repeating-linear-gradient(135deg,#2a1f4d 0 24px,#1f1740 24px 48px)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', font: '800 ' + Math.max(18, L.size / 100 * 64) + 'px sans-serif', textAlign: 'center' });
          box.textContent = '🎬 Twitch のクリップ・動画(ここに流れます)';
        }
      }
      outer.style.opacity = '0';
      fx.appendChild(outer);
      if (L.type === 'board') { const t = inner.querySelector('.cfx-ptext'); if (t) fitText(t, L.textPct); }
      // 位置:中心を x,y(%)に合わせる
      const bw = outer.offsetWidth, bh = outer.offsetHeight;
      outer.style.transform = `translate(${L.x / 100 * W - bw / 2}px,${L.y / 100 * H - bh / 2}px) rotate(${L.rot}deg) scale(${L.scale})`;
      outer.style.opacity = String(L.opacity);
      const inMs = life === Infinity ? L.inDur * 1000 : Math.min(L.inDur * 1000, life / 2), outMs = life === Infinity ? L.outDur * 1000 : Math.min(L.outDur * 1000, life / 2);
      let loopAnim = null;
      const isMove = MOVES.includes(L.loop);
      if (isMove) startMove(win, outer, L, bw, bh, () => !stopped);
      const ki = kfIn(L.in) || kfIn('fade');
      if (inMs > 0) await inner.animate(ki, { duration: inMs, easing: L.in === 'pop' || L.in === 'drop' ? 'cubic-bezier(.2,.9,.3,1.2)' : 'ease-out', fill: 'both' }).finished.catch(() => {});
      if (!isMove && L.loop !== 'none' && kfLoop[L.loop]) {
        const target = L.loop === 'rainbow' ? inner : inner.firstChild || inner;
        loopAnim = target.animate(kfLoop[L.loop], { duration: loopDur[L.loop] / L.speed, iterations: Infinity, easing: L.loop === 'spin' ? 'linear' : 'ease-in-out' });
      }
      await waitLife(life === Infinity ? Infinity : Math.max(0, life - inMs - outMs));
      if (!stopped && outMs > 0 && L.out !== 'none') await inner.animate(kfOut(L.out) || kfOut('fade'), { duration: outMs, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {});
      if (loopAnim) loopAnim.cancel();
      if (outer._tw) outer._tw.stop();
      outer.remove();
    })().catch(() => {}));
    const done = Promise.race([Promise.all(jobs), new Promise(r => stops.push(r))]).then(() => { cleanup(); });
    // 一回のものは、全体の長さを過ぎたら必ず片付ける(動画・音が長くても)
    const guard = hold ? 0 : win.setTimeout(() => stop(), total + 8000);
    function cleanup() { if (guard) win.clearTimeout(guard); media.forEach(m => { try { m.pause(); } catch (e) {} }); twStops.splice(0).forEach(f => { try { f(); } catch (e) {} }); fx.remove(); }
    function stop() { if (stopped) return; stopped = true; stops.splice(0).forEach(f => { try { f(); } catch (e) {} }); cleanup(); }
    function release() {
      if (released || stopped) return; released = true; relRes();
      // BGM はふわっと下げる
      media.filter(m => m.tagName === 'AUDIO' || m instanceof win.Audio).forEach(m => { const v0 = m.volume; let k = 0; const t = win.setInterval(() => { k++; try { m.volume = Math.max(0, v0 * (1 - k / 8)); } catch (e) {} if (k >= 8) { win.clearInterval(t); try { m.pause(); } catch (e) {} } }, 70); });
      win.setTimeout(() => stop(), 6000);   // 消えかたが終わらなくても、6秒で片付ける
    }
    return { done, stop, release };
  }

  /** 紙吹雪など:絵文字か画像を、たくさん飛ばす(出しっぱなしの時は、止めるまでくり返す) */
  async function particles(doc, fx, L, life, img, alive) {
    const chars = Array.from(L.emoji || '🎉').filter(c => c.trim() && !/[️‍]/.test(c));
    const n = L.count, anims = [], forever = life === Infinity;
    const cyc = forever ? 6000 : life;
    function plan(first) {
      const r = Math.random, s = 0.6 + r() * 0.8;
      const x0 = L.x / 100 * W, y0 = L.y / 100 * H;
      let frames, dur = Math.min(cyc, 1500 + r() * 2500), delay = r() * Math.min(1200, cyc / 3);
      if (L.mode === 'rain' || L.mode === 'snow') {
        const x = r() * W, drift = (r() * 2 - 1) * (L.mode === 'snow' ? 200 : 60);
        frames = [{ transform: `translate(${x}px,-150px) rotate(0) scale(${s})`, opacity: 1 }, { transform: `translate(${x + drift}px,${H + 150}px) rotate(${(r() * 2 - 1) * 360}deg) scale(${s})`, opacity: 1 }];
        dur = ((L.mode === 'snow' ? 4000 : 1800) + r() * 1500) / L.speed; if (!forever) dur = Math.min(cyc, dur);
        delay = forever ? (first ? r() * dur : 0) : r() * Math.max(0, cyc - dur);
      } else if (L.mode === 'float') {
        const x = r() * W;
        frames = [{ transform: `translate(${x}px,${H + 100}px) scale(${s})`, opacity: 0 }, { transform: `translate(${x + (r() * 2 - 1) * 120}px,${H * 0.5}px) scale(${s})`, opacity: 1, offset: 0.5 }, { transform: `translate(${x + (r() * 2 - 1) * 200}px,-150px) scale(${s})`, opacity: 0 }];
        dur = (3000 + r() * 2000) / L.speed; if (!forever) dur = Math.min(cyc, dur);
        delay = forever ? (first ? r() * dur : 0) : r() * Math.max(0, cyc - dur);
      } else if (L.mode === 'burst') {
        const a = r() * Math.PI * 2, d = 300 + r() * 700;
        frames = [{ transform: `translate(${x0}px,${y0}px) scale(.2)`, opacity: 1 }, { transform: `translate(${x0 + Math.cos(a) * d}px,${y0 + Math.sin(a) * d}px) rotate(${(r() * 2 - 1) * 540}deg) scale(${s})`, opacity: 0 }];
        dur = Math.min(cyc, (900 + r() * 900) / L.speed); delay = forever && !first ? r() * 2500 : r() * 150;
      } else {   // confetti:下から打ち上げて落ちる
        const vx = (r() * 2 - 1) * 700, up = 500 + r() * 500;
        frames = [{ transform: `translate(${x0}px,${y0}px) rotate(0) scale(${s})`, opacity: 1 },
          { transform: `translate(${x0 + vx * 0.6}px,${y0 - up}px) rotate(${(r() * 2 - 1) * 360}deg) scale(${s})`, opacity: 1, offset: 0.35 },
          { transform: `translate(${x0 + vx}px,${H + 200}px) rotate(${(r() * 2 - 1) * 900}deg) scale(${s})`, opacity: 0.9 }];
        dur = Math.min(cyc, (2200 + r() * 1500) / L.speed); delay = forever && !first ? r() * 2500 : r() * 300;
      }
      return { frames, dur, delay };
    }
    for (let i = 0; i < n; i++) {
      const p = doc.createElement('div'); p.className = 'cfx-p';
      if (img) { const im = doc.createElement('img'); im.src = img; im.style.width = L.size + 'px'; p.appendChild(im); }
      else { p.textContent = chars.length ? chars[i % chars.length] : '✨'; p.style.fontSize = L.size + 'px'; }
      fx.appendChild(p);
      p.style.opacity = '0';
      const run = first => new Promise(res => {
        const k = plan(first);
        p.style.transform = k.frames[0].transform;
        p.animate(k.frames, { duration: k.dur, delay: k.delay, easing: L.mode === 'confetti' ? 'cubic-bezier(.25,.6,.5,1)' : 'linear', fill: 'both' }).finished.catch(() => {})
          .then(() => (forever && alive() && p.isConnected ? run(false) : null)).then(res);
      });
      anims.push(run(true).then(() => p.remove()));
    }
    await Promise.all(anims);
  }

  // ================= ウィジェット(出しっぱなしの表示:チャット欄・ピン留め・ポップアップ・ボード・投票) =================
  // state は アプリが作る。表示する場所(OBS用ファイル・小窓・プレビュー)は、届いた state をそのまま描く。
  const ANCHORS = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'];
  const THEMES = ['dark', 'light', 'pop', 'clear'];
  const WCSS = `
  .cfx-w{position:absolute;inset:0;z-index:0}
  .cfx-fx{z-index:1}
  .cfx-anc{position:absolute;display:flex;flex-direction:column;gap:18px;max-width:46%}
  .cfx-anc.a-tl{left:2.5%;top:3%;align-items:flex-start}.cfx-anc.a-t{left:50%;top:3%;transform:translateX(-50%);align-items:center}.cfx-anc.a-tr{right:2.5%;top:3%;align-items:flex-end}
  .cfx-anc.a-l{left:2.5%;top:50%;transform:translateY(-50%);align-items:flex-start}.cfx-anc.a-c{left:50%;top:50%;transform:translate(-50%,-50%);align-items:center}.cfx-anc.a-r{right:2.5%;top:50%;transform:translateY(-50%);align-items:flex-end}
  .cfx-anc.a-bl{left:2.5%;bottom:4%;align-items:flex-start}.cfx-anc.a-b{left:50%;bottom:4%;transform:translateX(-50%);align-items:center}.cfx-anc.a-br{right:2.5%;bottom:4%;align-items:flex-end}
  .cfx-wd{position:relative;max-width:100%;font-family:'M PLUS Rounded 1c','Noto Sans JP',sans-serif;font-weight:800;color:#fff;transition:opacity .4s}
  .cfx-card{border-radius:22px;padding:18px 26px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
  .t-dark .cfx-card{background:rgba(18,16,40,.82);color:#fff;border:3px solid rgba(255,255,255,.18)}
  .t-light .cfx-card{background:rgba(255,255,255,.92);color:#1b1036;border:3px solid rgba(27,16,54,.12)}
  .t-pop .cfx-card{background:linear-gradient(135deg,#ff5fa2,#7c6cff);color:#fff;border:3px solid #fff}
  .t-clear .cfx-card{background:transparent;box-shadow:none;color:#fff;-webkit-text-stroke:5px #1b1036;paint-order:stroke fill}
  .cfx-title{font-size:30px;opacity:.85;margin-bottom:8px}
  .cfx-name{font-size:24px;opacity:.85}
  .cfx-msg{font-size:38px;line-height:1.3;white-space:pre-wrap;word-break:break-word}
  .cfx-msg img{height:1.25em;vertical-align:-0.25em;margin:0 2px}
  .cfx-chat{display:flex;flex-direction:column;gap:10px;width:640px}
  .cfx-chat .cfx-card{padding:10px 18px}
  .cfx-chat .cfx-msg{font-size:30px}
  .cfx-chat .cfx-name{font-size:20px}
  .cfx-in2{animation:cfxIn .45s cubic-bezier(.2,.9,.3,1.2) both}
  .cfx-out2{animation:cfxOut .4s ease-in both}
  @keyframes cfxIn{from{opacity:0;transform:translateY(24px) scale(.9)}to{opacity:1;transform:none}}
  @keyframes cfxOut{to{opacity:0;transform:translateY(-12px) scale(.95)}}
  .cfx-board .cfx-msg{font-size:44px}
  .cfx-popup .cfx-msg{font-size:56px}
  .cfx-popup .cfx-name{font-size:30px}
  .cfx-poll{min-width:620px}
  .cfx-opt{position:relative;margin:10px 0;border-radius:14px;overflow:hidden;background:rgba(127,127,127,.25);font-size:30px;padding:8px 16px;display:flex;justify-content:space-between;gap:12px}
  .cfx-bar{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#7ef9ff88,#7c6cff88);transition:width .6s ease;z-index:0}
  .cfx-opt>span{position:relative;z-index:1}
  .cfx-opt.win{outline:4px solid #ffe066}
  .cfx-pollfoot{font-size:22px;opacity:.85;margin-top:6px}
  `;
  const partsNodes = (doc, item) => {
    const box = doc.createElement('div'); box.className = 'cfx-msg';
    if (Array.isArray(item.parts) && item.parts.length) {
      for (const p of item.parts.slice(0, 80)) {
        if (p && p.t === 'emote' && p.url && /^https:\/\//.test(p.url)) { const im = doc.createElement('img'); im.src = p.url; im.alt = p.name || ''; box.appendChild(im); }
        else box.appendChild(doc.createTextNode(String((p && (p.text != null ? p.text : p.name)) || '')));
      }
    } else box.textContent = String(item.text || '');
    return box;
  };
  function card(doc, cls, title, name, item) {
    const c = doc.createElement('div'); c.className = 'cfx-card ' + (cls || '');
    if (title) { const t = doc.createElement('div'); t.className = 'cfx-title'; t.textContent = title; c.appendChild(t); }
    if (name) { const n = doc.createElement('div'); n.className = 'cfx-name'; n.textContent = name; c.appendChild(n); }
    c.appendChild(partsNodes(doc, item || {}));
    return c;
  }
  // 同じ場所(9か所)に置いたものは、重ならないように縦に並べる。大きさは zoom(並びにも効く)
  function slot(root, key, anchor, theme, scale) {
    const doc = root.ownerDocument;
    const a = ANCHORS.includes(anchor) ? anchor : 'c';
    let box = root.querySelector(`:scope > .cfx-anc.a-${a}`);
    if (!box) { box = doc.createElement('div'); box.className = `cfx-anc a-${a}`; root.appendChild(box); }
    let el = root.querySelector(`[data-w="${key}"]`);
    if (!el) { el = doc.createElement('div'); el.dataset.w = key; }
    if (el.parentNode !== box) box.appendChild(el);
    el.className = `cfx-wd t-${THEMES.includes(theme) ? theme : 'dark'}`;
    el.style.zoom = String(num(scale, 0.3, 4, 1));
    el._seen = true;
    return el;
  }
  /** ウィジェットを描く(何度呼んでもよい。state にないものは消す) */
  function renderWidgets(host, state) {
    const doc = host.ownerDocument, r = mount(host);
    if (!doc.getElementById('cfx-wcss')) { const st = doc.createElement('style'); st.id = 'cfx-wcss'; st.textContent = WCSS; doc.head.appendChild(st); }
    let w = r.querySelector(':scope > .cfx-w');
    if (!w) { w = doc.createElement('div'); w.className = 'cfx-w'; r.insertBefore(w, r.firstChild); }
    state = state || {};
    const all = () => [...w.querySelectorAll('[data-w]')];
    all().forEach(c => { c._seen = false; });
    // チャット欄
    const ch = state.chat;
    if (ch && ch.on && Array.isArray(ch.items)) {
      const el = slot(w, 'chat', ch.anchor, ch.theme, ch.scale);
      let list = el.firstChild; if (!list) { list = doc.createElement('div'); list.className = 'cfx-chat'; el.appendChild(list); }
      const want = ch.items.slice(-20);
      const keep = new Set(want.map(i => String(i.id)));
      [...list.children].forEach(n => { if (!keep.has(n.dataset.id)) n.remove(); });
      want.forEach((it, i) => {
        let n = [...list.children].find(x => x.dataset.id === String(it.id));
        if (!n) { n = card(doc, 'cfx-in2', '', ch.names === false ? '' : it.name, it); n.dataset.id = String(it.id); }
        if (list.children[i] !== n) list.insertBefore(n, list.children[i] || null);
      });
    }
    // ピン留め
    const pin = state.pin;
    if (pin && pin.item) {
      const el = slot(w, 'pin', pin.anchor, pin.theme, pin.scale);
      if (el.dataset.k !== String(pin.item.id)) { el.dataset.k = String(pin.item.id); el.innerHTML = ''; el.appendChild(card(doc, 'cfx-in2', '📌 ' + (pin.title || ''), pin.item.name, pin.item)); }
    }
    // ポップアップ
    const pop = state.popup;
    if (pop && pop.item) {
      const el = slot(w, 'popup', pop.anchor, pop.theme, pop.scale);
      el.classList.add('cfx-popup');
      if (el.dataset.k !== String(pop.item.id)) { el.dataset.k = String(pop.item.id); el.innerHTML = ''; el.appendChild(card(doc, 'cfx-in2', '', pop.item.name, pop.item)); }
    }
    // メッセージボード
    (Array.isArray(state.boards) ? state.boards : []).filter(b => b && b.on).slice(0, 12).forEach(b => {
      const el = slot(w, 'b-' + b.id, b.anchor, b.theme, b.scale);
      el.classList.add('cfx-board');
      const sig = (b.title || '') + '\u0001' + (b.text || '');
      if (el.dataset.k !== sig) { el.dataset.k = sig; el.innerHTML = ''; el.appendChild(card(doc, 'cfx-in2', b.title || '', '', { text: b.text || '' })); }
    });
    // 投票
    const pl = state.poll;
    if (pl && pl.on && Array.isArray(pl.opts)) {
      const el = slot(w, 'poll', pl.anchor, pl.theme, pl.scale);
      let c = el.firstChild;
      const sig = (pl.q || '') + '\u0001' + pl.opts.map(o => o.label).join('\u0001');
      if (!c || el.dataset.k !== sig) {
        el.dataset.k = sig; el.innerHTML = '';
        c = doc.createElement('div'); c.className = 'cfx-card cfx-poll cfx-in2';
        const t = doc.createElement('div'); t.className = 'cfx-title'; t.textContent = '📊 ' + (pl.q || '投票'); c.appendChild(t);
        pl.opts.forEach((o, i) => {
          const row = doc.createElement('div'); row.className = 'cfx-opt';
          const bar = doc.createElement('div'); bar.className = 'cfx-bar'; bar.style.width = '0%';
          const l = doc.createElement('span'); l.textContent = `${i + 1}. ${o.label}`;
          const v = doc.createElement('span'); v.className = 'cfx-v';
          row.append(bar, l, v); c.appendChild(row);
        });
        const f = doc.createElement('div'); f.className = 'cfx-pollfoot'; c.appendChild(f);
        el.appendChild(c);
      }
      const total = pl.opts.reduce((n, o) => n + (Number(o.votes) || 0), 0);
      const max = Math.max(0, ...pl.opts.map(o => Number(o.votes) || 0));
      [...c.querySelectorAll('.cfx-opt')].forEach((row, i) => {
        const o = pl.opts[i] || {}; const v = Number(o.votes) || 0;
        row.querySelector('.cfx-bar').style.width = (total ? v / total * 100 : 0) + '%';
        row.querySelector('.cfx-v').textContent = pl.showVotes === false ? '' : `${v}票${total ? `(${Math.round(v / total * 100)}%)` : ''}`;
        row.classList.toggle('win', !pl.open && total > 0 && v === max);
      });
      c.querySelector('.cfx-pollfoot').textContent = pl.open ? `チャットで番号を送って投票してね(${total}票${pl.left != null ? `・残り${pl.left}秒` : ''})` : `投票は締め切りました(${total}票)`;
    }
    // 届いた state にないものは、ふわっと消す
    all().forEach(c => {
      if (c._seen) { if (c._leaving) { c._leaving = false; c.classList.remove('cfx-out2'); } return; }
      if (c._leaving) return;
      c._leaving = true; c.classList.add('cfx-out2');
      setTimeout(() => { if (c._leaving) c.remove(); }, 450);
    });
  }

  // ================= テンプレート =================
  const TEMPLATES = [
    { name: 'どね・スパチャ・ビッツ お礼', icon: '💸', trigger: { kinds: ['donation', 'superchat', 'bits'], manual: true }, duration: 6, layers: [
      { type: 'flash', color: '#fff6c2', power: 0.5 },
      { type: 'particles', emoji: '💰✨🎉', mode: 'confetti', count: 60, x: 50, y: 100, size: 64 },
      { type: 'text', text: '{name} さん', y: 38, size: 84, color: '#ffe066', stroke: '#3a1d00', in: 'drop', loop: 'float' },
      { type: 'text', text: '{num}{unit}、ありがとう!!', y: 56, size: 120, color: '#ffffff', stroke: '#ff3d7f', strokeW: 12, in: 'pop', start: 0.3, loop: 'pulse' },
      { type: 'text', text: '{message}', y: 74, size: 48, color: '#ffffff', stroke: '#1b1036', start: 0.6, in: 'fade', maxW: 70 } ] },
    { name: 'フォローありがとう', icon: '💜', trigger: { kinds: ['follow'], manual: true }, duration: 5, layers: [
      { type: 'particles', emoji: '💜💖✨', mode: 'float', count: 30, size: 56 },
      { type: 'text', text: '{name} さん\nフォローありがとう!', y: 50, size: 90, color: '#ffffff', stroke: '#7c3aed', strokeW: 10, in: 'slideUp', loop: 'float' } ] },
    {"name": "サブスク・メンバー", "icon": "⭐", "trigger": {"kinds": ["sub", "member", "subgift", "giftbomb", "membergift"], "manual": true}, "duration": 7, "layers": [{"type": "particles", "start": 0, "x": 50, "y": 50, "in": "pop", "out": "fade", "emoji": "⭐🌟✨", "count": 70, "mode": "burst", "size": 70}, {"type": "text", "start": 0, "x": 50, "y": 40, "in": "zoom", "out": "fade", "loop": "none", "text": "{name} さん", "font": "Dela Gothic One", "size": 90, "color": "#7ef9ff", "stroke": "#032b44", "strokeW": 8, "maxW": 90}, {"type": "text", "start": 0.3, "x": 50, "y": 58, "in": "pop", "out": "fade", "loop": "rainbow", "text": "サブスクありがとう!!", "font": "Dela Gothic One", "size": 120, "color": "#ffffff", "stroke": "#0077ff", "strokeW": 12, "maxW": 90}]},
    { name: 'レイド歓迎', icon: '🎉', trigger: { kinds: ['raid'], manual: true }, duration: 8, layers: [
      { type: 'particles', emoji: '🎉🎊🥳', mode: 'rain', count: 90, size: 64 },
      { type: 'text', text: '{name} さんから\n{viewers} 人のレイド!', y: 45, size: 100, color: '#ffffff', stroke: '#e11d48', strokeW: 12, in: 'drop', loop: 'swing' },
      { type: 'text', text: 'いらっしゃいませー!', y: 72, size: 72, color: '#ffe066', stroke: '#1b1036', start: 0.8, in: 'slideUp', loop: 'bounce' } ] },
    { name: 'チャンネルポイント', icon: '🎁', trigger: { kinds: ['reward'], manual: true }, duration: 5, layers: [
      { type: 'particles', emoji: '🎁✨', mode: 'burst', count: 40, x: 50, y: 50, size: 60 },
      { type: 'text', text: '{name} さんが\n「{reward}」', y: 50, size: 80, color: '#ffffff', stroke: '#16a34a', strokeW: 10, in: 'pop', loop: 'pulse' } ] },
    { name: 'ハイプトレイン', icon: '🚂', trigger: { kinds: ['hypebegin', 'hypeprogress'], manual: true }, duration: 6, layers: [
      { type: 'shake', power: 24 },
      { type: 'text', text: '🚂 ハイプトレイン レベル{level}!', y: 50, size: 100, color: '#ffffff', stroke: '#9333ea', strokeW: 12, in: 'slideLeft', out: 'slideLeft', loop: 'shake' } ] },
    { name: '草(コメントで発動)', icon: '🌱', trigger: { kinds: ['comment'], keywords: '草\nwww\nｗｗｗ', keywordMode: 'contains', manual: true }, cooldown: 10, mode: 'overlap', duration: 4, layers: [
      { type: 'particles', emoji: '🌱🌿🍀', mode: 'rain', count: 50, size: 56 } ] },
    { name: '拍手(ボタン用)', icon: '👏', trigger: { kinds: [], manual: true }, duration: 4, layers: [
      { type: 'particles', emoji: '👏✨', mode: 'float', count: 40, size: 72 },
      { type: 'text', text: 'パチパチパチ!', y: 50, size: 110, color: '#ffffff', stroke: '#ea580c', strokeW: 12, in: 'pop', loop: 'bounce' } ] },
  ];

  root.CFFx = { MOVES, PLATES, renderWidgets, ANCHORS, THEMES, W, H, FONTS, ANIM_IN, ANIM_OUT, LOOPS, LAYER_TYPES, PARTICLE_MODES, VARS, validate, fill, play, mount, TEMPLATES };
})(typeof window !== 'undefined' ? window : globalThis);
