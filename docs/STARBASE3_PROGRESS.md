# StarBase v0.3.0 進度

- 狀態：可整合
- 版本：v0.3.0
- 分支：feat/starbase
- 功能 commit：`b151af2`
- 日期：2026-10-12

## 這次要做

依 `docs/STARBASE3_FEEDBACK.md` 只修 Grok Bot 列出的 6 項。

## 做了什麼

- 01／03 播一次：iframe `dataset.started = clipKey|mode|phase`，同一簽名只送 `{cmd:'resume'}`，不再每次 poll 從 0 重播。`loadClip`／`blankIframe` 清掉 started。
- `bridge.js`：`startSoon()` 兩個 rAF 後才 play；300ms watchdog 在 isPlaying 但畫格不動時 pause→seek→play。新增 `{cmd:'resume'}`。visibility 回來也走 startSoon。等不到 `__player` 約 3 秒回報 error。
- 收到 ended、狀態機換段後立刻 `refreshPadChrome()` 更新 chip／文字。
- HOLD 標籤改到動畫底部中央、紅黃條紋上方。
- Remotion bundle 不進公開 repo：`.gitignore` 加 `public/starbase/starbase.js`、`public/starbase/src/`，`git rm --cached`（磁碟檔留下）。`player.html` script onerror 回報 missing；app 顯示「動畫檔未安裝」佔位。README 寫授權與 extract 步驟。
- StarBase 頁 html／body／stage／view `overflow: hidden`＋`overflow: clip`、`max-height: 100%`，修 1280×800 多 1px 捲動。

## 改了哪些檔

- `public/app.js`、`public/style.css`
- `public/starbase/bridge.js`、`public/starbase/player.html`
- `.gitignore`（untrack `starbase.js` 與 `src/*.html`）
- `tools/extract-starbase.js`、`README.md`
- `tests/ui-static.test.js`、`tests/verify-starbase.js`
- `GATES.md`、`docs/STARBASE3_PROGRESS.md`、`docs/STARBASE3_FEEDBACK.md`

未改、未 commit：`animations/`。bundle 檔留在磁碟、不進 git。

## 測試結果

- `node --check` 所列 JS → STARBASE_SYNTAX_OK
- `node tools/extract-starbase.js` 連跑兩次產物不變 → EXTRACT_OK 525833 bytes
- `tests/*.test.js` 全過（dispatch、processes、starbase-state 25 PASS、starbase、ui-static）
- `node tests/verify-starbase.js --all` → STARBASE_VERIFY_OK（含 NOPATH、4790 demo、4791 真實資料、starbase.js 200 public 525833、`/starbase/__missing__.js` 404、server still up）
- 手動 `TOWER_PORT=4790 TOWER_DEMO=1`：`/` 兩頁＋v0.3.0；`/api/starbase` 沃茲進行中、克雷格卡住、強尼完成＋排隊；player onerror；starbase.js 200、`Cache-Control: public, max-age=86400`、525833 bytes；bridge／starbase-state 200。已殺自己的 pid 60570。4777 未動。

## DEFERRED

Grok Bot 另機截圖：待命／01 播放／02 循環／03 發射／卡住／兩模式／翻頁中間格／各 agent 當主角（確認 once 不再被 poll 重播、HOLD 不擋 HUD、1280×800 不捲）。
