#!/usr/bin/env bash
# PostToolUse hook for Claude Code
# Checks if any architectural decisions apply to the file being edited.

set -euo pipefail

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

if [[ "$FILE_PATH" = /* ]]; then
  FILE_PATH=$(python3 -c "import os.path; print(os.path.relpath('$FILE_PATH', '$(pwd)'))" 2>/dev/null || echo "$FILE_PATH")
fi

DECISIONS=$(node /Users/rheapatel/decision-memory/dist/cli.js check "$FILE_PATH" --json 2>/dev/null || echo "[]")

COUNT=$(echo "$DECISIONS" | jq 'length' 2>/dev/null || echo "0")

if [ "$COUNT" -gt 0 ]; then
  SUMMARIES=$(echo "$DECISIONS" | jq -r '.[] | "- \(.summary) (scope: \(.scope | join(", "))) [ID: \(.id)]"' 2>/dev/null)

  MESSAGE="Advisory: $COUNT existing architectural decision(s) may apply to this file:
$SUMMARIES
Review with: node /Users/rheapatel/decision-memory/dist/cli.js check $FILE_PATH
These are advisory — you may proceed, but consider whether your changes align with these decisions."

  jq -n --arg msg "$MESSAGE" '{systemMessage: $msg}'
fi
