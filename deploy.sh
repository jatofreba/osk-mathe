#!/bin/bash
APP_DIR="/opt/matheherz"
LOG="/var/log/matheherz-deploy.log"

cd "$APP_DIR" || exit 1

git fetch origin --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Neuer Commit erkannt – deploye..." >> "$LOG"
  git pull origin master >> "$LOG" 2>&1
  npm install --quiet >> "$LOG" 2>&1
  pm2 restart matheherz >> "$LOG" 2>&1
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Deploy abgeschlossen." >> "$LOG"
fi
