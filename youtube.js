/* Cast Frost 字幕 - YouTube Live のチャットを読む(Cast Frost Web から頼まれて、このPCから YouTube に直接つなぐ)
 * ブラウザのアプリは YouTube のチャットを直接読めない(CORS)ため、補助exeが代わりに取ってくる。
 * YouTube の公開されていない仕組み(チャット欄と同じもの)を使うので、仕様変更で動かなくなることがある。
 *   resolve(q) → { videoId, live, upcoming, title, channel }
 *   init(v)    → { continuation, key, cv }
 *   next(b)    → { items:[…], continuation, timeoutMs, ended }
 */
'use strict';
const YT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const YT_HEAD = { 'User-Agent': YT_UA, 'Accept-Language': 'ja,en;q=0.8', Cookie: 'CONSENT=YES+1; SOCS=CAI' };

function yerr(code, message, status) { return Object.assign(new Error(message), { code, status: status || 400 }); }

function ytVideoId(s) {
  const m = String(s).match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/) || String(s).match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : '';
}
/** チャンネルの指定を youtube.com のパスに(@ハンドル / channel/UC… / c/… / user/…) */
function ytChannelPath(q) {
  q = String(q).trim();
  let m = q.match(/youtube\.com\/(@[^/?#]+|channel\/UC[\w-]{22}|c\/[^/?#]+|user\/[^/?#]+)/i);
  if (m) return m[1];
  if (/^@[^/\s]+$/.test(q)) return q;
  if (/^UC[\w-]{22}$/.test(q)) return 'channel/' + q;
  return '';
}
async function ytFetchText(u) {
  const r = await fetch(u, { headers: YT_HEAD, redirect: 'follow' });
  if (r.status === 404) throw yerr('notfound', 'YouTube で見つかりません', 404);
  if (!r.ok) throw yerr('upstream', 'YouTube から返事がありません(HTTP ' + r.status + ')', 502);
  return r.text();
}
async function ytResolve(q) {
  q = String(q || '').trim();
  if (!q) throw yerr('empty', 'チャンネルか配信のURLを入れてね');
  const vid = ytVideoId(q);
  if (vid && !ytChannelPath(q)) return { videoId: vid, live: null, upcoming: null, title: '', channel: '' };
  const path = ytChannelPath(q);
  if (!path) throw yerr('badinput', 'チャンネル(@ハンドル)か配信のURLの形ではないみたい');
  const html = await ytFetchText('https://www.youtube.com/' + encodeURI(path) + '/live');
  const canon = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/);
  const channel = (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || '';
  if (!canon) return { videoId: '', live: false, upcoming: false, title: '', channel: decodeHtml(channel) };
  const live = /"isLiveNow":true/.test(html) || /"isLive":true/.test(html);
  const upcoming = !live && (/"isUpcoming":true/.test(html) || /"upcomingEventData"/.test(html));
  const title = (html.match(/<meta name="title" content="([^"]*)"/) || [])[1] || '';
  return { videoId: canon[1], live, upcoming, title: decodeHtml(title), channel: decodeHtml(channel), start: ytStartOf(html) };
}
/** 配信の開始時刻(ミリ秒)。watch のページの liveBroadcastDetails.startTimestamp。無ければ 0 */
function ytStartOf(html) {
  const m = String(html || '').match(/"liveBroadcastDetails":\{[^}]*"startTimestamp":"([^"]+)"/) || String(html || '').match(/"startTimestamp":"([^"]+)"/);
  const t = m ? Date.parse(m[1]) : NaN;
  return Number.isFinite(t) ? t : 0;
}
/** 動画(配信)の情報:アーカイブの「その時間」へのリンクを作るための開始時刻など */
async function ytVinfo(v) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(v || ''))) throw yerr('badinput', '動画IDの形ではないみたい');
  const html = await ytFetchText('https://www.youtube.com/watch?v=' + v);
  const end = (html.match(/"liveBroadcastDetails":\{[^}]*"endTimestamp":"([^"]+)"/) || [])[1];
  const uc = (html.match(/"channelId":"(UC[\w-]{22})"/) || [])[1] || '';
  const title = (html.match(/<meta name="title" content="([^"]*)"/) || [])[1] || '';
  return { videoId: v, start: ytStartOf(html), end: end ? (Date.parse(end) || 0) : 0, live: /"isLiveNow":true/.test(html), channelId: uc, title: decodeHtml(title) };
}
function decodeHtml(s) { return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
/** ページの中の JSON(ytInitialData など)を取り出す */
function ytJsonAfter(html, marker) {
  const i = html.indexOf(marker); if (i < 0) return null;
  const start = html.indexOf('{', i); if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let k = start; k < html.length; k++) {
    const c = html[k];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, k + 1)); } catch (e) { return null; } } }
  }
  return null;
}
function ytContOf(conts) {
  const c = (conts || [])[0] || {};
  const d = c.invalidationContinuationData || c.timedContinuationData || c.reloadContinuationData || c.liveChatReplayContinuationData;
  return d ? { continuation: d.continuation, timeoutMs: Number(d.timeoutMs) || 0 } : null;
}
async function ytInit(v) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(v)) throw yerr('badinput', '動画IDの形ではないみたい');
  const html = await ytFetchText('https://www.youtube.com/live_chat?is_popout=1&v=' + v);
  const data = ytJsonAfter(html, 'ytInitialData');
  const lcr = data && data.contents && data.contents.liveChatRenderer;
  if (!lcr) {
    const msg = data && JSON.stringify(data).match(/"(?:text|simpleText)":"([^"]{4,80})"/);
    throw yerr('nochat', 'この配信のチャットが見つかりません(配信が終わった・チャットがオフ・メンバー限定など)' + (msg ? ':' + msg[1] : ''), 404);
  }
  // 「上位チャット」ではなく「すべてのチャット」を読む
  let cont = null;
  try {
    const items = lcr.header.liveChatHeaderRenderer.viewSelector.sortFilterSubMenuRenderer.subMenuItems;
    const all = items[items.length - 1];
    cont = all.continuation.reloadContinuationData.continuation;
  } catch (e) {}
  if (!cont) { const c = ytContOf(lcr.continuations); cont = c && c.continuation; }
  if (!cont) throw yerr('nochat', 'チャットの読み取りを始められませんでした', 404);
  const key = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1] || '';
  const cv = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || '2.20241101.00.00';
  return { continuation: cont, key, cv };
}
async function ytNext(b) {
  const cont = String(b && b.continuation || '');
  if (!cont || cont.length > 4000) throw yerr('badinput', 'continuation がありません');
  const key = /^[\w-]{10,80}$/.test(String(b.key || '')) ? b.key : '';
  const cv = /^[\d.]{5,30}$/.test(String(b.cv || '')) ? b.cv : '2.20241101.00.00';
  const u = 'https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false' + (key ? '&key=' + key : '');
  const r = await fetch(u, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', 'X-Youtube-Client-Name': '1', 'X-Youtube-Client-Version': cv, Origin: 'https://www.youtube.com' }, YT_HEAD),
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: cv, hl: 'ja', gl: 'JP' } }, continuation: cont }),
  });
  if (!r.ok) throw yerr('upstream', 'YouTube から返事がありません(HTTP ' + r.status + ')', r.status === 404 ? 404 : 502);
  const j = await r.json();
  const lcc = j && j.continuationContents && j.continuationContents.liveChatContinuation;
  if (!lcc) return { items: [], continuation: '', timeoutMs: 0, ended: true };
  const next = ytContOf(lcc.continuations);
  const items = [];
  for (const a of lcc.actions || []) {
    const it = a.addChatItemAction && a.addChatItemAction.item;
    if (!it) continue;
    const x = ytItem(it); if (x) items.push(x);
  }
  return { items, continuation: next ? next.continuation : '', timeoutMs: next ? next.timeoutMs : 0, ended: !next };
}
function ytRuns(m) {
  const parts = [];
  for (const r of (m && m.runs) || []) {
    if (r.text != null) parts.push({ t: 'text', text: r.text });
    else if (r.emoji) {
      const e = r.emoji;
      const sc = (e.shortcuts && e.shortcuts[0]) || '';
      if (e.isCustomEmoji) {
        const th = (e.image && e.image.thumbnails) || [];
        parts.push({ t: 'emote', code: sc || ':emoji:', name: sc.replace(/^:|:$/g, ''), src: 'yt', url: (th[th.length - 1] || {}).url || '' });
      } else parts.push({ t: 'text', text: e.emojiId || sc });
    }
  }
  if (!parts.length && m && m.simpleText) parts.push({ t: 'text', text: m.simpleText });
  return parts;
}
const ytText = m => ytRuns(m).map(p => (p.t === 'emote' ? p.code : p.text)).join('');
function ytAmount(s) {
  s = String(s || '').trim();
  const num = Number((s.match(/[\d.,]+/) || ['0'])[0].replace(/,/g, '')) || 0;
  const cur = s.replace(/[\d.,\s]/g, '') || '';
  const jpy = /^(¥|￥|JP¥|JPY)$/.test(cur) ? num : 0;
  return { text: s, amount: num, currency: cur, jpy };
}
function ytBadges(r) {
  const out = { owner: false, mod: false, member: false, verified: false };
  for (const b of r.authorBadges || []) {
    const t = b.liveChatAuthorBadgeRenderer || {};
    const icon = t.icon && t.icon.iconType;
    if (icon === 'OWNER') out.owner = true; else if (icon === 'MODERATOR') out.mod = true; else if (icon === 'VERIFIED') out.verified = true;
    else if (t.customThumbnail) out.member = true;
  }
  return out;
}
function ytItem(it) {
  const pick = it.liveChatTextMessageRenderer || it.liveChatPaidMessageRenderer || it.liveChatPaidStickerRenderer || it.liveChatMembershipItemRenderer || null;
  const g = it.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer;
  if (g) {
    const h = (g.header && g.header.liveChatSponsorshipsHeaderRenderer) || {};
    const head = ytText(h.primaryText);
    return { type: 'gift', id: g.id || '', name: ytText(h.authorName), channelId: g.authorExternalChannelId || '', count: Number((head.match(/\d+/) || ['1'])[0]) || 1, text: head };
  }
  if (!pick) return null;
  const base = { id: pick.id || '', name: ytText(pick.authorName), channelId: pick.authorExternalChannelId || '', badges: ytBadges(pick), ts: Number(pick.timestampUsec) / 1000 || 0 };
  if (it.liveChatTextMessageRenderer) return Object.assign(base, { type: 'text', parts: ytRuns(pick.message) });
  if (it.liveChatPaidMessageRenderer) return Object.assign(base, { type: 'superchat', parts: ytRuns(pick.message), money: ytAmount(ytText(pick.purchaseAmountText)), color: pick.bodyBackgroundColor || 0 });
  if (it.liveChatPaidStickerRenderer) return Object.assign(base, { type: 'sticker', parts: [], money: ytAmount(ytText(pick.purchaseAmountText)), sticker: ((pick.sticker && pick.sticker.accessibility && pick.sticker.accessibility.accessibilityData) || {}).label || '' });
  if (it.liveChatMembershipItemRenderer) {
    const head = ytText(pick.headerPrimaryText) || ytText(pick.headerSubtext);
    return Object.assign(base, { type: 'member', parts: ytRuns(pick.message), text: head, milestone: !!pick.headerPrimaryText });
  }
  return null;
}

// ---------- チャンネルの最新のアーカイブ(ライブのタブ)----------
/** "1:02:03" / "12:34" → 秒。形が違えば 0 */
function ytClock(t) {
  const m = String(t || '').trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return 0;
  return m[3] != null ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
}
/** ライブのタブの1本を { id, title, dur } に。配信中・予定・メンバー限定は null */
function ytArchiveOf(o) {
  let members = false;
  (function w(x) { if (!x || typeof x !== 'object' || members) return; if (x.badgeViewModel && /MEMBERS/.test(x.badgeViewModel.badgeStyle || '')) members = true; if (x.metadataBadgeRenderer && /MEMBERS/.test(x.metadataBadgeRenderer.style || '')) members = true; for (const k in x) w(x[k]); })(o);
  if (members) return null;
  if (o.lockupViewModel) {
    const lv = o.lockupViewModel;
    if (lv.contentType && lv.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
    let dur = 0;
    (function w(x) { if (!x || typeof x !== 'object' || dur) return; if (x.thumbnailBadgeViewModel) { const b = x.thumbnailBadgeViewModel; if (!/LIVE/.test(b.badgeStyle || '')) dur = ytClock(b.text); return; } for (const k in x) w(x[k]); })(lv.contentImage);
    const m = lv.metadata && lv.metadata.lockupMetadataViewModel;
    const title = (m && m.title && m.title.content) || '';
    return lv.contentId && dur ? { id: lv.contentId, title, dur } : null;
  }
  if (o.videoRenderer || o.gridVideoRenderer) {   // 前の形(念のため)
    const v = o.videoRenderer || o.gridVideoRenderer;
    const dur = ytClock(ytText(v.lengthText));
    return v.videoId && dur ? { id: v.videoId, title: ytText(v.title), dur } : null;
  }
  return null;
}
/**
 * チャンネルのライブのタブ(/streams)から、終わった配信(アーカイブ)を新しい順に n 本まで。
 * q:@ハンドル・チャンネルのURL・UC…、または配信(動画)のURL(その動画のチャンネルを使う)
 */
async function ytLatest(q, n) {
  q = String(q || '').trim();
  if (!q) throw yerr('empty', '📺 画面タブで、YouTube のチャンネル(@ハンドル)か配信のURLを入れてね');
  n = Math.max(1, Math.min(30, Number(n) || 1));
  let path = ytChannelPath(q);
  if (!path) {
    const vid = ytVideoId(q);
    if (!vid) throw yerr('badinput', 'チャンネル(@ハンドル)か配信のURLの形ではないみたい');
    const w = await ytFetchText('https://www.youtube.com/watch?v=' + vid);
    const uc = (w.match(/"externalChannelId":"(UC[\w-]{22})"/) || w.match(/"channelId":"(UC[\w-]{22})"/) || [])[1];
    if (!uc) throw yerr('notfound', 'その配信のチャンネルがわかりません');
    path = 'channel/' + uc;
  }
  const html = await ytFetchText('https://www.youtube.com/' + encodeURI(path) + '/streams');
  const data = ytJsonAfter(html, 'ytInitialData');
  if (!data) throw yerr('parse', 'YouTube のページを読み取れませんでした(YouTube の作りが変わったかも)', 502);
  const items = [], seen = new Set();
  (function walk(x) {
    if (!x || typeof x !== 'object' || items.length >= n) return;
    if (x.lockupViewModel || x.videoRenderer || x.gridVideoRenderer) {
      const it = ytArchiveOf(x);
      if (it && !seen.has(it.id)) { seen.add(it.id); items.push(it); }
      return;
    }
    for (const k in x) walk(x[k]);
  })(data);
  const channel = decodeHtml((html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || '');
  return { channel, items };
}

module.exports = { resolve: ytResolve, init: ytInit, next: ytNext, latest: ytLatest, vinfo: ytVinfo, _archiveOf: ytArchiveOf, _startOf: ytStartOf };
