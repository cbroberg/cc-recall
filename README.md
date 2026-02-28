# cc-recall

**cc-recall** is an open-source npm monorepo + MCP server that locally RAG-indexes your Claude Code session transcripts and makes them searchable via semantic search.

Ask Claude things like:
- *"How did we fix the dark mode issue last week?"*
- *"What did we decide about the database schema?"*
- *"Show me all sessions where we worked on authentication"*

Everything runs locally. No data leaves your machine.

---

## Quick start

**Option A — Setup script (recommended for new machines)**

```bash
git clone https://github.com/cbroberg/cc-recall.git
cd cc-recall
bash scripts/setup.sh
```

The script will:
1. Check prerequisites (Node >= 20, pnpm)
2. Detect your Claude Code sessions path
3. Add `cc-recall` to `~/.claude/settings.json` (preserving existing MCP servers)
4. Build all packages
5. Run initial indexing of all your sessions
6. Print restart instructions

**Option B — npx (no git clone)**

```bash
# Start MCP server
npx @cc-recall/mcp

# Index sessions manually
npx @cc-recall/core index
```

**Option C — Docker**

```bash
docker compose up -d
```

---

## Manual Claude Code integration

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "cc-recall": {
      "command": "npx",
      "args": ["@cc-recall/mcp"]
    }
  }
}
```

Restart Claude Code. The MCP server starts automatically via stdio.

---

## MCP tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `search_sessions` | Semantic search across all sessions | `query` (required), `project`, `chunkType`, `limit` |
| `get_session_context` | Full context for a specific session | `sessionId` |
| `list_decisions` | All `decision` chunks across sessions | `project`, `limit` |
| `get_session_summary` | Summary of a specific session | `sessionId` |

---

## CLI

```bash
# Index all sessions
node packages/core/dist/cli.js index

# Show indexing status
node packages/core/dist/cli.js status
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSIONS_PATH` | `~/.claude/projects/` | Claude Code sessions directory |
| `DB_PATH` | `~/.cc-recall/recall.db` | cc-recall database |
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Embedding model (`all-MiniLM-L6-v2` or `nomic-embed-text`) |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama URL (only needed for `nomic-embed-text`) |
| `WATCH_MODE` | `true` | Auto-index new sessions |
| `LOG_LEVEL` | `info` | Log verbosity |

---

## How it works

1. **Parse** — reads Claude Code JSONL session files from `~/.claude/projects/`
2. **Chunk** — splits sessions into semantic chunks: `decision`, `code-change`, `error-fix`, `architecture`, `conversation`
3. **Embed** — generates 384-dim embeddings locally using `Xenova/all-MiniLM-L6-v2` (no API key needed)
4. **Store** — saves everything to a local SQLite database with `sqlite-vec` for vector search
5. **Search** — cosine similarity search via the MCP tools

Change detection uses SHA-256 hashing — only new or changed sessions are re-indexed.

---

## Tech stack

- **Runtime:** Node.js 20, TypeScript (strict)
- **Package manager:** pnpm workspaces
- **Embedding model:** `Xenova/all-MiniLM-L6-v2` (384 dim, runs locally via `@huggingface/transformers`)
- **Vector store:** SQLite + `sqlite-vec`
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **File watcher:** `chokidar`
- **Build:** `tsup`

---

## Privacy

Secrets are redacted **before** indexing. Original JSONL files are never modified.

Patterns redacted: Anthropic API keys (`sk-ant-...`), OpenAI keys (`sk-...`), GitHub tokens (`ghp_`, `ghu_`), AWS keys (`AKIA...`), generic password/secret/token patterns.

---

## License

MIT
