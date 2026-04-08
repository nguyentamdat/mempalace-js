#!/bin/bash
STATE_DIR="$HOME/.mempalace/hook_state"
mkdir -p "$STATE_DIR"

MEMPAL_DIR=""

INPUT=$(cat)

json_get() {
    local key="$1"

    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$INPUT" | jq -r --arg key "$key" '.[$key] // empty' 2>/dev/null
    elif command -v node >/dev/null 2>&1; then
        printf '%s' "$INPUT" | node -e 'const fs = require("fs"); const key = process.argv[1]; try { const data = JSON.parse(fs.readFileSync(0, "utf8")); const value = data?.[key]; if (value !== undefined && value !== null) process.stdout.write(String(value)); } catch {}' "$key" 2>/dev/null
    fi
}

SESSION_ID=$(json_get "session_id")
SESSION_ID=${SESSION_ID:-unknown}

echo "[$(date '+%H:%M:%S')] PRE-COMPACT triggered for session $SESSION_ID" >> "$STATE_DIR/hook.log"

if [ -n "$MEMPAL_DIR" ] && [ -d "$MEMPAL_DIR" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    REPO_DIR="$(dirname "$SCRIPT_DIR")"
    bun run "$REPO_DIR/src/index.ts" mine "$MEMPAL_DIR" >> "$STATE_DIR/hook.log" 2>&1
fi

cat << 'HOOKJSON'
{
  "decision": "block",
  "reason": "COMPACTION IMMINENT. Save ALL topics, decisions, quotes, code, and important context from this session to your memory system. Be thorough — after compaction, detailed context will be lost. Organize into appropriate categories. Use verbatim quotes where possible. Save everything, then allow compaction to proceed."
}
HOOKJSON
