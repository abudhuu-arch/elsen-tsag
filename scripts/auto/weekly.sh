#!/bin/bash
# The weekly job (Wednesday 03:00, via run.sh; each app has its own night): Claude Code (`claude -p`) looks over the app and makes 1–3
# small improvements on the "auto-improve" branch, in its own folder next to this one
# (../elsen-tsag-auto, a git worktree), so your folder, your branch and the running app are untouched.
#
#   - main is merged INTO auto-improve first (your latest work); auto-improve is never merged into main.
#   - Claude may read, edit and run `npm --prefix tests test` there; it cannot commit, push, switch
#     branches or reach the network. This script commits only if the tests pass; otherwise the
#     changes are put aside in a git stash (kept, never thrown away).
#   - Its report goes to logs/weekly-DATE.md (logs/ is not in git: this repo is public).
#   - The check is the browser test suite: `npm --prefix tests test` (the app itself has no package.json).
#   - auto-improve is never pushed: GitHub only ever gets main, and only when you push it.
# Merging something into main is your decision: `git log main..auto-improve`, then cherry-pick or merge.
set -u
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WT="$(dirname "$DIR")/elsen-tsag-auto"
DAY=$(date +%F)
LOG="$DIR/logs/weekly-$DAY.md"
BRANCH=auto-improve
mkdir -p "$DIR/logs"
say() { echo "$*" >> "$LOG"; }

cd "$DIR" || exit 1
if [ ! -d "$WT" ]; then
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then git worktree add "$WT" "$BRANCH" || exit 1
  else git worktree add -b "$BRANCH" "$WT" main || exit 1; fi
fi
cd "$WT" || exit 1
if [ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then
  echo "$WT нь $BRANCH салбар дээр биш — зогслоо" >&2
  exit 1
fi

{
  echo "# 7 хоногийн автомат ажил $DAY"
  echo
  echo "Салбар: \`$BRANCH\` (хавтас \`$WT\`). main-д нийлүүлээгүй."
  echo
} > "$LOG"

# anything left from an interrupted run is kept in a stash
if [ -n "$(git status --porcelain)" ]; then
  git stash push -u -m "auto-improve $DAY: өмнөх ажлын үлдэгдэл" >/dev/null
  say "- Өмнөх ажлын дуусаагүй өөрчлөлтийг \`git stash\`-д хадгаллаа."
fi
if ! git merge --no-edit main >/dev/null 2>&1; then
  git merge --abort 2>/dev/null
  say "- main-ийг нийлүүлэхэд зөрчил гарсан тул өмнөх суурь дээр ажиллав."
fi
npm --prefix tests install --no-audit --no-fund --silent >/dev/null 2>&1

PROMPT="Чи Элсэн цаг (утсанд суулгадаг, интернэтгүй ажилладаг өдрийн төлөвлөгч PWA; бүхэлдээ index.html + sw.js) апп-ын
7 хоног тутмын автомат хөгжүүлэгч. Хэрэглэгч унтаж байгаа, асуулт асуух боломжгүй. README.md-ийг эхлээд унш.
Ажил: аппыг шалгаж (код, тест, утсан дээрх харагдац, монгол бичвэр) хамгийн хэрэгтэй 1–3 ЖИЖИГ сайжруулалт хий —
алдаа засах, хэрэглэгчид эвгүй зүйл, тестгүй чухал логикт тест нэмэх гэх мэт. Том өөрчлөлт, framework, сан бүү нэм.
- Өөрчлөлт бүрийн дараа \`npm --prefix tests test\` ажиллуулж бүгд давах ёстой. Давахгүй бол тэр өөрчлөлтөө буцаа.
- git commit, branch, merge, push бүү хий: скрипт тест давсан тохиолдолд өөрөө commit хийнэ.
- Repo НИЙТЭД НЭЭЛТТЭЙ: нэр, хаяг, утас, имэйл, хувийн хуваарь, түлхүүр бүү бич. Жишээ өгөгдөл ерөнхий байна.
- Өгөгдөл зөвхөн утасны localStorage-д: сервер, аналитик, гадны script, шинэ сүлжээний хүсэлт бүү нэм. Юу ч бүү устга,
  хэрэглэгчийн хадгалсан өгөгдлийн хэлбэрийг эвдэхгүй (хуучин өгөгдөл шилжих ёстой).
- Кэшлэгдсэн файл (icon, шрифт, manifest) өөрчилбөл sw.js-ийн VERSION-ийг нэмэгдүүл.
- Эцэст нь монголоор товч тайлан бич (энэ нь logs/weekly-д хадгалагдана): юу хийсэн, яагаад, ямар файл,
  тестийн үр дүн, хийж амжаагүй санаа. Эхний мөрөнд нэг өгүүлбэрээр гол өөрчлөлтөө бич.
  Хамгийн сүүлийн мөрөнд \`ТАНААС: ...\` гэж хэрэглэгчээс юу хэрэгтэйг нэг богино өгүүлбэрээр бич
  (шийдвэр, шалгах зүйл; юу ч хэрэггүй бол \`ТАНААС: юу ч хэрэггүй\`)."

BEFORE=$(git rev-parse HEAD); RESULT=none
REPORT="$WT/.auto-report.md"
if [ "${DRY_RUN:-0}" = 1 ]; then # check the set-up without calling Claude
  echo "DRY_RUN: Claude-ийг дуудаагүй." > "$REPORT"; code=0
else
claude -p "$PROMPT" --permission-mode dontAsk \
  --allowedTools "Read" "Edit" "Write" "Glob" "Grep" "Bash(npm --prefix tests test)" "Bash(git status)" "Bash(git diff:*)" "Bash(git log:*)" \
  > "$REPORT" 2>> "$DIR/logs/auto.log" &
pid=$!
( sleep 5400; kill "$pid" 2>/dev/null ) & watchdog=$! # at most 90 minutes
wait "$pid"; code=$?
kill "$watchdog" 2>/dev/null
fi

say "## Claude-ийн тайлан"
say
if [ -s "$REPORT" ]; then cat "$REPORT" >> "$LOG"; else say "(тайлан хоосон, claude код $code)"; fi
say
say "## Үр дүн"
say

mv "$REPORT" "$DIR/logs/weekly-$DAY-claude.md" 2>/dev/null

if [ -z "$(git status --porcelain)" ]; then
  say "- Код өөрчлөгдөөгүй."; RESULT=none
elif npm --prefix tests test > "$DIR/logs/weekly-$DAY-check.log" 2>&1; then
  git add -A
  first=$(grep -m1 -v '^\s*$' "$DIR/logs/weekly-$DAY-claude.md" 2>/dev/null | sed 's/^#* *//' | cut -c1-100)
  git commit -q -m "auto-improve $DAY: ${first:-7 хоногийн сайжруулалт}" -m "Автомат 7 хоногийн ажил (scripts/auto/weekly.sh). Тест давсан.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  RESULT=committed
  say "- Тест (\`npm --prefix tests test\`) давсан → commit \`$(git rev-parse --short HEAD)\` (\`$BRANCH\` салбар)."
  say "- Харах: \`git log main..$BRANCH\`, \`git diff main...$BRANCH\`. main-д нийлүүлэх эсэхийг та шийднэ."
else
  git stash push -u -m "auto-improve $DAY: тест унасан" >/dev/null
  RESULT=failed
  say "- Тест (\`npm --prefix tests test\`) унасан → commit хийгээгүй. Өөрчлөлтийг \`git stash\`-д хадгаллаа (\`git stash list\`)."
  say '```'
  tail -20 "$DIR/logs/weekly-$DAY-check.log" >> "$LOG"
  say '```'
fi
[ "$(git rev-parse HEAD)" != "$BEFORE" ] && say "- Энэ удаагийн commit-ууд: $(git log --oneline "$BEFORE"..HEAD | wc -l | tr -d ' ')"

# Three lines to the phone (ntfy): what improved, did the checks pass, what is needed from you.
CL="$DIR/logs/weekly-$DAY-claude.md"
what=$(grep -m1 -v -e '^\s*$' -e '^ТАНААС' "$CL" 2>/dev/null | sed 's/^[#*> -]*//' | cut -c1-140)
ask=$(grep -m1 '^\**ТАНААС' "$CL" 2>/dev/null | sed 's/^[*]*ТАНААС[*]*:[*]* *//' | cut -c1-140)
case "$RESULT" in
  committed) l2="✅ Тест давсан → commit $(git rev-parse --short HEAD) (auto-improve салбар)"
             l3="👉 ${ask:-юу ч хэрэггүй} · main-д нийлүүлэх эсэхийг та шийднэ" ;;
  failed)    l2="❌ Тест унасан → commit хийгээгүй, өөрчлөлт git stash-д"
             l3="👉 ${ask:-logs/weekly-$DAY.md-ийг харна уу}" ;;
  *)         l2="➖ Код өөрчлөгдөөгүй (тест ажиллуулах шаардлагагүй)"
             l3="👉 ${ask:-юу ч хэрэггүй}" ;;
esac
[ -s "$CL" ] || what="Claude тайлан гаргасангүй (код $code: хязгаар эсвэл алдаа байж магадгүй)"
bash "$DIR/scripts/auto/notify.sh" "Элсэн цаг · 7 хоногийн сайжруулалт" "🔧 ${what:-тайлангүй}" "$l2" "$l3" >> "$DIR/logs/auto.log" 2>&1
exit 0
