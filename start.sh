#!/bin/bash
# Start AI Tower detached on 127.0.0.1 (no browser is opened). TOWER_DEMO=1 ./start.sh for demo data.
cd "$(dirname "$0")" || exit 1
if [ -f tower.pid ] && kill -0 "$(cat tower.pid)" 2>/dev/null; then echo "already running pid $(cat tower.pid)"; exit 0; fi
NODE="$(command -v node || echo "$HOME/.local/bin/node")"
python3 ./detach.py "$PWD/tower.log" "$PWD/tower.pid" /usr/bin/env ${TOWER_DEMO:+TOWER_DEMO=1} "$NODE" "$PWD/server.js"
sleep 1; echo "started pid $(cat tower.pid 2>/dev/null) (log: tower.log)"; tail -1 tower.log
