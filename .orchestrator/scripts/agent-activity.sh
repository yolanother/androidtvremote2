#!/usr/bin/env bash
# orch-agent-activity v3
# Lean hook for task tracking. Zero stdout unless blocking.
# All reporting goes to orch API in background. No token waste.
set -euo pipefail

# jq is required for JSON parsing. On Windows in particular, jq may be installed
# (e.g. via WinGet) but absent from PATH because PATH was inherited from the parent
# process before the install. Probe common install locations before giving up so the
# hook self-heals without a Claude Code restart. If still not found, exit silently —
# this hook is observability-only and failing closed beats spamming a "jq: command not
# found" error on every tool call.
if ! command -v jq &>/dev/null; then
  for candidate in \
    "${LOCALAPPDATA:-}/Microsoft/WinGet/Packages/jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe/jq.exe" \
    "/c/ProgramData/chocolatey/bin/jq.exe" \
    "${HOME:-}/scoop/shims/jq.exe" \
    "/usr/local/bin/jq" \
    "/opt/homebrew/bin/jq"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      PATH="$(dirname "$candidate"):$PATH"
      export PATH
      break
    fi
  done
  if ! command -v jq &>/dev/null; then
    cat >/dev/null  # drain stdin to avoid broken pipe
    exit 0
  fi
fi

# ── Parse all stdin fields in one jq call ────────────────────────────────
INPUT="$(cat)"
eval "$(echo "$INPUT" | jq -r '
  @sh "HOOK_EVENT=\(.hook_event_name // "")",
  @sh "SESSION_ID=\(.session_id // "unknown")",
  @sh "TOOL_NAME=\(.tool_name // "")",
  @sh "TOOL_INPUT=\(.tool_input // "")",
  @sh "STOP_REASON=\(.stop_reason // "")",
  @sh "CWD=\(.cwd // "")",
  @sh "TRANSCRIPT_PATH=\(.transcript_path // "")"
' 2>/dev/null || echo 'HOOK_EVENT=""; SESSION_ID="unknown"; TOOL_NAME=""; TOOL_INPUT=""; STOP_REASON=""; CWD=""; TRANSCRIPT_PATH=""')"

STATE_FILE="/tmp/orch-agent-state-${SESSION_ID}.json"
NOW_EPOCH=$(date +%s)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# ── Helper: check if a bash command is read-only ─────────────────────────
is_readonly_bash() {
  local first_word
  first_word=$(echo "$1" | awk '{print $1}' | sed 's|.*/||')
  case "$first_word" in
    ls|cat|head|tail|less|more|file|wc|du|df|find|tree|stat|grep|rg|ag|ack) return 0 ;;
    echo|printf|which|type|command|env|printenv|pwd|id|whoami|date|uname) return 0 ;;
    chmod) return 0 ;;
    git)
      local sub; sub=$(echo "$1" | awk '{print $2}')
      case "$sub" in log|status|diff|show|branch|tag|remote|rev-parse|describe|blame) return 0 ;; *) return 1 ;; esac ;;
    *) return 1 ;;
  esac
}

# ── Load state file in one jq call ───────────────────────────────────────
TASK_ID="" ; PREV_STATE="" ; LAST_B_REPORT="0" ; LAST_TRANSCRIPT_LINE="0"
LAST_COMMENT_TIME="0" ; LAST_COMMENT_CHECK="0" ; PENDING_WORK_SUMMARY=""
if [[ -f "$STATE_FILE" ]]; then
  eval "$(jq -r '
    @sh "TASK_ID=\(.taskId // "")",
    @sh "PREV_STATE=\(.currentState // "")",
    @sh "LAST_B_REPORT=\(.lastTierBReport // 0)",
    @sh "LAST_TRANSCRIPT_LINE=\(.lastTranscriptLine // 0)",
    @sh "LAST_COMMENT_TIME=\(.lastCommentTime // 0)",
    @sh "LAST_COMMENT_CHECK=\(.lastCommentCheck // 0)",
    @sh "PENDING_WORK_SUMMARY=\(.pendingWorkSummary // "")"
  ' "$STATE_FILE" 2>/dev/null || true)"
fi

# Override with env var or resolve via API (only if not cached)
if [[ -n "${ORCH_TASK_ID:-}" ]]; then
  TASK_ID="$ORCH_TASK_ID"
elif [[ -z "$TASK_ID" ]]; then
  TASK_ID=$(orch --get 'data.0.id' tasks list --status in_progress 2>/dev/null || true)
  [[ "$TASK_ID" == "null" ]] && TASK_ID=""
fi

# ── Task enforcement (PreToolUse only, no task) ──────────────────────────
if [[ "$HOOK_EVENT" == "PreToolUse" && -z "$TASK_ID" ]]; then
  IS_ALLOWED=false
  case "$TOOL_NAME" in
    Read|Grep|Glob|ToolSearch|LSP|WebSearch|WebFetch|Agent) IS_ALLOWED=true ;;
    search_knowledge|read_memory|list_memories) IS_ALLOWED=true ;;
    Skill)
      SKILL_NAME=$(echo "$TOOL_INPUT" | jq -r '.skill // empty' 2>/dev/null || true)
      case "$SKILL_NAME" in orch-*|dev-*|wl*) IS_ALLOWED=true ;; esac ;;
    Bash|bash)
      BASH_CMD=$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null || echo "$TOOL_INPUT")
      FIRST_WORD=$(echo "$BASH_CMD" | awk '{print $1}')
      case "$FIRST_WORD" in
        orch|wl) IS_ALLOWED=true ;;
        ./scripts/*|.orchestrator/scripts/*) IS_ALLOWED=true ;;
        docker|docker-compose|systemctl|service|npm|npx|node|sleep|curl|wget) IS_ALLOWED=true ;;
        chmod|mkdir|touch|cp|mv) IS_ALLOWED=true ;;
        *) is_readonly_bash "$BASH_CMD" && IS_ALLOWED=true ;;
      esac ;;
    Write|Edit)
      FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null || true)
      case "$FILE_PATH" in
        /tmp/*|*.log|*.tmp|*/.orchestrator/*|*/LastChange.md|*/.claude/*) IS_ALLOWED=true ;;
      esac ;;
  esac

  if [[ "$IS_ALLOWED" == "false" ]]; then
    ENFORCEMENT="warn"
    HOOKS_CFG="${CWD:-.}/.orchestrator/hooks.json"
    if [[ -f "$HOOKS_CFG" ]]; then
      local_enf=$(jq -r '.agentActivity.taskEnforcement // .enforcement // "warn"' "$HOOKS_CFG" 2>/dev/null || true)
      [[ -n "$local_enf" ]] && ENFORCEMENT="$local_enf"
    fi
    if [[ "$ENFORCEMENT" == "block" ]]; then
      # This is the ONLY stdout output — tells Claude to create a task with a description
      echo '{"error":"No orch task. Create one with a description: 1) Write .orchestrator/tasks/desc.md with goal, approach, and acceptance criteria. 2) Run: orch tasks create \"<title>\" --file .orchestrator/tasks/desc.md --json"}'
      exit 2
    fi
    # Warn goes to stderr only — doesn't consume tokens
    echo "[orch] No task found. Work is untracked." >&2
  fi
fi

# ── Bidirectional: pick up human comments (throttled 60s) ────────────────
if [[ "$HOOK_EVENT" == "PreToolUse" && -n "$TASK_ID" && $((NOW_EPOCH - LAST_COMMENT_CHECK)) -ge 60 ]]; then
  LAST_COMMENT_CHECK="$NOW_EPOCH"
  if [[ "$LAST_COMMENT_CHECK" != "0" && "$LAST_COMMENT_CHECK" =~ ^[0-9]+$ ]]; then
    SINCE=$(date -u -d "@$LAST_COMMENT_CHECK" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "1970-01-01T00:00:00Z")
  else
    SINCE="1970-01-01T00:00:00Z"
  fi
  HUMAN_COMMENTS=$(orch tasks events "$TASK_ID" --since "$SINCE" --exclude-author "@agent" --event-type comment --json 2>/dev/null || echo '{"data":[]}')
  COMMENT_COUNT=$(echo "$HUMAN_COMMENTS" | jq '.data | length' 2>/dev/null || echo "0")
  if [[ "$COMMENT_COUNT" -gt 0 ]]; then
    # Human feedback is the one thing worth showing to the agent
    echo ""
    echo "--- Human feedback on task $TASK_ID ---"
    echo "$HUMAN_COMMENTS" | jq -r '.data[] | "[" + (.author // "unknown") + "] " + (.content // "")' 2>/dev/null || true
    echo "--- End feedback ---"
    echo ""
  fi
fi

# ── State detection ──────────────────────────────────────────────────────
determine_state() {
  case "$HOOK_EVENT" in
    SessionStart|PreCompact|UserPromptSubmit) echo "THINKING"; return ;;
    Stop|SubagentStop|SessionEnd) echo "IDLE"; return ;;
    Notification) echo "QUESTION"; return ;;
  esac
  case "$TOOL_NAME" in
    Read|Grep|Glob|ToolSearch|LSP|WebSearch|WebFetch|search_knowledge|read_memory|list_memories) echo "THINKING" ;;
    AskUserQuestion|SendMessage|AskFollowupQuestion) echo "QUESTION" ;;
    Edit|Write|MultiEdit|NotebookEdit|TodoWrite|write_memory|delete_memory) echo "WORKING" ;;
    Bash|bash)
      local cmd; cmd=$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null || echo "$TOOL_INPUT")
      if is_readonly_bash "$cmd"; then echo "THINKING"; else echo "WORKING"; fi ;;
    *) echo "WORKING" ;;
  esac
}

NEW_STATE=$(determine_state)
[[ -z "$NEW_STATE" ]] && exit 0

# ── Extract detail (short summary for API) ───────────────────────────────
extract_detail() {
  case "$NEW_STATE" in
    THINKING)
      case "$TOOL_NAME" in
        Read|Grep|Glob)
          local p; p=$(echo "$TOOL_INPUT" | jq -r '.file_path // .pattern // .query // empty' 2>/dev/null || true)
          echo "${TOOL_NAME}: ${p:-(session)}" ;;
        Bash|bash)
          local c; c=$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null || echo "$TOOL_INPUT")
          echo "reading: ${c:0:80}" ;;
        *) echo "${TOOL_NAME:-${HOOK_EVENT}}" ;;
      esac ;;
    WORKING)
      case "$TOOL_NAME" in
        Edit|Write|MultiEdit|NotebookEdit)
          local p; p=$(echo "$TOOL_INPUT" | jq -r '.file_path // .path // empty' 2>/dev/null || true)
          echo "${TOOL_NAME}: ${p:-(file)}" ;;
        Bash|bash)
          local c; c=$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null || echo "$TOOL_INPUT")
          echo "cmd: ${c:0:80}" ;;
        *) echo "${TOOL_NAME:-working}" ;;
      esac ;;
    QUESTION) echo "waiting for input" ;;
    IDLE) echo "${STOP_REASON:-session ended}" ;;
  esac
}
DETAIL=$(extract_detail)

# ── Tier A: report activity (backgrounded) ───────────────────────────────
if [[ -n "$TASK_ID" ]]; then
  ACTIVITY_JSON=$(jq -n --arg state "$NEW_STATE" --arg tool "$TOOL_NAME" \
    --arg detail "$DETAIL" --arg ts "$NOW" --arg sid "$SESSION_ID" \
    '{state:$state,tool:$tool,detail:$detail,timestamp:$ts,sessionId:$sid}')
  orch tasks activity "$TASK_ID" "$ACTIVITY_JSON" >/dev/null 2>&1 &
fi

# ── Tier B: session status (debounced 30s) ───────────────────────────────
if [[ $((NOW_EPOCH - LAST_B_REPORT)) -ge 30 && -n "$SESSION_ID" && "$SESSION_ID" != "unknown" ]]; then
  orch sessions status "$SESSION_ID" --state "$NEW_STATE" --summary "$DETAIL" >/dev/null 2>&1 &
  LAST_B_REPORT="$NOW_EPOCH"
fi

# ── Transcript comments (only on state transitions, throttled) ───────────
if [[ "$HOOK_EVENT" == "PostToolUse" && -n "$TASK_ID" && -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  TOTAL_LINES=$(wc -l < "$TRANSCRIPT_PATH" 2>/dev/null || echo "0")

  if [[ "$TOTAL_LINES" -gt "$LAST_TRANSCRIPT_LINE" ]]; then
    SKIP=$((LAST_TRANSCRIPT_LINE + 1))
    REASONING=$(tail -n +"$SKIP" "$TRANSCRIPT_PATH" 2>/dev/null \
      | jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "text") | .text // empty' 2>/dev/null \
      | awk 'length >= 100' | head -10 || true)
    LAST_TRANSCRIPT_LINE="$TOTAL_LINES"

    if [[ -n "$REASONING" ]]; then
      case "$NEW_STATE" in
        QUESTION|IDLE)
          COMMENT_CONTENT=$(printf '[%s] %s' "$NEW_STATE" "$REASONING" | head -c 2000)
          orch tasks comment "$TASK_ID" "$COMMENT_CONTENT" --author "@agent" --event-type "${NEW_STATE,,}" --json >/dev/null 2>&1 &
          LAST_COMMENT_TIME="$NOW_EPOCH" ;;
        THINKING)
          if [[ $((NOW_EPOCH - LAST_COMMENT_TIME)) -ge 60 ]]; then
            COMMENT_CONTENT=$(printf '[THINKING] %s' "$REASONING" | head -c 2000)
            orch tasks comment "$TASK_ID" "$COMMENT_CONTENT" --author "@agent" --event-type "thinking" --json >/dev/null 2>&1 &
            LAST_COMMENT_TIME="$NOW_EPOCH"
          fi ;;
        WORKING)
          NEW_PENDING="${PENDING_WORK_SUMMARY:+$PENDING_WORK_SUMMARY\n}$REASONING"
          PENDING_WORK_SUMMARY=$(printf '%s' "$NEW_PENDING" | tail -c 1500) ;;
      esac
    fi
  fi
fi

# Post accumulated work summary on state transition away from WORKING
if [[ "$PREV_STATE" == "WORKING" && "$NEW_STATE" != "WORKING" && -n "$TASK_ID" && -n "$PENDING_WORK_SUMMARY" ]]; then
  COMMENT_CONTENT=$(printf '[WORKING] %s' "$PENDING_WORK_SUMMARY" | head -c 2000)
  orch tasks comment "$TASK_ID" "$COMMENT_CONTENT" --author "@agent" --event-type "working" --json >/dev/null 2>&1 &
  PENDING_WORK_SUMMARY=""
  LAST_COMMENT_TIME="$NOW_EPOCH"
fi

# ── Write state file once at the end ─────────────────────────────────────
jq -n \
  --arg taskId "$TASK_ID" \
  --arg currentState "$NEW_STATE" \
  --arg previousState "$PREV_STATE" \
  --arg updatedAt "$NOW" \
  --argjson lastTierBReport "${LAST_B_REPORT:-0}" \
  --argjson lastTranscriptLine "${LAST_TRANSCRIPT_LINE:-0}" \
  --argjson lastCommentTime "${LAST_COMMENT_TIME:-0}" \
  --argjson lastCommentCheck "${LAST_COMMENT_CHECK:-0}" \
  --arg pendingWorkSummary "${PENDING_WORK_SUMMARY:-}" \
  '{taskId:$taskId,currentState:$currentState,previousState:$previousState,
    lastTierBReport:$lastTierBReport,updatedAt:$updatedAt,
    lastTranscriptLine:$lastTranscriptLine,lastCommentTime:$lastCommentTime,
    lastCommentCheck:$lastCommentCheck,pendingWorkSummary:$pendingWorkSummary}' \
  > "$STATE_FILE"

exit 0
