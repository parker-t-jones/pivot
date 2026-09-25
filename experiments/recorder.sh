#!/bin/bash
# Detached wrapper for experiments/espn-live-recorder.ts.
#
# A closed terminal must not stop the recorder: the process is started under nohup,
# and caffeinate -i keeps the Mac from idle-sleeping while that process is alive.
#
#   experiments/recorder.sh start [--event <id>] [--per-window <n>]
#   experiments/recorder.sh status
#   experiments/recorder.sh stop

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RECORDINGS="$ROOT/experiments/logs/recordings"
PID_FILE="$RECORDINGS/recorder.pid"
STATUS_FILE="$RECORDINGS/status.json"
RECORDER="$ROOT/experiments/espn-live-recorder.ts"

ny_date() {
  TZ=America/New_York date +%Y-%m-%d
}

read_pid() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi
  local pid
  pid="$(tr -d '[:space:]' < "$PID_FILE")"
  if [[ -z "$pid" ]]; then
    return 1
  fi
  printf '%s' "$pid"
}

is_running() {
  local pid
  pid="$(read_pid)" || return 1
  kill -0 "$pid" 2>/dev/null
}

cmd_start() {
  mkdir -p "$RECORDINGS/$(ny_date)"
  if is_running; then
    echo "recorder already running (pid $(read_pid))" >&2
    exit 1
  fi

  local log="$RECORDINGS/$(ny_date)/recorder.log"
  cd "$ROOT"
  # Double-fork into a new session. nohup alone is not enough: Node resets SIGHUP, and a
  # background job can stay in this shell's process group. The new session outlives the terminal.
  # caffeinate -i -w runs in that session and drops the idle-sleep assertion when node exits.
  # `node --import tsx` is one process, so this pid is the one that handles SIGINT.
  local pid
  pid="$(
    python3 - "$log" "$RECORDER" "$@" <<'PY'
import os
import sys

log = sys.argv[1]
recorder = sys.argv[2]
user_args = sys.argv[3:]
read_fd, write_fd = os.pipe()
if os.fork() > 0:
    os.close(write_fd)
    sys.stdout.write(os.read(read_fd, 64).decode())
    os.close(read_fd)
    raise SystemExit(0)
os.close(read_fd)
os.setsid()
grandchild = os.fork()
if grandchild > 0:
    os.write(write_fd, f"{grandchild}\n".encode())
    os.close(write_fd)
    os._exit(0)
os.close(write_fd)
out = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
os.dup2(out, 1)
os.dup2(out, 2)
if out > 2:
    os.close(out)
devnull = os.open(os.devnull, os.O_RDONLY)
os.dup2(devnull, 0)
if devnull > 2:
    os.close(devnull)
if os.fork() == 0:
    os.execvp("caffeinate", ["caffeinate", "-i", "-w", str(os.getppid())])
os.execvp("nohup", ["nohup", "node", "--import", "tsx", recorder, *user_args])
PY
  )"
  printf '%s\n' "$pid" > "$PID_FILE"
  echo "started recorder pid $pid"
  echo "log $log"
}

print_stop_reason() {
  [[ -f "$STATUS_FILE" ]] || return 0
  node -e '
    const fs = require("fs");
    const status = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (typeof status.stopReason === "string" && status.stopReason.length > 0) {
      console.log(status.stopReason);
    }
  ' "$STATUS_FILE"
}

print_recording_size() {
  local dir="$RECORDINGS"
  if [[ -f "$STATUS_FILE" ]]; then
    local from_status
    from_status="$(
      node -e '
        const fs = require("fs");
        const status = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        if (typeof status.outputDir === "string") process.stdout.write(status.outputDir);
      ' "$STATUS_FILE"
    )"
    if [[ -n "$from_status" && -d "$from_status" ]]; then
      dir="$from_status"
    fi
  fi
  if [[ -d "$dir" ]]; then
    local size
    size="$(du -sh "$dir" | awk '{print $1}')"
    echo "recordings: ${size}"
  fi
}

cmd_status() {
  if is_running; then
    local pid
    pid="$(read_pid)"
    echo "running (pid $pid)"
    if [[ ! -f "$STATUS_FILE" ]]; then
      echo "games recording: unknown"
      echo "last successful poll: unknown"
    else
      node -e '
        const fs = require("fs");
        const status = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const games = Array.isArray(status.gamesRecording) ? status.gamesRecording.length : 0;
        const last = status.lastSuccessfulPollAt == null ? "none" : status.lastSuccessfulPollAt;
        console.log("games recording: " + games);
        console.log("last successful poll: " + last);
      ' "$STATUS_FILE"
    fi
  else
    echo "not running"
  fi
  print_stop_reason
  print_recording_size
}

cmd_stop() {
  if ! is_running; then
    echo "not running"
    return 0
  fi

  local pid
  pid="$(read_pid)"
  echo "stopping pid $pid"
  kill -INT "$pid" 2>/dev/null || {
    echo "not running"
    return 0
  }

  local _i
  for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "stopped"
      return 0
    fi
    sleep 1
  done

  echo "recorder did not exit within 20s" >&2
  exit 1
}

usage() {
  echo "usage: experiments/recorder.sh start [--event <id>] [--per-window <n>] | status | stop" >&2
  exit 1
}

main() {
  local cmd="${1:-}"
  if [[ -z "$cmd" ]]; then
    usage
  fi
  shift
  case "$cmd" in
    start) cmd_start "$@" ;;
    status) cmd_status ;;
    stop) cmd_stop ;;
    *) usage ;;
  esac
}

main "$@"
