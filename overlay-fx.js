/* 演出・フリップを、自分の画面の窓(字幕の窓)に出す(Cast Frost Web v0.7.3 以降)
 * アプリから来るメッセージは、OBS 用の演出ファイルと同じ形({ fx:'play' | 'release' | 'cancel-manual' | 'stop' | 'asset' })。
 * 全部、字幕の上(#fxt)に出す。
 */
(() => {
  'use strict';
  if (!window.CFFx || !window.yfExe || !window.yfExe.onFx) return;
  const fxb = document.getElementById('fxb'), fxt = document.getElementById('fxt');
  CFFx.mount(fxb); CFFx.mount(fxt);
  // 素材(画像・音・動画):アプリから分けて送られてくるものを組み立てる
  const assets = new Map(), parts = new Map();
  const urlOf = id => (assets.get(id) || {}).url || null;
  function onAssetPart(d) {
    let p = parts.get(d.id);
    if (!p || p.n !== d.n || p.h !== d.h) { p = { n: d.n, h: d.h, mime: d.mime, got: new Array(d.n), cnt: 0 }; parts.set(d.id, p); }
    if (p.got[d.i] == null) { p.got[d.i] = d.data; p.cnt++; }
    if (p.cnt < p.n) return;
    const bin = atob(p.got.join('')); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const old = assets.get(d.id); if (old) URL.revokeObjectURL(old.url);
    assets.set(d.id, { h: p.h, url: URL.createObjectURL(new Blob([u8], { type: p.mime })) });
    parts.delete(d.id);
  }
  // クリップの動画ファイルの URL(補助exe → アプリ)
  const pend = new Map(); let ridN = 0;
  window.yfExe.onClipUrl(d => { const f = d && pend.get(d.rid); if (f) { pend.delete(d.rid); f(d.url || null); } });
  const resolveClip = it => new Promise(res => {
    const rid = 'o' + (++ridN) + '_' + Date.now();
    const t = setTimeout(() => { pend.delete(rid); res(null); }, 6000);
    pend.set(rid, url => { clearTimeout(t); res(url); });
    window.yfExe.needClip({ rid, id: it.id, bid: it.bid || '' });
  });
  // 再生:順番待ち(queue)と、重ねて出す(overlap)
  const queue = []; let busy = false; const playing = new Set(), held = new Map(), manual = new Set(), relPending = new Set();
  async function run(d) {
    const v = CFFx.validate(d.effect); if (!v.ok) return;
    // Twitch 動画の一覧(items)は validate で落ちるので、元のものを付け直す
    (d.effect.layers || []).forEach((L, i) => { if (L && L.type === 'twitch' && v.effect.layers[i]) Object.assign(v.effect.layers[i], { items: L.items, _err: L._err }); });
    const need = (d.need || []).filter(id => !assets.has(id));
    if (need.length) {   // 素材がまだ届いていなければ、少し待つ
      window.yfExe.fxNeed(need);
      for (let i = 0; i < 40 && need.some(id => !assets.has(id)); i++) await new Promise(r => setTimeout(r, 150));
    }
    if (d.hold) { relPending.delete(d.key); if (held.has(d.key)) return; }
    const host = fxt;   // 全部、字幕の上(出しっぱなしも)
    // http://localhost で開いている時は Twitch の埋め込みも使える。パソコンの中のファイルで開いた時は、動画ファイルだけ
    const tw = { parent: [location.hostname || 'localhost'], muted: !!d.muted, volMode: 'player', resolveClip, noEmbed: location.protocol === 'file:', host: fxt };
    const h = CFFx.play(host, v.effect, { assets: urlOf, vars: d.vars || {}, hold: !!d.hold, muted: !!d.muted, twitch: tw });
    if (d.hold) { if (relPending.has(d.key)) { relPending.delete(d.key); h.release(); } else held.set(d.key, h); } else if (d.manual) manual.add(h);
    playing.add(h); await h.done; playing.delete(h); manual.delete(h);
    if (d.hold && held.get(d.key) === h) held.delete(d.key);
  }
  async function pump() {
    if (busy) return; busy = true;
    while (queue.length) { try { await run(queue.shift()); } catch (e) {} }
    busy = false;
  }
  window.yfExe.onFx(d => {
    if (!d || !d.fx) return;
    if (d.fx === 'asset') { onAssetPart(d); return; }
    if (d.fx === 'stop') { queue.length = 0; playing.forEach(h => h.stop()); held.forEach(h => h.stop()); held.clear(); manual.forEach(h => h.stop()); manual.clear(); return; }
    if (d.fx === 'release') { const h = held.get(d.key); if (h) { h.release(); held.delete(d.key); } else relPending.add(d.key); return; }
    if (d.fx === 'cancel-manual') { manual.forEach(h => h.stop()); manual.clear(); return; }
    if (d.fx === 'play') {
      if (d.hold) { if (!held.has(d.key)) run(d); return; }   // 出しっぱなし(同じものが出ていれば何もしない)
      if (d.mode === 'overlap') run(d); else { queue.push(d); pump(); }
    }
  });
})();
