#!/bin/bash
# StarBase status reporter (AI Tower v0.2.0). Atomically writes/updates <dir>/<agent>.json.
# usage: starbase-report.sh <agent> <status> <task> [link] [note]
#   agent : 沃茲 | 克雷格 | 強尼   (any name works; the tower only shows these three)
#   status: 排隊 | 進行中 | 卡住 | 完成
#   task  : short title; the same title updates the same task (upsert), a new title adds a task
# directory: STARBASE_DIR, else $TOWER_STARBASE_DIR, else ./agents next to this script
# examples:
#   STARBASE_DIR=~/projects/_agent-logs/starbase/agents \
#     examples/starbase-report.sh 沃茲 進行中 "StarBase 模式開發" https://github.com/example/ai-tower "Grok CLI 實作中"
#   STARBASE_DIR=... examples/starbase-report.sh 沃茲 完成 "StarBase 模式開發"
#   STARBASE_KEEP=5 STARBASE_DIR=... examples/starbase-report.sh 強尼 排隊 "新主題"
set -euo pipefail
DIR="${STARBASE_DIR:-${TOWER_STARBASE_DIR:-$(cd "$(dirname "$0")" && pwd)/agents}}"
[ $# -ge 3 ] || { sed -n 3,13p "$0"; exit 2; }
case "$2" in 排隊|進行中|卡住|完成) ;; *) echo "status must be 排隊 / 進行中 / 卡住 / 完成 (got: $2)" >&2; exit 2;; esac
case "$1" in */*|.*|"") echo "bad agent name: $1" >&2; exit 2;; esac
mkdir -p "$DIR"
exec /usr/bin/env python3 - "$DIR" "$@" <<'PY'
import json, os, sys, tempfile, datetime
d, agent, status, task = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
link = sys.argv[5] if len(sys.argv) > 5 else None
note = sys.argv[6] if len(sys.argv) > 6 else None
keep = int(os.environ.get("STARBASE_KEEP", "10"))
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec="seconds")
f = os.path.join(d, agent + ".json")
tasks = []
try:
    with open(f, encoding="utf-8") as fh: cur = json.load(fh)
    if isinstance(cur, dict): tasks = cur.get("tasks") if isinstance(cur.get("tasks"), list) else [cur]
    elif isinstance(cur, list): tasks = cur
except FileNotFoundError: pass
except Exception as e: print("warning: unreadable %s (%s), starting fresh" % (f, e), file=sys.stderr)
tasks = [t for t in tasks if isinstance(t, dict)]
t = next((x for x in tasks if x.get("task") == task), None)
if t is None:
    t = {"agent": agent, "task": task, "status": status, "started_at": now}; tasks.append(t)
if status == "進行中" and t.get("status") in ("排隊", "完成"): t["started_at"] = now
t["agent"] = agent; t["status"] = status; t["updated_at"] = now
if status == "完成": t["done_at"] = now
else: t.pop("done_at", None)
if link is not None: t["link"] = link
if note is not None: t["note"] = note
done = [x for x in tasks if x.get("status") == "完成"]
done.sort(key=lambda x: x.get("done_at") or x.get("updated_at") or "")
drop = {id(x) for x in done[:max(0, len(done) - keep)]}
tasks = [x for x in tasks if id(x) not in drop]
fd, tmp = tempfile.mkstemp(prefix="." + agent + ".", suffix=".tmp", dir=d)
with os.fdopen(fd, "w", encoding="utf-8") as fh: json.dump(tasks, fh, ensure_ascii=False, indent=2); fh.write("\n")
os.chmod(tmp, 0o644); os.replace(tmp, f)
print("%s: %s → %s (%d task%s in %s)" % (agent, task, status, len(tasks), "" if len(tasks) == 1 else "s", f))
PY
