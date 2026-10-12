# StarBase v0.3.1 進度

- 狀態：可整合
- 版本：v0.3.1
- 分支：feat/starbase
- 日期：2026-10-12

## 這次要做

依 `docs/STARBASE3_FEEDBACK.md` 只修 Safari 動畫凍結（v0.3.1）。

## 做了什麼

- `bridge.js` 實作指令佇列緩衝（`createBridgeQueue`），不再丟棄在 `ready()` 前抵達的 early postMessage 指令；並將 `wait()` 加上 `setTimeout` 輔助輪詢（避免 WebKit iframe 初次 rAF 延遲 250ms）；若收到 play 後的 resume 亦視為播放。保留先前的防禦性 AudioContext stub。
- `app.js` 僅在 iframe 回報 `ready` 後才發送播放指令，並在 `ready` 事件到達時補送播放意圖，徹底消除 WebKit/Safari 凍結問題。
- 動畫資產版本改用內容 hash（`SB_ASSET_V` 只是 fallback）。`specUrl()`、`player.html` 的 `bridge.js` 與 `starbase.js` 都帶內容 hash，一般重新整理就拿到新 bridge。
- 拿掉 iframe `sandbox="allow-scripts allow-same-origin"`（兩個一起給等於沒有 sandbox，Chromium 會警告）。
- header 兩處版本小字改 v0.3.1；README 加 v0.3.1 段。

## 改了哪些檔

- `public/starbase/bridge.js`、`public/starbase/player.html`
- `public/app.js`、`public/index.html`
- `tests/ui-static.test.js`、`tests/verify-starbase.js`
- `README.md`、`GATES.md`、`docs/STARBASE3_PROGRESS.md`

未改、未 commit：`animations/`、`public/starbase/starbase.js`、`public/starbase/src/`。

## 測試結果

- `node --check` 所列 JS → STARBASE_SYNTAX_OK
- `tests/*.test.js` 全過（dispatch、processes、starbase-state 25 PASS、starbase、ui-static）
- `node tests/verify-starbase.js --all` → STARBASE_VERIFY_OK（含 NOPATH、4790 demo、4791 真實資料、player.html bridge.js?v=0.3.1、starbase.js 200 public 525833）
- 手動 `TOWER_PORT=4790 TOWER_DEMO=1` pid 80649：`/starbase/player.html?v=0.3.1&scene=fuel` 200、`Cache-Control: public, max-age=86400`、body 含 `bridge.js?v=0.3.1` 與 `starbase.js?v=0.3.1`；`/` 兩處 v0.3.1。已殺自己的 pid 80649。4777 未動。

## DEFERRED

Grok Bot 另機截圖：Safari 02 加注循環是否真的在走（不再停在第 90 幀）；待命／01／03／卡住／兩模式。

## 上一版 v0.3.0

once 不重播、play watchdog、chip 即時、HOLD 底部、bundle gitignore、1280×800 不捲。
