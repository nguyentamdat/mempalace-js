# mempalace

Give your AI a memory. No API key required.

A structured, persistent memory system for AI agents — featuring a palace metaphor (wings → rooms → drawers), a temporal knowledge graph, the AAAK compression dialect, and a 4-layer memory stack.

This is a **Bun/TypeScript** port of the original [mempalace](https://github.com/milla-jovovich/mempalace) by [milla-jovovich](https://github.com/milla-jovovich).

> **OpenCode users**: See [opencode-mempalace](https://github.com/nguyentamdat/opencode-mempalace) for plug-and-play integration.

## Requirements

- [Bun](https://bun.sh/) ≥ 1.0
- [ChromaDB](https://www.trychroma.com/) server running

## Install

```bash
npm install @nguyentamdat/mempalace
# or
git clone https://github.com/nguyentamdat/mempalace-js.git
cd mempalace-js
bun install
```

## Setup

### 1. Start ChromaDB

```bash
# Docker (recommended)
docker run -d --name chromadb -p 127.0.0.1:8001:8000 \
  -v chromadb-data:/chroma/chroma --restart unless-stopped \
  chromadb/chroma:latest

# Or pip
pip install chromadb
chroma run --port 8001
```

### 2. Configure

The default ChromaDB URL is `http://localhost:8000`. Override via environment variable or config:

```bash
# Environment variable
export CHROMA_URL=http://localhost:8001

# Or in ~/.mempalace/config.json
{
  "chroma_url": "http://localhost:8001",
  "palace_path": "~/.mempalace/palace",
  "collection_name": "mempalace_drawers",
  "topic_wings": ["work", "personal", "technical", "creative"]
}
```

### 3. Initialize

```bash
bun run src/index.ts init /path/to/project
```

## Usage

### CLI

```bash
# Mine project files into the palace
bun run src/index.ts mine --mode projects --path ./my-project

# Mine conversation transcripts
bun run src/index.ts mine --mode convos --path ./transcripts

# Search memories
bun run src/index.ts search "some query"

# Compress memories with AAAK dialect (~30x reduction)
bun run src/index.ts compress

# Load memory layers (wake-up)
bun run src/index.ts wake-up

# Split mega transcript files
bun run src/index.ts split --path ./mega-file.txt

# Palace status
bun run src/index.ts status
```

### MCP Server

Run as a JSON-RPC MCP server over stdin/stdout (19 tools):

```bash
CHROMA_URL=http://localhost:8001 bun run src/mcp-server.ts
```

Tools: `mempalace_search`, `mempalace_kg_query`, `mempalace_kg_timeline`, `mempalace_kg_add`, `mempalace_kg_invalidate`, `mempalace_diary_write`, `mempalace_diary_read`, `mempalace_status`, `mempalace_list_wings`, `mempalace_list_rooms`, `mempalace_get_taxonomy`, `mempalace_add_drawer`, `mempalace_delete_drawer`, `mempalace_check_duplicate`, `mempalace_traverse`, `mempalace_find_tunnels`, `mempalace_graph_stats`, `mempalace_get_aaak_spec`.

## Architecture

### Palace Structure

```
~/.mempalace/
├── palace/           (ChromaDB collection data reference)
├── config.json       (palace configuration)
├── entity_registry.json
├── identity.txt      (Layer 0 — who am I)
└── knowledge_graph.db (SQLite)

Palace (in ChromaDB)
├── Wings (top-level categories: work, personal, technical, etc.)
│   └── Rooms (specific topics within a wing)
│       └── Drawers (individual memories with metadata)
├── Diary wing (per-agent daily entries)
└── Embeddings (DefaultEmbeddingFunction)
```

### Memory Layers

| Layer | Content | Size |
|-------|---------|------|
| Layer 0 | `identity.txt` — who am I | ~100 tokens |
| Layer 1 | Auto-generated from top drawers | ~500-800 tokens |
| Layer 2 | On-demand wing/room filtered | Variable |
| Layer 3 | Deep semantic search | Variable |

### AAAK Compression Dialect

A compact encoding format for memories that reduces token usage ~30x while preserving meaning. Uses 3-letter entity codes, emotion markers, pipe-separated fields, and importance stars (★–★★★★★).

### Knowledge Graph

SQLite-based temporal entity-relationship graph with validity windows and confidence scores. Supports entities (people, projects, concepts) and triples (subject → predicate → object).

## Modules

| Module | Description |
|--------|-------------|
| `config.ts` | Palace configuration (env vars, config.json, defaults) |
| `mcp-server.ts` | JSON-RPC MCP server (19 tools) |
| `knowledge-graph.ts` | Temporal entity-relationship graph (bun:sqlite) |
| `dialect.ts` | AAAK compression dialect |
| `layers.ts` | 4-layer memory stack |
| `searcher.ts` | Semantic search via ChromaDB |
| `palace-graph.ts` | Graph traversal and tunnel detection |
| `miner.ts` | Project file mining |
| `convo-miner.ts` | Conversation mining |
| `normalize.ts` | Chat export normalization (Claude, ChatGPT, Slack) |
| `general-extractor.ts` | Extract decisions, preferences, milestones |
| `entity-registry.ts` | Persistent entity registry with Wikipedia lookup |
| `entity-detector.ts` | Auto-detect people/projects from text |
| `onboarding.ts` | Interactive setup wizard |
| `room-detector-local.ts` | Room detection from folder structure |
| `spellcheck.ts` | Optional spell correction |
| `split-mega-files.ts` | Split concatenated transcripts |

## Tests

```bash
bun test
```

## Related

- [opencode-mempalace](https://github.com/nguyentamdat/opencode-mempalace) — OpenCode plugin for automatic integration
- [mempalace](https://github.com/milla-jovovich/mempalace) — Original Python implementation

## Acknowledgements

This project is a Bun/TypeScript port of the original [mempalace](https://github.com/milla-jovovich/mempalace) by [milla-jovovich](https://github.com/milla-jovovich). All credit for the palace architecture, AAAK compression dialect, knowledge graph design, memory layer system, and MCP tool definitions goes to their work.

## License

MIT
