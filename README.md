# AI Tower ✈ `v0.3.1`

**A local control tower for background AI coding agents** — shows every agent job as a retro flight strip and lets you dispatch GitHub issues to agents (Grok CLI, Claude Code, Codex CLI, Antigravity) with one **Takeoff** button.

[繁體中文](#繁體中文) · [English](#english)

![AI Tower board (demo data)](docs/screenshot.png)

---

## English

### What it is
AI Tower is a tiny Node.js server (no dependencies) plus a single page. Every 10 s it reads, **read-only**:

- `ps` — runner scripts and agent processes (`grok -p`, `claude -p`, `agy -p`, `codex exec`, including stand-alone `codex exec`);
- runner logs — keyword lines `START / EXIT / LIMITCHECK / SLEEP / ROUND / DONE / STOP`;
- each worktree's progress file (`Status: …` line) and latest commit;
- open GitHub issues via `gh issue list` (cached 5 min).

Agents are shown as airlines — **GK Grok Air**, **CL Claude Airways**, **CX Codex Airlines**, **AG Antigravity Air** — with geometric tail-fin badges (no real logos).

| Bay | Meaning |
|---|---|
| **PARK** | open issues nobody is working on (search, milestone and repo filters). Issues that need a human on a real device (label or title start matching `manualIssueRegex`, default `manual\|實機`) go to a collapsible **🔧 needs a real device** section at the bottom: no drag handle, can't be queued or taken off, never picked by auto pilot |
| **READY TO FLY** | four airline lanes — drag issues in to queue them; runners between rounds (TAXI) or waiting for quota (HOLDING) also live here |
| **TAKEOFF** | agent process running now, live elapsed timer |
| **GOOD DAY** | finished (READY TO MERGE) · STOPPED (intentional, grey) · **DIVERTED** (abnormal exit, red, plus an alert row). **✕ 已知道** hides a card (5 s undo, kept in `data/dismissed.json`); every card auto-hides after `goodDayHideHours` (default 6) |

Click the **AI TOWER** title to flip to **StarBase** (v0.3.1), a full-screen launch complex for the three DEV Grok Bot pads — 沃茲, 克雷格, 強尼. Other agents are ignored. All three pads play the same Starship animation; agent name, role and status sit in the chrome around it. See [StarBase](#starbase).

v0.3.0 — StarBase uses Andy's three Remotion scenes (stack / fuel / launch), two full-screen views, and a featured-agent layout.

v0.3.1 — Safari freeze fix: Remotion waits on a suspended AudioContext before advancing frames, so the silent player now hides AudioContext and uses requestAnimationFrame.

Flight number = airline code + the line's **primary issue** (first `#N` in its runner-table comment, else in its progress file); other issues show as blue tags.

### Dispatch
- Drag a PARK card (by its `≡` handle) into a lane; reorder within a lane; drag back to PARK to unqueue. 5 s undo. Keyboard: Space pick up · ↑↓ reorder · ←→ change lane · Space drop · Esc cancel.
- **✈ Takeoff** opens a confirm popover (agent, issue, branch, base). On confirm the server: fetches the issue (`gh issue view`), creates a worktree on a new branch `feat/<milestone>-<issue>-<slug>` from the first existing `baseBranches` entry, writes the prompt from your template, adds the line to the runner's case table (backup + `bash -n` first, atomic rename), and launches the runner detached. The card moves to TAKEOFF once the agent process is seen. Every takeoff is logged to `<logsDir>/tower-dispatch.log`.
- **MANUAL / AUTO PILOT** (header) plus a per-lane AUTO switch. Auto pilot departs the first card of each enabled lane when the airline has capacity (default GK 6, others 2, global 8) and is not holding for a usage limit. Only GK is AUTO ON by default; any lane can be locked to manual with `manualOnly`.
- **⚙ Model / effort** chip in every lane header: pick the model and reasoning effort from the lists each CLI reports (`grok models`, `claude --help`, `~/.codex/models_cache.json`, `agy models`). Saved to `<logsDir>/tower-models.env`; a per-flight override lives in the card's 詳細 (`tower-models.d/<line>.env`). The runner re-reads them at the start of every round, so changes apply to the **next round** and never interrupt a running agent. The first save installs a small hook in your runner (backup + `bash -n`); `examples/runner.example.sh` already has it.

### Install
Requirements: macOS or Linux, Node.js 18+, python3, git, [GitHub CLI](https://cli.github.com) (`gh auth login`).

```bash
git clone https://github.com/AndyJuang/ai-tower.git && cd ai-tower
./install.sh --demo        # demo data, nothing is launched → http://127.0.0.1:4777
./stop.sh
# real use: edit config.json (created by install.sh), copy the example runner, then
cp examples/runner.example.sh <logsDir>/runner.sh
./install.sh               # or ./start.sh / ./stop.sh
```

### Config (`config.json`, gitignored)
| key | meaning |
|---|---|
| `baseDir`, `logsDir` | where repos/worktrees and runner logs live (`~`, `{baseDir}` allowed) |
| `runnerScript` | runner file in `logsDir` with a `case "$A" in … *) …` table (see `examples/runner.example.sh`) |
| `logPattern`, `promptPattern`, `worktreePattern`, `mainCheckout` | file naming, `{line}` placeholder |
| `issueRepos`, `dispatchRepo`, `baseBranches` | PARK sources; primary repo and its base branch order |
| `products`, `primaryProduct` | repo → product `{name, short, color}`; every card and issue tag gets a badge (`MA #12`); flight numbers of non-primary products carry the code (`GK MD-12`) |
| `repos`, `promptTemplateOther`, `worktreeVar` | other repos can take off when they have a local clone (`repos[r].clone`, or auto-found as a git clone directly under `baseDir`); otherwise browse-only. Worktree `<clone>-wt-<line>`, base = `repos[r].baseBranches` or the origin default branch, prompt = `repos[r].promptTemplate` or `promptTemplateOther`. The runner gets a one-time `WTX` hook (backup + `bash -n`) so the case entry can point at that worktree; `worktreeVar` names the runner's worktree variable |
| `promptTemplate` | Markdown template with `{{issueTitle}}`, `{{issueBody}}`, `{{branch}}`, `{{pushRule}}`, `{{include:file}}` … |
| `lanes.XX.cap / auto / manualOnly / idleLabel`, `globalCap` | capacity and auto-pilot rules |
| `agentBins`, `modelCatalog` | optional CLI paths and a static model/effort list per lane (overrides discovery) |
| `manualIssueRegex`, `manualSectionTitle` | issues that need a real device (matched on labels and the start of the title) and the PARK section title |
| `goodDayHideHours`, `landedKeepMin` | GOOD DAY auto-hide (default 6 h) and when LANDED cards dim (30 min). StarBase “已升空” uses the same hide window |
| `starbaseDir`, `starbaseAgents` | StarBase status directory (default `{logsDir}/starbase/agents`) and the three pads (`name` / `role` / `vehicle`). `vehicle` is kept on the config object; the UI plays one Starship animation for every agent |
| `doneRegex`, `stopByNames`, `tzLabel`, `cutoffHour`, `launchPrefix` | progress "done" marker, who counts as an intentional stop, clock label, runner cutoff hour, launch prefix (default `nice -n 10` [+ `caffeinate -i` on macOS]) |

Local state (`data/`: lane order, settings, issue cache, dispatched list) is gitignored. `titles.json` (optional) maps line/branch → friendly title.

### Security
- Binds **127.0.0.1 only**; requests with a non-loopback `Host` are refused (DNS-rebinding guard).
- Mutating endpoints (`/api/lanes`, `/api/settings`, `/api/preview`, `/api/takeoff`) need the **session token** embedded in the served page **and** a same-origin `Origin` header. The token is kept in `data/session-token` (gitignored, mode 600) so it survives restarts; an open page that hits a stale token re-reads it from `/api/token` (same-origin only) and retries once.
- Read-only towards running jobs: it never kills or edits a running runner; the runner file is only appended to (with backup) on Takeoff.
- Lanes start AUTO OFF except GK; `manualOnly` locks a lane to manual Takeoff. Background agents are told (prompt template) never to open GUI apps or browsers.
- No telemetry, no external calls except `gh` / `git` you already use.

### Limitations
- Process and log parsing assume the example runner's log format and `LC_ALL=C date` output.
- One dispatch repo at a time; other repos are browsable in PARK only.
- "Do not dispatch while I'm recording/presenting" is not implemented — use MANUAL mode.

### StarBase

A full-screen night launch complex. Click **AI TOWER** in the header to flip up into it; click **StarBase 發射場** to flip back. The last view is stored as `tower.view`. `prefers-reduced-motion` skips the flip.

The featured pad is large (8:3 animation plus task detail). The other two sit in a row below. Click a lower pad to FLIP it into the featured slot (`tower.sbFeatured`). Default featured: the agent with an in-progress or blocked task, or 沃茲 if several or none.

All three agents play the **same Starship** Remotion animation (Super Heavy + ship, OLM-A, chopsticks). There is no Falcon 9 / McGregor variant and no per-agent vehicle switch. Name, role and status chips are UI chrome around the player.

| Agent | Role |
|---|---|
| 沃茲 | desktop app |
| 克雷格 | iPhone / iPad app |
| 強尼 | design |

| Task status | Scene |
|---|---|
| idle (queued only, or no live task) | 01 stack, paused at frame 12 |
| task just started (queued→in_progress, or new in_progress with `started_at` within 90 s) | 01 plays once → 02 from 0 (3 s intro) → 02 loops 90–389 |
| already in_progress on page load | 02 `intro=0` loop |
| in_progress | 02 loop. Optional task `progress` (0–1 or 0–100) becomes `?progress=` clamped to 0.05–0.98 |
| blocked | 02 paused (frame 240 if that is how the page loaded) + grayscale + **HOLD · 卡住**. Blocked→in_progress resumes |
| done (`done_at` within 90 s, or the page just saw in_progress/blocked→done) | 03 plays once (26 s) → idle 01@12. The task then sits in **已升空** until `goodDayHideHours` |
| queue combos | 01 playing then the task finishes → 01 ends, skip 02, play 03. 03 playing then a new in_progress → 03 ends, then 01→02 |
| `prefers-reduced-motion` | all still: idle 01@12; in_progress 02@240; blocked 02@240 + HOLD; done 03@640 for 6 s then idle |

Status files are written by the agents themselves. The tower only reads them.

- Path: `starbaseDir` / `<agent>.json` (default `{logsDir}/starbase/agents/沃茲.json` …).
- Shape: one object, an array, or `{ "tasks": [...] }`.
- Fields: `agent`, `task`, `status`, `started_at`, `updated_at`, `done_at`, `link` (http/https only), `note`, optional `progress`.
- A half-written / invalid JSON file keeps the last good read; a missing file means no tasks.
- Read-only API: `GET /api/starbase` (same host guard, `no-store`). The same payload is on `/api/strips` as `starbase`, so the page does not need a second poll.
- Animation player: `/starbase/player.html` + shared `/starbase/starbase.js` (Cache-Control: public, 1 day). The Remotion Player bundle is **not in this repo** ([Remotion License](https://www.remotion.dev/license) is not OSI open source and is incompatible with this MIT project). Put `01-stack.html` / `02-fuel.html` / `03-launch.html` in `public/starbase/src/` (gitignored) and run `node tools/extract-starbase.js` to write `public/starbase/starbase.js` (also gitignored). Without those files the pads show a static “動畫檔未安裝” placeholder; chips, HOLD, and featured switching still work.

Helper (atomic write, upsert by task title):

```bash
STARBASE_DIR=~/projects/_agent-logs/starbase/agents
cp examples/starbase-report.sh "$STARBASE_DIR/../starbase-report.sh"   # optional
STARBASE_DIR="$STARBASE_DIR" ./examples/starbase-report.sh 沃茲 進行中 "StarBase 模式開發" https://github.com/example/ai-tower "note"
```

Demo: `TOWER_DEMO=1` includes all four statuses on the three pads.

---

## 繁體中文

### 這是什麼
AI Tower 是一個本機「塔台」：把背景跑的 AI 寫程式代理（Grok CLI、Claude Code、Codex CLI、Antigravity）用**復古航班條（flight strip）**呈現，並可把 GitHub issue 拖進各航空公司跑道、按 **✈ Takeoff** 直接派工。零相依的 Node.js 伺服器＋單一頁面，每 10 秒**唯讀**讀取 `ps`、runner 日誌、各 worktree 的進度檔與最新 commit，以及 `gh issue list`（快取 5 分鐘）。

四個航空公司：**GK Grok Air**、**CL Claude Airways**、**CX Codex Airlines**、**AG Antigravity Air**（幾何尾翼徽章，不使用任何真實商標）。

| 區 | 意義 |
|---|---|
| **PARK 待辦** | 還沒人做的 open issue（搜尋、milestone、repo 篩選）。需要實機測試的 issue（label 或標題開頭符合 `manualIssueRegex`，預設 `manual\|實機`）放在底部可收合的 **🔧 需要實機** 區：沒有拖曳把手、不能排班或起飛、Auto Pilot 不會選 |
| **READY TO FLY 排班** | 四條航空公司跑道；拖進來就排班。輪與輪之間（TAXI）或等額度（HOLDING）的 runner 也在這 |
| **TAKEOFF 飛行中** | agent 程序正在跑，即時計時 |
| **GOOD DAY 已落地** | 完成（READY TO MERGE／可整合）、STOPPED（刻意停止，灰）、**DIVERTED**（異常結束，紅＋警示列）。按 **✕ 已知道** 可隱藏（5 秒內可撤銷，記在 `data/dismissed.json`）；超過 `goodDayHideHours`（預設 6 小時）自動隱藏 |

點 header 的 **AI TOWER** 標題會翻到全螢幕 **StarBase**（v0.3.1），只顯示三位 DEV Grok Bot：沃茲、克雷格、強尼。其他 agent 忽略。三位都播同一段 Starship 動畫，名字／職責／狀態疊在外框。見下方「StarBase」。

v0.3.0 — 三段 Remotion 動畫（上台／加注／發射回收）、塔台與發射場兩個全螢幕頁、可點選的主角 agent。

v0.3.1 — Safari 動畫凍結修正：Remotion 會等 AudioContext.resume() 才推進畫格，iframe 裡沒有使用者手勢時 Safari 永遠不放行。

航班號 = 航空公司代碼 + 該 line 的**主要 issue**（runner 對照表註解中的第一個 `#N`，沒有就看進度檔）；其他 issue 顯示為藍色標籤。

### 派工
- 抓 `≡` 把手把 PARK 卡拖進跑道；跑道內可調順序；拖回 PARK 取消排班；5 秒內可撤銷。鍵盤：空白鍵拿起、↑↓ 排序、←→ 換跑道、空白鍵放下、Esc 取消。
- 按 **✈ Takeoff** 會先跳確認（agent、issue、分支、base）。確認後：抓 issue 內容、從 `baseBranches` 第一個存在的分支開新 worktree 與分支 `feat/<milestone>-<issue>-<slug>`、依範本寫 prompt、把該 line 安全地加入 runner 的 case 表（先備份、`bash -n` 檢查、原子替換）、背景啟動 runner。看到 agent 程序後卡片移到 TAKEOFF。每次起飛都記錄在 `<logsDir>/tower-dispatch.log`。
- 上方 **MANUAL / AUTO PILOT** 總開關＋每條跑道 AUTO 開關。自動駕駛會在該航空公司有容量（預設 GK 6、其他 2、全域 8）且沒有因額度上限在等待時，讓跑道第一班起飛。預設只有 GK 開 AUTO；任何跑道都可用 `manualOnly` 鎖成只能手動。
- 每條跑道標頭的 **⚙ 模型 · effort**：從各 CLI 自己回報的清單選模型與推理強度（`grok models`、`claude --help`、`~/.codex/models_cache.json`、`agy models`）。存到 `<logsDir>/tower-models.env`；單一航班可在卡片「詳細」覆寫（`tower-models.d/<line>.env`）。runner 每一輪開始都會重讀，所以**下一輪生效**，不會中斷正在跑的 agent。第一次儲存會在 runner 加入讀設定的 hook（先備份＋`bash -n`）；`examples/runner.example.sh` 已內建。

### 安裝
需要 macOS 或 Linux、Node.js 18+、python3、git、[GitHub CLI](https://cli.github.com)（先 `gh auth login`）。

```bash
git clone https://github.com/AndyJuang/ai-tower.git && cd ai-tower
./install.sh --demo        # 示範資料，不會真的啟動任何東西 → http://127.0.0.1:4777
./stop.sh
# 正式使用：編輯 install.sh 產生的 config.json，複製範例 runner，然後
cp examples/runner.example.sh <logsDir>/runner.sh
./install.sh               # 或 ./start.sh / ./stop.sh
```

設定項目見上方英文表格；本機狀態（`data/`：跑道順序、設定、issue 快取、派工紀錄）與 `config.json` 都不進 git。StarBase 另讀 `starbaseDir`（預設 `{logsDir}/starbase/agents`）裡的 `<agent>.json`。

### 安全性
- 只綁 **127.0.0.1**；`Host` 不是本機的請求一律拒絕（防 DNS rebinding）。
- 會改動狀態的 API 需要頁面內嵌的 **session token**，且 `Origin` 必須同源。token 存在 `data/session-token`（不進 git、權限 600），重啟後不變；已開著的頁面若遇到舊 token，會自動向 `/api/token`（限同源）重新取得並重試一次。
- 對執行中的工作唯讀：不會砍或修改正在跑的 runner；只有 Takeoff 會在備份後新增 runner 條目。
- 預設只有 GK 開 AUTO；`manualOnly` 可把跑道鎖成只能手動；prompt 範本要求背景代理不得開任何 GUI 或瀏覽器。
- 沒有遙測；除了你本來就在用的 `gh`／`git` 之外不連外。

### 限制
- 日誌解析依賴範例 runner 的格式與 `LC_ALL=C date` 輸出。
- 一次只派工到一個 repo；其他 repo 只能在 PARK 瀏覽。
- 「錄影／簡報中不要派工」尚未實作——請用 MANUAL 模式。

### StarBase

全螢幕夜間發射場。點 **AI TOWER** 標題往上翻進去；點 **StarBase 發射場** 往下翻回塔台。上次模式記在 `tower.view`。系統若要求減少動態效果（`prefers-reduced-motion`），切換是瞬間的，沒有翻轉。

上方大矩形是主角 agent（8:3 動畫＋任務細節），下方兩個中型矩形並排。點下方卡片會用 FLIP 平滑換到主角位置（`tower.sbFeatured`）。預設主角：有進行中或卡住任務的那位；同時多位或都沒有就是沃茲。

三位 agent 都播**同一段 Starship** 動畫（超重型＋星艦、OLM-A、筷子機械臂）。沒有 Falcon 9／麥格雷戈變體，也沒有「選載具」參數。名字、職責、狀態 chip 疊在動畫外框。

| Agent | 負責 |
|---|---|
| 沃茲 | 桌面 App |
| 克雷格 | iPhone/iPad App |
| 強尼 | 設計 |

| 任務狀態 | 畫面 |
|---|---|
| 待命（只有排隊，或沒有進行中／卡住） | 01 吊掛上台，停在第 12 幀 |
| 任務剛開始（排隊→進行中，或新的進行中且 `started_at` 在 90 秒內） | 01 播一次 → 02 從 0 播（含 3 秒開場）→ 02 在 90–389 循環 |
| 頁面載入時就已經在進行中 | 02 `intro=0` 循環 |
| 進行中 | 02 循環。任務若有 `progress`（0–1 或 0–100）會換成 `?progress=`（夾在 0.05–0.98） |
| 卡住 | 02 暫停（剛載入則停在第 240 幀）＋灰階＋**HOLD · 卡住**。卡住→進行中會繼續播 |
| 完成（`done_at` 在 90 秒內，或頁面剛看到進行中／卡住→完成） | 03 播一次（26 秒）→ 回到待命 01@12。任務進 **已升空**，超過 `goodDayHideHours` 隱藏 |
| 排隊組合 | 01 播到一半就完成 → 01 播完直接接 03。03 播到一半又有新的進行中 → 03 播完接 01→02 |
| `prefers-reduced-motion` | 全部靜態：待命 01@12；進行中 02@240；卡住 02@240＋HOLD；完成 03@640 停 6 秒後回待命 |

狀態檔由 agent 自己寫，塔台只讀。

- 路徑：`starbaseDir`／`<agent>.json`（預設 `{logsDir}/starbase/agents/`）。
- 格式：單一物件、物件陣列、或 `{ "tasks": [...] }`。
- 欄位：`agent`、`task`、`status`、`started_at`、`updated_at`、`done_at`、`link`（只接受 http/https）、`note`、可選 `progress`。
- 寫到一半或壞 JSON：沿用上次成功讀到的內容；檔案不存在＝沒任務。
- `GET /api/starbase`（唯讀、host 檢查、`no-store`）；同一份資料也在 `/api/strips` 的 `starbase` 欄位，前端跟著 10 秒 poll 更新。
- 動畫播放器：`/starbase/player.html`＋共用 `/starbase/starbase.js`（快取一天）。Remotion Player 的 bundle **不進這個 repo**（[Remotion 授權](https://www.remotion.dev/license) 不是 OSI 開源授權，跟本專案的 MIT 不相容）。把 `01-stack.html`／`02-fuel.html`／`03-launch.html` 放到 `public/starbase/src/`（已 gitignore），再跑 `node tools/extract-starbase.js` 產出 `public/starbase/starbase.js`（同樣 gitignore）。沒有這些檔時，面板顯示靜態「動畫檔未安裝」佔位，chip、HOLD、主角切換照常。

Helper（原子寫入，同一個 task 標題會更新同一筆）：

```bash
STARBASE_DIR=~/projects/_agent-logs/starbase/agents
./examples/starbase-report.sh 沃茲 進行中 "StarBase 模式開發" https://github.com/example/ai-tower "Grok CLI 實作中"
./examples/starbase-report.sh 沃茲 完成 "StarBase 模式開發"
```

`TOWER_DEMO=1` 的示範資料涵蓋四種狀態。

## License
[MIT](LICENSE)

Screenshots use the built-in demo data (`./install.sh --demo`).
