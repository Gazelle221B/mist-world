#!/usr/bin/env bash

echo "[HOOK] Running Stop hooks..."

# Check for console.log in TypeScript files
# Ignoring node_modules and other generated directories
FINDINGS=$(find src -name "*.ts" -type f -exec grep -Hn "console.log" {} + 2>/dev/null)

if [ -n "$FINDINGS" ]; then
  echo "⚠️ [HOOK WARNING] Found 'console.log' statements. They must be removed before committing!"
  echo "$FINDINGS"
else
  echo "✅ No 'console.log' found in src/."
fi

exit 0
