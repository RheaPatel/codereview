#!/usr/bin/env bash
# PostToolUse hook for Claude Code
# Checks if any architectural decisions apply to the file being edited.
# Reads hook JSON from stdin, outputs advisory system message if decisions found.

set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)

# Extract the file path from tool_input (handles both Write/Edit tools)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  # No file path in tool input, nothing to check
  exit 0
fi

# Make path relative to project root if absolute
if [[ "$FILE_PATH" = /* ]]; then
  FILE_PATH=$(realpath --relative-to="$(pwd)" "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")
fi

# Query decisions for this file path
DECISIONS=$(npx --yes decision-memory check "$FILE_PATH" --json 2>/dev/null || echo "[]")

# Check if any decisions were found
COUNT=$(echo "$DECISIONS" | jq 'length' 2>/dev/null || echo "0")

if [ "$COUNT" -gt 0 ]; then
  # Build advisory message
  SUMMARIES=$(echo "$DECISIONS" | jq -r '.[] | "- \(.summary) (scope: \(.scope | join(", "))) [ID: \(.id)]"' 2>/dev/null)

  MESSAGE="Advisory: $COUNT existing architectural decision(s) may apply to this file:
$SUMMARIES
Review with: decision-memory check $FILE_PATH
These are advisory — you may proceed, but consider whether your changes align with these decisions."

  # Output hook response with system message
  jq -n --arg msg "$MESSAGE" '{systemMessage: $msg}'
fi
