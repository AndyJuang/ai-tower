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

# Agent CLI per airline (line prefix).  Add the permission / model flags you use yourself.
case "$A" in
  grok-*)        AGENT=(grok -p);;
  claude-*)      AGENT=(claude -p);;
  antigravity-*) AGENT=(agy -p);;
  codex-*)       AGENT=(codex exec);;
  *) echo "no agent for $A"; exit 2;;
esac

CUTOFF=$(ts "$CUT"); GAP=300; n=0
echo "RUNNER pid $$ $(date) worktree $WT branch $BR start-at $START" >> "$LOG"
while :; do
  if [ "$(date +%s)" -ge "$CUTOFF" ]; then echo "STOP cutoff $CUT reached $(date)" >> "$LOG"; break; fi
  n=$((n + 1))
  echo "START attempt $n $(date) pid $$ branch $BR head $(git -C "$WT" rev-parse --short HEAD 2>/dev/null)" >> "$LOG"
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
