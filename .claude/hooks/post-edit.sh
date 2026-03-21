#!/usr/bin/env bash

# This script runs after tools like 'Edit' or 'Replace'
TOOL_NAME="$1"

# We only care about file modifications
if [[ "$TOOL_NAME" == "Bash" || "$TOOL_NAME" == "Read" || "$TOOL_NAME" == "Glob" || "$TOOL_NAME" == "Grep" ]]; then
  exit 0
fi

# Run the TypeScript compiler to catch type errors early
echo "[HOOK] Running typecheck to verify changes..."
npm run typecheck
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "⚠️ [HOOK WARNING] TypeScript type check failed after your edit."
  echo "Please review the errors above and fix them before proceeding."
  # We return 0 so we don't crash Claude, but the output will be seen by Claude
fi
exit 0
