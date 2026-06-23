#!/bin/bash
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin"
APP_DIR="/opt/matheherz"
LOG="/var/log/matheherz-deploy.log"

cd "$APP_DIR" || exit 1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cron läuft..." >> "$LOG"

git fetch origin >> "$LOG" 2>&1

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)

echo "[$(date '+%Y-%m-%d %H:%M:%S')] LOCAL=$LOCAL REMOTE=$REMOTE" >> "$LOG"

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Neuer Commit erkannt – deploye..." >> "$LOG"
  git reset --hard origin/master >> "$LOG" 2>&1
  npm install --quiet >> "$LOG" 2>&1
  pm2 restart matheherz >> "$LOG" 2>&1
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Deploy abgeschlossen." >> "$LOG"
fi
