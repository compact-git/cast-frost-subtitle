/* Cast Frost - 🎬 Twitch のクリップ・動画を次々に流す(フリップの部品「Twitch 動画」)
 *
 * Cast Frost Web の小窓と、補助exe「Cast Frost 字幕」の OBS 用プレーヤー(http://localhost:ポート/player)の両方で使う。
 * Twitch の埋め込みは、表示するページのドメイン(parent)が必要なので、パソコンに保存したファイル(file://)では使えない。
 *
 * CFTw.run(box, L, opts) → { stop() }
 *   L.items:[{ k:'clip', id, dur, title } | { k:'video', id, dur, title }](アプリが Twitch API から作って渡す)
 *   L.order:'expand'(上位5本から、流しきるたびに 10・20・40…と広げて、その中からランダム)/ 'random' / 'inOrder'
 *   L.excerptMin:長い動画(アーカイブなど)の1本あたりの再生時間(分)。どこか適当な場所から、この長さだけ流す。0 = 頭から最後まで
 *   L.volume:音量(0〜1)
 *   opts:{ parent:[ドメイン], muted, volMode:'player'(動画の音量をプレーヤーで下げる)/'external'(OBS のミキサーで下げるので、プレーヤーは100%),
 *          resolveClip(it) → Promise<URL|null>:クリップの動画ファイル(mp4)の URL。もらえたら <video> で流す(音量を変えられ、自動再生の条件もない)。
 *          もらえない時(OAuth にクリップの権限がない など)は、Twitch の埋め込みで流す }
 */
(function (root) {
  'use strict';
  const CLIP_PAD = 2.5;          // クリップは読み込みに少しかかるので、長さ+この秒数で次へ
  const fmtT = s => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 3600)}h${Math.floor(s / 60) % 60}m${s % 60}s`; };
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /** 次に流すものを決める */
  function makeQueue(items, order) {
    let pool = [], width = 5, idx = 0, last = null;
    const n = items.length;
    function refill() {
      if (order === 'inOrder') { pool = items.slice(); return; }
      if (order === 'random') { pool = shuffle(items.slice()); }
      else {
        // 上位5本 → 流しきったら上位10本 → 20本 …(その中でランダム)。全部まで広がったら、全部の中でランダムをくり返す
        pool = shuffle(items.slice(0, Math.min(n, width)));
        width = Math.min(n, width * 2);
      }
      if (pool.length > 1 && pool[0] === last) pool.push(pool.shift());   // 同じものが2回続かないように
    }
    return () => {
      if (!n) return null;
      if (idx >= pool.length) { refill(); idx = 0; }
      last = pool[idx++];
      return last;
    };
  }

  function loadPlayerJs(win) {
    if (win.Twitch && win.Twitch.Player) return Promise.resolve(true);
    if (win.__cfTwLoading) return win.__cfTwLoading;
    win.__cfTwLoading = new Promise(res => {
      const s = win.document.createElement('script');
      s.src = 'https://player.twitch.tv/js/embed/v1.js';
      s.onload = () => res(!!(win.Twitch && win.Twitch.Player));
      s.onerror = () => { win.__cfTwLoading = null; res(false); };
      win.document.head.appendChild(s);
    });
    return win.__cfTwLoading;
  }

  function run(box, L, opts) {
    opts = opts || {};
    const doc = box.ownerDocument, win = doc.defaultView;
    const parents = (opts.parent && opts.parent.length ? opts.parent : [win.location.hostname || 'localhost']).filter(Boolean);
    const pq = parents.map(p => 'parent=' + encodeURIComponent(p)).join('&');
    const items = Array.isArray(L.items) ? L.items.filter(it => it && it.id) : [];
    const vol = Math.max(0, Math.min(1, Number(L.volume == null ? 0.6 : L.volume)));
    const muted = !!opts.muted;
    const next = makeQueue(items, L.order || 'expand');
    let stopped = false, timer = 0, cur = null, playTok = 0;
    box.style.background = '#000';
    box.style.overflow = 'hidden';

    const msg = text => {
      box.innerHTML = '';
      const p = doc.createElement('div');
      Object.assign(p.style, { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', font: '700 28px sans-serif', textAlign: 'center', padding: '5%' });
      p.textContent = text; box.appendChild(p);
    };
    if (!items.length) { msg(L._err || '🎬 流せる Twitch の動画がありません'); return { stop() {} }; }

    const after = (sec, fn) => { win.clearTimeout(timer); timer = win.setTimeout(fn, Math.max(1, sec) * 1000); };
    function clear() {
      if (cur && cur.player && cur.player.pause) { try { cur.player.pause(); } catch (e) {} }
      if (cur && cur.video) { try { cur.video.pause(); cur.video.removeAttribute('src'); cur.video.load(); } catch (e) {} }
      box.innerHTML = ''; cur = null;
    }
    function frame(src) {
      const f = doc.createElement('iframe');
      f.src = src; f.allow = 'autoplay; fullscreen'; f.setAttribute('allowfullscreen', '');
      f.setAttribute('scrolling', 'no'); f.setAttribute('frameborder', '0');
      Object.assign(f.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', border: '0' });
      box.appendChild(f); return f;
    }
    async function playOne() {
      if (stopped) return;
      const it = next(); if (!it) return;
      const tok = ++playTok;
      clear();
      if (it.k === 'clip' && opts.resolveClip) {
        let url = null;
        try { url = await opts.resolveClip(it); } catch (e) {}
        if (stopped || tok !== playTok) return;   // 待っている間に止められた・次へ進んだ
        if (url) {
          const v = doc.createElement('video');
          v.src = url; v.autoplay = true; v.playsInline = true; v.preload = 'auto';
          v.muted = muted; v.volume = muted ? 0 : (opts.volMode === 'external' ? 1 : vol);
          Object.assign(v.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', background: '#000' });
          box.appendChild(v);
          cur = { it, video: v };
          let done = false;
          const nextOnce = () => { if (done || stopped || !cur || cur.video !== v) return; done = true; playOne(); };
          v.addEventListener('ended', nextOnce);
          v.addEventListener('error', () => { if (cur && cur.video === v) { v.remove(); cur = null; embedClip(it); } });
          const p = v.play(); if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(() => {}); });   // 音つきが止められたら、音なしで流す
          after((Number(it.dur) || 60) + 8, nextOnce);   // 念のため(ended が来ない時)
          return;
        }
      }
      if (it.k === 'clip') { embedClip(it); return; }
      function embedClip(it) {
        frame(`https://clips.twitch.tv/embed?clip=${encodeURIComponent(it.id)}&${pq}&autoplay=true&muted=${muted}&preload=auto`);
        cur = { it };
        after((Number(it.dur) || 30) + CLIP_PAD, playOne);
      }
      // 動画:長い時は、どこか適当な場所から「1本あたりの再生時間」だけ流す
      const dur = Number(it.dur) || 0, ex = Math.max(0, Number(L.excerptMin) || 0) * 60;
      let start = 0, len = dur || 600;
      if (ex > 0 && dur > ex + 20) { start = Math.floor(dur * 0.05 + Math.random() * Math.max(1, dur * 0.9 - ex)); len = ex; }
      else if (ex > 0) len = Math.min(ex, dur || ex);
      const holder = doc.createElement('div'); holder.id = 'cftw' + Math.random().toString(36).slice(2, 8);
      Object.assign(holder.style, { position: 'absolute', inset: '0' }); box.appendChild(holder);
      cur = { it };
      // 小窓(about:blank の窓)には外の script を読み込めないので、このファイルを読んだ窓(アプリ本体)に読み込み、要素を渡して作る
      const jsWin = root.document ? root : win;
      const ok = await loadPlayerJs(jsWin);
      if (stopped || !cur || cur.it !== it) return;
      const pv = muted ? 0 : (opts.volMode === 'external' ? 1 : vol);
      const iframeUrl = `https://player.twitch.tv/?video=v${encodeURIComponent(String(it.id).replace(/^v/, ''))}&time=${fmtT(start)}&${pq}&autoplay=true&muted=${muted}`;
      if (ok) {
        try {
          const p = new jsWin.Twitch.Player(jsWin === win ? holder.id : holder, { video: String(it.id).replace(/^v/, ''), time: fmtT(start), autoplay: true, muted, parent: parents, width: '100%', height: '100%', controls: false });
          cur.player = p;
          const setV = () => { try { p.setMuted(muted); p.setVolume(pv); } catch (e) {} };
          p.addEventListener(jsWin.Twitch.Player.READY, setV);
          p.addEventListener(jsWin.Twitch.Player.PLAYING, setV);
          p.addEventListener(jsWin.Twitch.Player.ENDED, () => { if (cur && cur.it === it) playOne(); });
          const f = holder.querySelector('iframe'); if (f) Object.assign(f.style, { width: '100%', height: '100%', border: '0' });
          // 作れたように見えて中身が出ない時は、ふつうの埋め込みに切り替える
          win.setTimeout(() => { if (cur && cur.it === it && !holder.querySelector('iframe')) { holder.remove(); cur.player = null; frame(iframeUrl); } }, 2500);
        } catch (e) { holder.remove(); frame(iframeUrl); }
      } else {
        holder.remove(); frame(iframeUrl);
      }
      after(len + 4, playOne);   // 広告や読み込みの分、少し長めに
    }
    playOne();
    return {
      stop() { stopped = true; win.clearTimeout(timer); clear(); },
      skip() { if (!stopped) playOne(); },
    };
  }

  /** "1h2m3s" → 秒 */
  function parseDur(s) {
    if (typeof s === 'number') return s;
    const m = String(s || '').match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    return m ? (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0) : 0;
  }
  /** 「流すもの」の欄に貼ったURLから、クリップ・動画を取り出す */
  function parseUrls(text) {
    const out = [];
    for (const raw of String(text || '').split(/[\s,]+/)) {
      const s = raw.trim(); if (!s) continue;
      let m = s.match(/twitch\.tv\/videos\/(\d+)/i) || s.match(/^v?(\d{6,})$/);
      if (m) { out.push({ k: 'video', id: m[1] }); continue; }
      m = s.match(/clips\.twitch\.tv\/(?:embed\?clip=)?([A-Za-z0-9_-]+)/i) || s.match(/twitch\.tv\/[^/]+\/clip\/([A-Za-z0-9_-]+)/i) || s.match(/^([A-Za-z][A-Za-z0-9]+-[A-Za-z0-9_-]{6,})$/);
      if (m) out.push({ k: 'clip', id: m[1] });
    }
    return out;
  }

  root.CFTw = { run, makeQueue, parseDur, parseUrls };
})(typeof window !== 'undefined' ? window : globalThis);
