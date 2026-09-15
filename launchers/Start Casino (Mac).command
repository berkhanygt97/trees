#!/bin/bash
# Double-click me. macOS may ask you to allow it the first time:
# right-click -> Open, then confirm.
cd "$(dirname "$0")/.." || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed."
  echo "  Get it from https://nodejs.org (the LTS button), then run this again."
  echo
  read -r -p "  Press return to close." _
  exit 1
fi

if [ ! -d "node_modules/three" ]; then
  echo "  First run - installing the game. This takes a minute..."
  npm install --no-audit --no-fund || {
    echo
    echo "  Install failed. You need an internet connection for this one step."
    read -r -p "  Press return to close." _
    exit 1
  }
fi

echo
echo "  Starting the casino. Leave this window open while you play."
echo "  Press Ctrl+C or close the window to shut it down."
echo
npm start
