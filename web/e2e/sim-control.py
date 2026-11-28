#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Stands in for the simulator program behind tools/ws_bridge.py, so a test can send the simulator control lines.

The bridge drops every `!` line a client sends, and a browser has no other way in. This wrapper runs the real simulator
(ZENIT_REAL_SIM) with the arguments the bridge gives it, passes the bridge's lines and the simulator's output through,
and also sends the simulator each line a test appends to the file ZENIT_SIM_CONTROL. Once a line is written to the
simulator the file is emptied, so the test knows every request it makes after that is read after the line.
"""

import os
import subprocess
import sys
import threading
import time


def main():
    control = os.environ["ZENIT_SIM_CONTROL"]
    process = subprocess.Popen([os.environ["ZENIT_REAL_SIM"], *sys.argv[1:]], stdin=subprocess.PIPE)
    lock = threading.Lock()

    def send(line):
        with lock:
            try:
                process.stdin.write(line)
                process.stdin.flush()
            except (BrokenPipeError, ValueError):
                pass

    def relay():
        for line in sys.stdin.buffer:
            send(line)
        with lock:
            process.stdin.close()  # the bridge is gone: the simulator ends when its input does

    def watch():
        while process.poll() is None:
            try:
                with open(control, "r+b") as handle:
                    lines = handle.readlines()
                    if lines and lines[-1].endswith(b"\n"):
                        for line in lines:
                            send(line)
                        handle.seek(0)
                        handle.truncate()
            except FileNotFoundError:
                pass
            time.sleep(0.01)

    threading.Thread(target=relay, daemon=True).start()
    threading.Thread(target=watch, daemon=True).start()
    sys.exit(process.wait())


main()
