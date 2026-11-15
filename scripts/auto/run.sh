#!/bin/bash
# Runs the weekly job when it is due (every Wednesday from 03:00; each app has its own night, so the Claude
# runs never pile up on one night). launchd calls this at login and every hour, so a night missed while
# the computer was off, asleep or offline is caught up at the next chance.
# FORCE=1 runs it now. Logs: logs/weekly-DATE.md and logs/auto.log.
set -u
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOGS="$DIR/logs"
mkdir -p "$LOGS"
log() { echo "$(date '+%F %T') [weekly] $*" >> "$LOGS/auto.log"; }

now=$(date +%s)
WEEKDAY=3 # 1 = Monday … 7 = Sunday
back=$(( ($(date +%u) - WEEKDAY + 7) % 7 )) # days since that weekday
due=$(date -j -v-"${back}"d -f "%F %T" "$(date +%F) 03:00:00" +%s)
[ "$now" -lt "$due" ] && due=$((due - 7 * 86400))
STAMP="$LOGS/.last-weekly"
last=$(cat "$STAMP" 2>/dev/null || echo 0)
if [ "${FORCE:-0}" != 1 ] && [ "$last" -ge "$due" ]; then exit 0; fi

if ! curl -sS -m 15 -o /dev/null https://registry.npmjs.org/ 2>/dev/null; then
  log "интернэт алга — дараагийн цагт дахин оролдоно"
  exit 0
fi
LOCK="$LOGS/.lock-weekly"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +240 2>/dev/null)" ]; then rmdir "$LOCK" && mkdir "$LOCK" || exit 0
  else exit 0; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

log "эхэллээ"
cd "$DIR" || exit 1
bash scripts/auto/weekly.sh >> "$LOGS/auto.log" 2>&1
code=$?
if [ $code -eq 0 ]; then
  echo "$now" > "$STAMP"; log "дууслаа"
else
  FAILS="$LOGS/.fails-weekly"
  n=$(( $( [ "$(cut -d' ' -f1 "$FAILS" 2>/dev/null)" = "$due" ] && cut -d' ' -f2 "$FAILS" || echo 0) + 1 ))
  echo "$due $n" > "$FAILS"
  if [ "$n" -ge 3 ]; then echo "$now" > "$STAMP"; log "алдаатай (код $code), $n дахь удаа — энэ долоо хоногийг алгаслаа"
    bash "$DIR/scripts/auto/notify.sh" "Элсэн цаг · 7 хоногийн сайжруулалт" "🔧 Энэ 7 хоногт ажил хийгдсэнгүй" "❌ 3 удаа алдаатай дууслаа (код $code)" "👉 logs/auto.log-ийг харна уу" >> "$LOGS/auto.log" 2>&1
  else log "алдаатай (код $code) — дараагийн цагт дахин ($n/3)"; fi
fi
exit $code
