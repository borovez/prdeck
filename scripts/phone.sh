#!/bin/sh
# Opens PR Deck on an Android phone connected by USB: forwards the phone's localhost:4317 to this Mac
# (adb reverse) and opens it in Chrome there. Chrome treats localhost as secure, so "Install app" works.
# Works while the cable is connected; run it again after reconnecting.
set -eu

PORT="${PRDECK_PORT:-4317}"
URL="http://localhost:$PORT"

if ! command -v adb >/dev/null; then
  echo "adb not found. Install it with:  brew install android-platform-tools" >&2
  exit 1
fi
if ! curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "PR Deck isn't running on port $PORT (npm run app:install, or npm run dev)." >&2
  exit 1
fi

adb start-server >/dev/null 2>&1
DEVICES="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
UNAUTHORIZED="$(adb devices | awk 'NR>1 && $2=="unauthorized" {print $1}')"
if [ -z "$DEVICES" ]; then
  if [ -n "$UNAUTHORIZED" ]; then
    echo "The phone is connected but hasn't allowed this Mac yet: unlock it and tap Allow on the USB debugging prompt." >&2
  else
    echo "No phone found. On the phone: Settings > About phone > Software information > tap Build number 7 times," >&2
    echo "then Settings > Developer options > USB debugging on. Connect the cable and run this again." >&2
  fi
  exit 1
fi

for d in $DEVICES; do
  adb -s "$d" reverse "tcp:$PORT" "tcp:$PORT"
  adb -s "$d" shell am start -a android.intent.action.VIEW -d "$URL" com.android.chrome >/dev/null 2>&1 ||
    adb -s "$d" shell am start -a android.intent.action.VIEW -d "$URL" >/dev/null
  echo "Opened $URL on $d. To install: Chrome menu (⋮) > Add to home screen > Install."
done
