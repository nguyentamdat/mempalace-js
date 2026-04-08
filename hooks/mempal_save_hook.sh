#!/bin/bash
SAVE_INTERVAL=15
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

count_user_messages() {
    if command -v jq >/dev/null 2>&1; then
        jq -Rnc '[inputs | (try fromjson catch empty) | .message | select(type == "object" and .role == "user" and ((.content | type) != "string" or (.content | contains("<command-message>") | not)))] | length' "$TRANSCRIPT_PATH" 2>/dev/null
    elif command -v node >/dev/null 2>&1; then
        node -e 'const fs = require("fs"); const path = process.argv[1]; let count = 0; try { for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) { if (!line.trim()) continue; try { const entry = JSON.parse(line); const msg = entry?.message; if (msg && typeof msg === "object" && msg.role === "user") { const content = msg.content; if (typeof content === "string" && content.includes("<command-message>")) continue; count += 1; } } catch {} } } catch {} process.stdout.write(String(count));' "$TRANSCRIPT_PATH" 2>/dev/null
    fi
}

SESSION_ID=$(json_get "session_id")
SESSION_ID=${SESSION_ID:-unknown}

STOP_HOOK_ACTIVE=$(json_get "stop_hook_active")
STOP_HOOK_ACTIVE=${STOP_HOOK_ACTIVE:-false}

TRANSCRIPT_PATH=$(json_get "transcript_path")
TRANSCRIPT_PATH=${TRANSCRIPT_PATH:-}

TRANSCRIPT_PATH="${TRANSCRIPT_PATH/#\~/$HOME}"

if [ "$STOP_HOOK_ACTIVE" = "True" ] || [ "$STOP_HOOK_ACTIVE" = "true" ]; then
    echo "{}"
    exit 0
fi

if [ -f "$TRANSCRIPT_PATH" ]; then
    EXCHANGE_COUNT=$(count_user_messages)
    EXCHANGE_COUNT=${EXCHANGE_COUNT:-0}
else
    EXCHANGE_COUNT=0
fi

LAST_SAVE_FILE="$STATE_DIR/${SESSION_ID}_last_save"
LAST_SAVE=0
if [ -f "$LAST_SAVE_FILE" ]; then
    LAST_SAVE=$(cat "$LAST_SAVE_FILE")
fi

SINCE_LAST=$((EXCHANGE_COUNT - LAST_SAVE))

echo "[$(date '+%H:%M:%S')] Session $SESSION_ID: $EXCHANGE_COUNT exchanges, $SINCE_LAST since last save" >> "$STATE_DIR/hook.log"

if [ "$SINCE_LAST" -ge "$SAVE_INTERVAL" ] && [ "$EXCHANGE_COUNT" -gt 0 ]; then
    echo "$EXCHANGE_COUNT" > "$LAST_SAVE_FILE"

    echo "[$(date '+%H:%M:%S')] TRIGGERING SAVE at exchange $EXCHANGE_COUNT" >> "$STATE_DIR/hook.log"

    if [ -n "$MEMPAL_DIR" ] && [ -d "$MEMPAL_DIR" ]; then
        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        REPO_DIR="$(dirname "$SCRIPT_DIR")"
        bun run "$REPO_DIR/src/index.ts" mine "$MEMPAL_DIR" >> "$STATE_DIR/hook.log" 2>&1 &
    fi

    cat << 'HOOKJSON'
{
  "decision": "block",
  "reason": "AUTO-SAVE checkpoint. Save key topics, decisions, quotes, and code from this session to your memory system. Organize into appropriate categories. Use verbatim quotes where possible. Continue conversation after saving."
}
HOOKJSON
else
    echo "{}"
fi
