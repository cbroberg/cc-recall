# cc-recall — CLAUDE.md

## Hvad er dette projekt?

cc-recall er et **selvstændigt open source-projekt** — et npm monorepo + MCP server der RAG-indekserer Claude Code session-transkripter (JSONL-filer) og gør dem søgbare via semantisk søgning.

**Fuld spec:** `/Users/cb/Apps/cbroberg/codepromptmaker/docs/v7-integration.md` (sektion 3)
**Baggrund:** `docs/LOG-cc-recall-discussion.md`

Projektet er designet til at kunne plugges ind i CPM (CodePromptMaker) men fungerer 100% standalone. Se v7-spec for integrationsarkitektur.

---

## Monorepo-struktur

```
cc-recall/
├── CLAUDE.md
├── package.json                  # pnpm workspace root
├── pnpm-workspace.yaml
├── README.md
├── LICENSE                       # MIT
├── Dockerfile
├── docker-compose.yml
├── docs/
│   └── LOG-cc-recall-discussion.md
└── packages/
    ├── core/                     # @cc-recall/core
    │   └── src/
    │       ├── index.ts          # Public API (exports)
    │       ├── types.ts          # SessionChunk, SessionMetadata, ChunkType, SearchResult
    │       ├── parser.ts         # JSONL parser
    │       ├── chunker.ts        # Semantic chunking (5 chunk types)
    │       ├── embeddings.ts     # RecallEmbeddingProvider (all-MiniLM-L6-v2)
    │       ├── embeddings-ollama.ts  # OllamaEmbeddingProvider (nomic-embed-text)
    │       ├── store.ts          # SQLite + sqlite-vec operations
    │       ├── indexer.ts        # Full pipeline: parse → chunk → embed → store
    │       ├── search.ts         # Semantic search
    │       ├── watcher.ts        # chokidar file watcher for incremental indexing
    │       └── redact.ts         # Privacy/secret redaction
    └── mcp/                      # @cc-recall/mcp
        └── src/
            ├── index.ts          # MCP server entry point
            ├── server.ts         # MCP server implementation
            └── tools.ts          # Tool definitions + handlers (4 tools)
```

---

## Tech stack

| Kategori | Valg | Note |
|----------|------|------|
| Runtime | Node.js 20 | |
| Language | TypeScript | strict mode |
| Package manager | pnpm | workspace monorepo |
| Embedding model | `Xenova/all-MiniLM-L6-v2` | via `@huggingface/transformers`, 384 dim, lokalt, gratis |
| Vector store | SQLite + `sqlite-vec` | `~/.cc-recall/recall.db` |
| MCP SDK | `@modelcontextprotocol/sdk` | |
| File watcher | `chokidar` | |
| Build | `tsup` | |

---

## Database

**Lokation:** `~/.cc-recall/recall.db` (brugerens home directory — ikke i repo)

Tre tabeller:
- `sessions` — metadata per JSONL-fil (id, project_path, file_hash, message_count, etc.)
- `chunks` — semantiske chunks (type, content, summary, message range, tools_used, files_referenced)
- `chunks_vec` — sqlite-vec virtual table med embeddings (FLOAT[384])

Change detection via SHA-256 hash. Ny fil → fuld indeksering. Ændret hash → re-indeksering (slet + re-indeksér).

---

## Chunk-typer

```typescript
type ChunkType = 'decision' | 'code-change' | 'error-fix' | 'architecture' | 'conversation';
```

Chunking-regler (se v7-spec sektion 3.4 for detaljer):
- **decision** — nøgleord: "vi valgte", "beslutning:", "fordi", "anbefaling:", "reason:"
- **code-change** — sekvens: Read → Edit/Write → verifikation
- **error-fix** — mønster: fejlbesked → analyse → fix → verifikation
- **architecture** — lange assistant-beskeder (>500 tegn) med arkitektur-termer
- **conversation** — alt andet, vinduer af 3-5 besked-par med overlap

Chunk-størrelse: 200–800 tokens. Lange chunks splittes ved afsnit. Korte sammenlægges.

---

## Embedding

Default: `Xenova/all-MiniLM-L6-v2` (384 dim) — kører lokalt via `@huggingface/transformers`.
Upgrade path: `nomic-embed-text` via Ollama (768 dim) — opt-in, kræver Ollama installeret.

`RecallEmbeddingProvider` implementerer samme interface som CPM's `EmbeddingProviderInterface` for fremtidig kompatibilitet.

---

## MCP tools (4 tools)

| Tool | Beskrivelse |
|------|-------------|
| `search_sessions` | Semantisk søgning på tværs af sessioner. Params: `query` (required), `project`, `chunkType`, `limit` |
| `get_session_context` | Fuld kontekst for én session. Param: `sessionId` |
| `list_decisions` | Alle `decision`-chunks. Params: `project`, `limit` |
| `get_session_summary` | Opsummering af én session. Param: `sessionId` |

MCP server kører via stdio (standard for cc-integration).

---

## JSONL session-format

Claude Code gemmer sessions under: `~/.claude/projects/<project-path>/<session-uuid>.jsonl`

Hvert linje er et JSON-objekt med `type` (`human` | `assistant` | `tool_result`), `message.content`, `message.tool_calls`, `timestamp`. Se v7-spec sektion 3.3 for fuld struktur.

**OBS:** JSONL-formatet er en cc intern detalje. Parser skal håndtere ukendte felter gracefully (ignorer, log ikke crash).

---

## Privacy/redaction

Secrets redactes FØR indeksering. Originale JSONL-filer røres aldrig.

Mønstre der redactes: Anthropic API keys (`sk-ant-...`), OpenAI keys (`sk-...`), GitHub tokens (`ghp_`, `ghu_`), AWS keys (`AKIA...`), generiske password/secret/token patterns.

---

## Deployment

**npx (default):**
```bash
npx @cc-recall/mcp           # Start MCP server
npx @cc-recall/core index    # Indeksér alle sessioner
```

**Docker (alternativ):**
```bash
docker compose up -d
```

**Claude Code integration:**
```json
// ~/.claude/settings.json
{
  "mcpServers": {
    "cc-recall": {
      "command": "npx",
      "args": ["@cc-recall/mcp"]
    }
  }
}
```

---

## Environment variables

```bash
SESSIONS_PATH=~/.claude/projects/        # Hvor cc gemmer JSONL-filer
DB_PATH=~/.cc-recall/recall.db           # cc-recall database
EMBEDDING_MODEL=all-MiniLM-L6-v2         # eller 'nomic-embed-text'
OLLAMA_URL=http://localhost:11434         # kun hvis Ollama bruges
WATCH_MODE=true                          # auto-indeksér nye sessioner
LOG_LEVEL=info
```

---

## Vigtige constraints

- **Ingen CPM-dependency** — cc-recall må ikke importere fra CPM's codebase. Interfaces (fx `EmbeddingProviderInterface`) kopieres/re-implementeres, ikke importeres.
- **Selvstændig database** — `~/.cc-recall/recall.db`, ikke CPM's database.
- **sqlite-vec** er et native addon — test at det kompilerer korrekt på target platform. Overvej fallback.
- **MIT license** — projektet er open source.
- **Originale JSONL-filer er read-only** — cc-recall skriver aldrig til `~/.claude/projects/`.

---

## Implementeringsrækkefølge (anbefalet)

1. Monorepo setup (`package.json`, `pnpm-workspace.yaml`, tsconfigs)
2. `packages/core/src/types.ts` — alle types på plads først
3. `packages/core/src/parser.ts` — JSONL parser
4. `packages/core/src/chunker.ts` — semantic chunking
5. `packages/core/src/redact.ts` — privacy pipeline
6. `packages/core/src/embeddings.ts` + `embeddings-ollama.ts`
7. `packages/core/src/store.ts` — SQLite + sqlite-vec
8. `packages/core/src/indexer.ts` — full pipeline
9. `packages/core/src/search.ts`
10. `packages/core/src/watcher.ts`
11. `packages/core/src/index.ts` — public API exports
12. `packages/mcp/src/tools.ts` + `server.ts` + `index.ts`
13. `Dockerfile` + `docker-compose.yml`
