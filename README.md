# Cast Frost 字幕(補助exe)

Cast Frost Web の字幕を、**自分の画面に「枠なし・背景透明・最前面」**で重ねて表示する Windows 用の補助アプリです。
あわせて、Cast Frost Web で設定した**エフェクトの全体ホットキー**を受け付けます(ゲーム中などブラウザが手前にない時でも、キーでエフェクトを出せます)。
また、**YouTube Live のチャットの読み取り**も受け持ちます(ブラウザのアプリは YouTube のチャットを直接読めないため、補助exeがこのPCから読んでアプリに渡します。APIキー・1日の上限なし)。

Yomi Frost 字幕(Yomi Frost Web 用)とは別のアプリです。ポートも起動用リンクも別なので、同時に使えます。

## 使い方
1. `CastFrostSubtitle_v<版>.exe` をダブルクリックで起動(インストール不要)
   - 起動するとタスクトレイ(画面右下)に Cast Frost のアイコンが出ます
2. Cast Frost Web の「🪟 字幕」タブ →「🧩 補助exe」で **🔌 接続する** を押す(一度つながれば、次からはアプリを開くだけで自動で接続します)
3. 字幕の「出し先」で 🧩 補助exe にチェックした字幕が、画面に重なって表示されます

## アプリから起動する
- 補助exeは起動するたびに、自分の保存場所を Windows に「`castfrost://`」というリンクとして登録します
- 一度ダブルクリックで起動しておけば、Cast Frost Web の字幕タブの「▶ 補助exeを起動」で起動できます
- 初回は Chrome が「Cast Frost 字幕 を開きますか?」と聞くので、「常に許可」にチェックして「開く」

## 位置とサイズ
- トレイのアイコン →「位置とサイズを調整する」、または **Ctrl+Alt+C**
- 表示するモニターも、トレイのメニューから選べます

## エフェクトの全体ホットキー
- Cast Frost Web でエフェクトにキー(例:Ctrl+Alt+1)を割り当てると、補助exeが Windows に登録します
- アプリとつながっている間だけ有効です(アプリを閉じると自動で外れます)
- ほかのアプリが使っているキーは登録できません。その時はアプリ側に「使えないキー」と表示されます
- 修飾キー(Ctrl / Alt / Shift / Win)なしの単独キーは、ふだんの入力のじゃまになるので登録しません
- トレイの「エフェクトのホットキーを使う」で、まとめてオフにできます

## YouTube Live のチャット
- Cast Frost Web の 📺画面タブで YouTube(チャンネルの @ハンドル か配信URL)を選んでスタートすると、補助exeが YouTube のチャットを読みます
- 字幕を使わない時も、補助exeを起動しておくだけでOK(トレイに常駐)
- YouTube の公開された仕組みではなく、チャット欄と同じものを読んでいます。YouTube 側の変更で読めなくなった時は、補助exeの更新で直します
- 通信はこのPCから YouTube へ直接行います(Cloudflare などの中継は使いません)

## 安全のための仕組み
- 待ち受けるのはこのPCの中(127.0.0.1)だけです。ほかのPCからはつながりません
- 接続してよいページを限定しています(初期値:`https://cast.rider.tokyo`、`https://*.pages.dev`、`http://localhost:*`、`http://127.0.0.1:*`)
- ポート番号(初期値 **50230**)と許可するページは、トレイ →「設定ファイルを開く」の `config.json` で変えられます(変えたら補助exeを起動し直してね。ポートを変えたらアプリ側のポートも同じに)

## ビルドと公開(GitHub Actions)
- `main` に変更を置くと、Actions の `build-exe` が Windows 用の exe をビルドします
- `package.json` の `version` がまだ Releases に無い版なら、ビルドした exe を Releases に自動で公開します(タグ `v<版>`、説明は `RELEASE_NOTES.md`)
- Cast Frost Web の `config.js` の `exeRepo` が `compact-git/cast-frost-subtitle` なので、字幕タブの「⬇ 補助exeをダウンロード」ボタンが最新リリースの exe を直接ダウンロードします
- `subrender.js` は Cast Frost Web と同じファイルです。アプリ側で字幕の描き方を変えた時は、これも差し替えてビルドし直してください

## ファイル
- `main.js` 本体(透明・最前面の窓、トレイ、127.0.0.1 の WebSocket サーバー、Ctrl+Alt+C、全体ホットキー)
- `youtube.js` YouTube Live のチャットを読む(配信さがし・チャットの開始・続きの取得)
- `overlay.html` / `overlay.js` 字幕を表示する窓
- `preload.js` 窓と本体のやりとり
- `subrender.js` 字幕の描画(Cast Frost Web と共通)
- `build/` アイコン

## アプリとのやりとり(開発用メモ)
- アプリ → exe:字幕 `{ app:'castfrost', v, rv, pipW, pipH, boxes }`、ホットキー一覧 `{ app:'castfrost', type:'hotkeys', keys:[{ id, accel, label }] }`
- アプリ → exe:YouTube `{ app:'castfrost', type:'yt', reqId, op:'resolve'|'init'|'next', q | v | body }`
- exe → アプリ:YouTube の返事 `{ type:'res', reqId, ok, data | error:{ code, status, message } }`
- exe → アプリ:接続時 `{ app:'castfrost-exe', version, path, features:['subtitle','hotkeys','youtube'], hotkeysOn }`、登録結果 `{ type:'hotkeys-result', results:[{ id, accel, ok, reason }] }`(reason: invalid / duplicate / taken / off)、押された時 `{ type:'hotkey', id }`、再送のお願い `{ type:'hotkeys-request' }`

## アンインストール
1. トレイ →「Windows の起動時に起動する」のチェックを外す
2. exe を削除
3. 設定フォルダ `%APPDATA%\Cast Frost 字幕` を削除
4. 起動用リンクの登録を消す(コマンドプロンプトで)
   reg delete "HKCU\Software\Classes\castfrost" /f

## About (English)
Cast Frost Subtitle is a small Windows helper for Cast Frost Web. It shows subtitles in a frameless, transparent, always-on-top, click-through window, and registers global hotkeys for on-stream effects on behalf of the web app.
It also reads YouTube Live chat on behalf of the web app (browsers cannot read it directly), connecting from this PC straight to YouTube.
It only communicates with Cast Frost Web on the same PC through a local WebSocket (127.0.0.1), and only accepts connections from allowed origins.
- On every launch, it registers the `castfrost://` URL scheme for the current user (`HKCU\Software\Classes\castfrost`) so that Cast Frost Web can start it.
- Settings are stored in `%APPDATA%\Cast Frost 字幕\config.json`.

## License
MIT License(`LICENSE`)
