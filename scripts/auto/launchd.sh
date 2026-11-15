#!/bin/bash
# The weekly auto-improve job in launchd (macOS):  launchd.sh install | status | stop | start
#   install  writes ~/Library/LaunchAgents/com.elsentsag.weekly.plist and loads it
#   status   are they loaded, when did they last run, the latest log lines
#   stop     unloads it (the plist file stays; `start` loads it again)
# It runs at login and every hour; run.sh decides whether it is due (Wednesday from 03:00), so a missed
# night is caught up when the computer is on and online again.
set -u
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
JOBS="weekly"
label() { echo "com.elsentsag.$1"; }
plist() { echo "$AGENTS/$(label "$1").plist"; }

write_plist() {
  cat > "$(plist "$1")" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(label "$1")</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$DIR/scripts/auto/run.sh</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$PATH</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>$DIR/logs/launchd-$1.log</string>
  <key>StandardErrorPath</key><string>$DIR/logs/launchd-$1.log</string>
</dict>
</plist>
EOF
}

case "${1:-}" in
  install)
    mkdir -p "$AGENTS" "$DIR/logs"
    # the first weekly run is the coming run night, not right now for the one already past
    [ -f "$DIR/logs/.last-weekly" ] || date +%s > "$DIR/logs/.last-weekly"
    for j in $JOBS; do
      launchctl bootout "$DOMAIN/$(label "$j")" 2>/dev/null
      write_plist "$j"
      launchctl bootstrap "$DOMAIN" "$(plist "$j")" && echo "✓ $(label "$j") ачааллаа"
    done ;;
  start)
    for j in $JOBS; do launchctl bootstrap "$DOMAIN" "$(plist "$j")" 2>/dev/null && echo "✓ $(label "$j") эхэллээ"; done ;;
  stop)
    for j in $JOBS; do launchctl bootout "$DOMAIN/$(label "$j")" 2>/dev/null && echo "■ $(label "$j") зогслоо"; done ;;
  status)
    for j in $JOBS; do
      if launchctl print "$DOMAIN/$(label "$j")" >/dev/null 2>&1; then s="ачаалагдсан"; else s="ачаалагдаагүй"; fi
      last=$(cat "$DIR/logs/.last-$j" 2>/dev/null)
      echo "$(label "$j"): $s · сүүлд амжилттай: $([ -n "$last" ] && date -r "$last" '+%F %T' || echo 'хараахан үгүй')"
    done
    echo "--- logs/auto.log (сүүлийн 10 мөр)"
    tail -10 "$DIR/logs/auto.log" 2>/dev/null ;;
  *) echo "Хэрэглээ: launchd.sh install | status | stop | start" >&2; exit 2 ;;
esac
