#!/bin/bash
# AI Tower installer: checks node, creates config.json from the example, starts the server detached.
set -e
cd "$(dirname "$0")"
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then echo "✖ node not found — install Node.js 18+ first (https://nodejs.org)"; exit 1; fi
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 18 ]; then echo "✖ Node.js 18+ required (found $("$NODE" -v))"; exit 1; fi
command -v python3 >/dev/null || { echo "✖ python3 not found (used to detach the server)"; exit 1; }
command -v gh >/dev/null || echo "⚠ gh (GitHub CLI) not found — PARK needs it to list issues: https://cli.github.com"
command -v git >/dev/null || echo "⚠ git not found — Takeoff needs it"
if [ ! -f config.json ]; then cp config.example.json config.json; echo "✓ created config.json — edit baseDir / logsDir / repos before your first Takeoff"; fi
mkdir -p data
chmod +x start.sh stop.sh examples/runner.example.sh 2>/dev/null || true
if [ "${1:-}" = "--demo" ]; then TOWER_DEMO=1 ./start.sh; else ./start.sh; fi
PORT="${TOWER_PORT:-$("$NODE" -p 'try{require("./config.json").port||4777}catch(e){4777}')}"
echo "open http://127.0.0.1:$PORT   (stop: ./stop.sh · demo data: ./install.sh --demo)"
