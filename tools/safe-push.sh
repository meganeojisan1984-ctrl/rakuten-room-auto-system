#!/usr/bin/env bash
# main への push をリトライ付きで実行する。
# 競合時のみ retry し、それ以外のエラー（認証等）は即失敗。
set -euo pipefail

MAX_RETRIES=3
for i in 1 2 3; do
  if git pull --rebase --autostash origin main && git push; then
    echo "[safe-push] success on attempt ${i}"
    exit 0
  fi
  wait=$((i * 5))
  echo "[safe-push] attempt ${i}/${MAX_RETRIES} failed, retrying in ${wait}s..."
  sleep "${wait}"
done

echo "::error::[safe-push] failed after ${MAX_RETRIES} retries"
exit 1
