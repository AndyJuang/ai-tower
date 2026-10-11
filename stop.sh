#!/bin/bash
cd "$(dirname "$0")" || exit 1
if [ -f tower.pid ] && kill -0 "$(cat tower.pid)" 2>/dev/null; then kill "$(cat tower.pid)" && echo "stopped pid $(cat tower.pid)"; else echo "not running"; fi
rm -f tower.pid
