#!/bin/bash
# AI Tower — example runner.  One "line" = one AI agent working one branch in its own git worktree.
#   usage:  runner.sh <line>
# AI Tower reads this file's case table (line -> branch / progress file) and, on Takeoff, inserts a new
# entry right above the `  *)` default branch (after making a backup and checking `bash -n`).
# It also tails <logsDir>/<line>.log for the keyword lines written below — keep their format.
export LC_ALL=C          # `date` output must be English: "Sun Oct 11 21:24:16 CST 2026"
set -u
A="${1:?usage: runner.sh <line>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="${TOWER_BASE:-$HOME/projects}"            # = config.json baseDir
WT="$BASE/my-app-wt-$A"                          # = config.json worktreePattern
LOG="$HERE/$A.log"; PROMPT="$HERE/$A-prompt.md"  # = logPattern / promptPattern
ts() { date -j -f "%Y-%m-%d %H:%M" "$1" +%s 2>/dev/null || date -d "$1" +%s; }
fmt() { date -r "$1" 2>/dev/null || date -d "@$1"; }

case "$A" in
  grok-demo-example) BR=feat/example; START=00:00; CUT="2030-01-01 08:00"; PF=docs/EXAMPLE_PROGRESS.md;;  # #1 example line
  *) echo "bad line $A"; exit 2;;
esac

# Agent CLI per airline (line prefix), rebuilt every round so AI Tower's ⚙ model / effort settings apply to the next round.
agent_cmd() {
  # AI Tower: per-airline model/effort — re-read every round (tower-models.env + tower-models.d/<line>.env)
  TM=; TE=; [ -f "$HERE/tower-models.env" ] && . "$HERE/tower-models.env"
  case "$A" in codex-*) TM=${TOWER_CX_MODEL:-}; TE=${TOWER_CX_EFFORT:-};; claude-*) TM=${TOWER_CL_MODEL:-}; TE=${TOWER_CL_EFFORT:-};; grok-*) TM=${TOWER_GK_MODEL:-}; TE=${TOWER_GK_EFFORT:-};; antigravity-*) TM=${TOWER_AG_MODEL:-}; TE=${TOWER_AG_EFFORT:-};; esac
  TOWER_LINE_MODEL=; TOWER_LINE_EFFORT=; [ -f "$HERE/tower-models.d/$A.env" ] && . "$HERE/tower-models.d/$A.env"
  TM=${TOWER_LINE_MODEL:-$TM}; TE=${TOWER_LINE_EFFORT:-$TE}
  case "$A" in   # add the permission flags you use yourself
    grok-*)        AGENT=(grok ${TM:+-m "$TM"} ${TE:+--reasoning-effort "$TE"} -p);;   # prompt follows -p
    claude-*)      AGENT=(claude ${TM:+--model "$TM"} ${TE:+--effort "$TE"} -p);;
    antigravity-*) AGENT=(agy ${TM:+--model "$TM"} ${TE:+--effort "$TE"} -p);;
    codex-*)       AGENT=(codex exec ${TM:+-m "$TM"} ${TE:+-c "model_reasoning_effort=\"$TE\""});;
    *) echo "no agent for $A"; exit 2;;
  esac
}

CUTOFF=$(ts "$CUT"); GAP=300; n=0
echo "RUNNER pid $$ $(date) worktree $WT branch $BR start-at $START" >> "$LOG"
while :; do
  if [ "$(date +%s)" -ge "$CUTOFF" ]; then echo "STOP cutoff $CUT reached $(date)" >> "$LOG"; break; fi
  n=$((n + 1))
  echo "START attempt $n $(date) pid $$ branch $BR head $(git -C "$WT" rev-parse --short HEAD 2>/dev/null)" >> "$LOG"
  agent_cmd
  ( cd "$WT" && "${AGENT[@]}" "$(cat "$PROMPT")" ) >> "$LOG" 2>&1; code=$?
  echo "EXIT attempt $n code $code $(date)" >> "$LOG"
  if tail -n 60 "$LOG" | grep -qiE 'usage limit|rate limit|quota exceeded'; then
    echo "LIMITCHECK LIMIT $(date)" >> "$LOG"
    resume=$(( $(date +%s) + 1800 ))
    echo "SLEEP 1800 s for usage limit, resume at $(fmt $resume)" >> "$LOG"; sleep 1800; continue
  fi
  echo "LIMITCHECK NOLIMIT $(date)" >> "$LOG"
  if head -n 12 "$WT/$PF" 2>/dev/null | grep -qiE 'READY TO MERGE|可整合'; then
    echo "DONE agent finished normally, progress says READY TO MERGE $(date)" >> "$LOG"; break
  fi
  echo "ROUND done $n; next round in $((GAP / 60)) min $(date)" >> "$LOG"; sleep "$GAP"
done
echo "RUNNER END $(date)" >> "$LOG"
