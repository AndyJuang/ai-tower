#!/usr/bin/env python3
# usage: detach.py <logfile> <pidfile> <cmd...> : double-fork + setsid so the server survives the terminal / session that started it
import os, sys
log, pidf, cmd = sys.argv[1], sys.argv[2], sys.argv[3:]
if os.fork() == 0:
    os.setsid()
    if os.fork() == 0:
        i = os.open("/dev/null", os.O_RDONLY); o = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
        os.dup2(i, 0); os.dup2(o, 1); os.dup2(o, 2)
        with open(pidf, "w") as f: f.write(str(os.getpid()))
        os.execv(cmd[0], cmd)
    os._exit(0)
