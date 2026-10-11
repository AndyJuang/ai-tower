# StarBase 進度

狀態：可整合

分支：`feat/starbase`（從 origin/main 7494203 = v0.1.7 開出）
版本：v0.2.1
畫面驗證：DEFERRED — Grok Bot 另機截圖（本機背景代理不准開 GUI／瀏覽器）

## 回饋回合 #2（docs/STARBASE_FEEDBACK.md，2026-10-12）— v0.2.1 視覺

- 場景 176px、`xMidYMax meet`（鼻錐完整可見）；火箭約佔場景高度 85%
- 格子鋼塔＋避雷針紅燈、筷子／臍帶臂、支撐腳與導焰槽、遠景油槽／水塔、更亮的探照燈光錐
- 星空：36 顆大小亮度不同的星、銀河淡帶、地平線橙／藍光害、20–40 秒流星
- SVG `feGaussianBlur` 金屬光暈；加注時發射台底部橘光
- 加注蒸氣（側邊＋底部多層圓）；Falcon 頂部液氧排氣；Starship 兩節白霜線
- 燃料條改發射塔旁直立 7px 條，字在右側直書「加注中」
- 升空 3.6 秒（閃光→火焰→煙雲→加速上升）；麥格雷戈水平噴焰＋煙往右
- HOLD：火箭降飽和、塔燈改紅、底部 15px 警示條＋左上牌子
- 清單單列精簡；已升空列 min/max-height 28px，不被裁半行
- 標題列版本 `v0.2.1`

驗證：`node --check` 全部 js；`node tests/starbase.test.js`、`tests/processes.test.js`、`tests/dispatch.test.js`、`tests/ui-static.test.js` PASS；`TOWER_PORT=4790 TOWER_DEMO=1` 與 4791 真實資料 curl 經 `tests/verify-starbase.js --api` 通過並只殺自己的 pid。4777 未動。

功能 commit：`848f917`

## 回饋回合 #1（docs/STARBASE_FEEDBACK.md 前一版）

- A. 場景 SVG 改 480×150、`xMidYMax slice` 鋪滿；Starship 兩節＋筷子；Falcon 放大；麥格雷戈改水平引擎測試架；HOLD 改底部 15px 細條＋左上牌子；清單最多 2 列＋已升空 1 列，多的＋N／內捲；燃料條 7px、字在右側
- B. `.bays { grid-template-columns: repeat(4, minmax(0, 1fr)); }`，1180／640 斷點保留
- C. Fixes #1：stale line 重用（TAKEOFF-REUSE）；正在跑則「這條已經在飛」＋跳到該卡片；錯誤去重；mapProcesses 取最上層 runner、owned 含同 line 子孫；capacity 只算活著的、同 line 一次、grace 只在 ps 還沒看到時加；中文 cap 訊息；Auto Pilot 起飛前再查 live cap，同一 ref 90 秒不重複

## 做了什麼

- 塔台最上層加 StarBase：沃茲／Starship、克雷格／Falcon 9、強尼／麥格雷戈，左到右三個發射場
- 任務當火箭：排隊立在台上、進行中加注（蒸氣＋燃料條＋塔燈）、卡住 HOLD、完成升空後進「已升空」（`goodDayHideHours` 後隱藏）
- `lib/starbase.js` 解析單一物件／陣列／`{tasks}`；壞 JSON 沿用上次成功內容；只接受 http/https link
- `GET /api/starbase` 與 `/api/strips` 的 `starbase` 欄位；`TOWER_DEMO=1` 涵蓋四種狀態
- config：`starbaseDir`（預設 `{logsDir}/starbase/agents`）、`starbaseAgents`
- helper：`examples/starbase-report.sh`（`STARBASE_DIR` 可設定）
- 可收合（localStorage，預設展開）；`prefers-reduced-motion` 關動畫
- 標題旁小字 `v0.2.1`

## 怎麼驗證

- `node --check server.js public/app.js lib/*.js tests/*.js` 通過
- `node tests/starbase.test.js` → PASS（10 項）
- `node tests/ui-static.test.js` → PASS（v0.2.1 場景／meet／光暈／流星／直立燃料條／已升空不裁）
- `TOWER_PORT=4790 TOWER_DEMO=1`：`/api/starbase` 三 agent、四種狀態；`/api/strips` 有 `starbase`；`/` 有 `id="starbase"` 與 `v0.2.1`；壞 Host → 421。已殺 pid
- `TOWER_PORT=4791` 指向真實 `_grok-logs/starbase/agents`（只讀）：沃茲有任務。已殺 pid。4777 未動

## 已知限制

- 畫面與動畫只能另機截圖確認
- 強尼目前沒有狀態檔，發射台為空是預期
- 升空動畫在 poll 重繪時可能重來（poll 10 秒、動畫 3.6 秒，一般碰不到）
