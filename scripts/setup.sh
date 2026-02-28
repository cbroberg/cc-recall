#!/usr/bin/env bash
# cc-recall setup script
# Supports macOS and Linux. Installs cc-recall and registers it as an MCP server in Claude Code.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETTINGS_FILE="$HOME/.claude/settings.json"

# ─── Colors ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}✓${RESET} $*"; }
warn() { echo -e "${YELLOW}!${RESET} $*"; }
err()  { echo -e "${RED}✗${RESET} $*" >&2; }
step() { echo -e "\n${BOLD}$*${RESET}"; }

# Detect OS
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="macOS" ;;
  Linux)  PLATFORM="Linux" ;;
  *)      PLATFORM="$OS" ;;
esac

echo -e "${BOLD}cc-recall setup${RESET} — ${PLATFORM}"

# ─── 1. Prerequisites ─────────────────────────────────────────────────────────
step "1/6  Checking prerequisites"

if ! command -v node &>/dev/null; then
  err "Node.js is not installed. Please install Node.js 20 or later: https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [[ "$NODE_VERSION" -lt 20 ]]; then
  err "Node.js ${NODE_VERSION} is too old. cc-recall requires Node.js 20 or later."
  exit 1
fi
ok "Node.js v$(node --version | tr -d v)"

if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found — installing via corepack..."
  if ! command -v corepack &>/dev/null; then
    err "corepack is not available. Please install pnpm manually: https://pnpm.io/installation"
    exit 1
  fi
  corepack enable
  corepack prepare pnpm@latest --activate
fi
ok "pnpm $(pnpm --version)"

# ─── 2. Detect sessions path ──────────────────────────────────────────────────
step "2/6  Detecting Claude Code sessions path"

# If the user set it explicitly, use that.
if [[ -n "${SESSIONS_PATH:-}" ]]; then
  ok "Using SESSIONS_PATH from environment: $SESSIONS_PATH"
else
  # Claude Code stores sessions in ~/.claude/projects/ on both macOS and Linux.
  # On macOS it is typically /Users/<name>/.claude/projects/
  # On Linux  it is typically /home/<name>/.claude/projects/
  CANDIDATE_PATHS=(
    "$HOME/.claude/projects"
  )

  # On Linux, also check XDG_DATA_HOME if set (non-standard but possible)
  if [[ "$PLATFORM" == "Linux" && -n "${XDG_DATA_HOME:-}" ]]; then
    CANDIDATE_PATHS+=("$XDG_DATA_HOME/claude/projects")
  fi

  SESSIONS_PATH=""
  for CANDIDATE in "${CANDIDATE_PATHS[@]}"; do
    if [[ -d "$CANDIDATE" ]]; then
      SESSIONS_PATH="$CANDIDATE"
      break
    fi
  done

  if [[ -z "$SESSIONS_PATH" ]]; then
    warn "Could not find Claude Code sessions directory automatically."
    warn "Tried: ${CANDIDATE_PATHS[*]}"
    warn "Set SESSIONS_PATH manually and re-run, e.g.:"
    warn "  SESSIONS_PATH=/path/to/.claude/projects bash scripts/setup.sh"
    # Fall back to the standard path so the rest of the script can continue.
    SESSIONS_PATH="$HOME/.claude/projects"
    warn "Proceeding with default: $SESSIONS_PATH"
  else
    SESSION_COUNT=$(find "$SESSIONS_PATH" -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')
    ok "Found sessions at: $SESSIONS_PATH ($SESSION_COUNT JSONL files)"
  fi
fi

# ─── 3+4. Update ~/.claude/settings.json ─────────────────────────────────────
step "3/6  Updating Claude Code MCP configuration"

MCP_COMMAND="node"
# Use absolute path to the built MCP entry point so it works without npx.
MCP_ENTRY="$REPO_DIR/packages/mcp/dist/index.js"

if [[ ! -f "$SETTINGS_FILE" ]]; then
  mkdir -p "$(dirname "$SETTINGS_FILE")"
  node -e "
const entry = process.argv[1];
const sessionsPath = process.argv[2];
const settings = {
  mcpServers: {
    'cc-recall': {
      command: 'node',
      args: [entry],
      env: { SESSIONS_PATH: sessionsPath }
    }
  }
};
process.stdout.write(JSON.stringify(settings, null, 2) + '\n');
" "$MCP_ENTRY" "$SESSIONS_PATH" > "$SETTINGS_FILE"
  ok "Created $SETTINGS_FILE with cc-recall MCP entry"
else
  # Merge cc-recall into existing settings.json without touching other servers.
  MERGE_RESULT=$(node -e "
const fs = require('fs');
const settingsPath = process.argv[1];
const entry = process.argv[2];
const sessionsPath = process.argv[3];

const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
if (!settings.mcpServers) settings.mcpServers = {};

if (settings.mcpServers['cc-recall']) {
  process.stdout.write('EXISTS');
} else {
  settings.mcpServers['cc-recall'] = {
    command: 'node',
    args: [entry],
    env: { SESSIONS_PATH: sessionsPath }
  };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  const others = Object.keys(settings.mcpServers).filter(k => k !== 'cc-recall');
  process.stdout.write('ADDED:' + others.join(','));
}
" "$SETTINGS_FILE" "$MCP_ENTRY" "$SESSIONS_PATH")

  if [[ "$MERGE_RESULT" == "EXISTS" ]]; then
    warn "cc-recall already present in $SETTINGS_FILE — skipping"
    warn "To re-run, remove the cc-recall entry and run setup again."
  else
    OTHER_SERVERS="${MERGE_RESULT#ADDED:}"
    ok "Added cc-recall to $SETTINGS_FILE"
    if [[ -n "$OTHER_SERVERS" ]]; then
      ok "Preserved existing MCP servers: $OTHER_SERVERS"
    fi
  fi
fi

# ─── 5. Install dependencies and build ───────────────────────────────────────
step "4/6  Installing dependencies"
(cd "$REPO_DIR" && pnpm install --frozen-lockfile 2>&1 | tail -5)
ok "Dependencies installed"

step "5/6  Building packages"
(cd "$REPO_DIR" && pnpm build 2>&1 | tail -10)
ok "Build complete"

# ─── 6. Initial indexing ──────────────────────────────────────────────────────
step "6/6  Running initial indexing"

DB_PATH="${DB_PATH:-$HOME/.cc-recall/recall.db}"
mkdir -p "$(dirname "$DB_PATH")"

echo "Sessions: $SESSIONS_PATH"
echo "Database: $DB_PATH"

SESSIONS_PATH="$SESSIONS_PATH" DB_PATH="$DB_PATH" \
  node "$REPO_DIR/packages/core/dist/cli.js" index

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}Done!${RESET}"
echo ""
echo "cc-recall is ready. To activate:"
echo ""
echo -e "  ${BOLD}Restart Claude Code${RESET} — the cc-recall MCP server will start automatically."
echo ""
echo "Available MCP tools:"
echo "  search_sessions       — Semantic search across all sessions"
echo "  get_session_context   — Full context for a specific session"
echo "  list_decisions        — All documented decisions across sessions"
echo "  get_session_summary   — Summary of a specific session"
echo ""
echo "Database: $DB_PATH"
echo "Sessions: $SESSIONS_PATH"
echo ""
echo "Re-index at any time:"
echo "  SESSIONS_PATH=$SESSIONS_PATH DB_PATH=$DB_PATH node $REPO_DIR/packages/core/dist/cli.js index"
