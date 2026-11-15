#!/bin/bash
# A short push to the phone through ntfy.sh after an automatic job:  notify.sh "Title" "line 1" "line 2" "line 3"
# The topic (a long random name: whoever knows it can read the messages) comes from NTFY_TOPIC in the
# environment or in ~/projects/.env — never from git, and it is never printed. No topic: nothing is sent.
# NOTIFY_DRY=1 prints the message instead of sending it.
set -u
title="${1:-}"; shift
body="$(printf '%s\n' "$@" | sed '/^$/d')"
topic="${NTFY_TOPIC:-}"
if [ -z "$topic" ] && [ -f "$HOME/projects/.env" ]; then
  topic="$(sed -n 's/^NTFY_TOPIC=//p' "$HOME/projects/.env" | head -1 | tr -d "\"' \r")"
fi
if [ "${NOTIFY_DRY:-0}" = 1 ]; then printf '[ntfy] %s\n%s\n' "$title" "$body"; exit 0; fi
if [ -z "$topic" ]; then echo "ntfy: NTFY_TOPIC алга (~/projects/.env) — мэдэгдэл илгээгээгүй"; exit 0; fi
# JSON body, so the Mongolian title is not squeezed into an HTTP header
json="$(node -e 'process.stdout.write(JSON.stringify({topic:process.argv[1],title:process.argv[2],message:process.argv[3],tags:["hammer_and_wrench"]}))' "$topic" "$title" "$body")" || exit 0
if curl -sS -m 20 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "$json" "${NTFY_URL:-https://ntfy.sh}" | grep -q '^200$'; then
  echo "ntfy: мэдэгдэл илгээлээ"
else
  echo "ntfy: илгээж чадсангүй"
fi
exit 0
