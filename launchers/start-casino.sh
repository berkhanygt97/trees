#!/bin/bash
# Linux launcher. Make it executable once:  chmod +x launchers/start-casino.sh
cd "$(dirname "$0")/.." || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from your package manager or https://nodejs.org"
  exit 1
fi

[ -d "node_modules/three" ] || npm install --no-audit --no-fund || exit 1

echo
echo "  Starting the casino. Ctrl+C to shut it down."
echo
exec npm start
