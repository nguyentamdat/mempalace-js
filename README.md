# mempalace

Give your AI a memory. No API key required.

A structured, persistent memory system for AI agents — featuring a palace metaphor (wings → rooms → drawers), a temporal knowledge graph, the AAAK compression dialect, and a 4-layer memory stack.

This is a **Bun/TypeScript** port of the original [mempalace](https://github.com/milla-jovovich/mempalace) by [milla-jovovich](https://github.com/milla-jovovich).

## Requirements

- [Bun](https://bun.sh/) ≥ 1.0
- [ChromaDB](https://www.trychroma.com/) server running (`chroma run`)

## Install

```bash
git clone https://github.com/nguyentamdat/mempalace-js.git
cd mempalace-js
bun install
```

## Usage

### CLI

```bash
# Initialize a new palace
bun run src/index.ts init

# Mine project files into the palace
bun run src/index.ts mine --mode projects --path ./my-project

# Mine conversation transcripts
bun run src/index.ts mine --mode convos --path ./transcripts

# Search memories
bun run src/index.ts search "some query"

# Compress memories with AAAK dialect
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
bun run src/mcp-server.ts
```

Tools include: `mempalace_search`, `mempalace_kg_query`, `mempalace_kg_timeline`, `mempalace_kg_add`, `mempalace_kg_invalidate`, `mempalace_diary_write`, `mempalace_diary_read`, `mempalace_status`, `mempalace_list_wings`, `mempalace_list_rooms`, `mempalace_add_drawer`, `mempalace_delete_drawer`, `mempalace_traverse`, `mempalace_find_tunnels`, and more.

## Architecture

### Palace Structure

```
Palace (~/.mempalace/)
├── Wings (top-level categories: work, personal, health, etc.)
│   └── Rooms (specific topics within a wing)
│       └── Drawers (individual memories stored in ChromaDB)
├── Knowledge Graph (SQLite — entities + temporal triples)
├── Diary (daily entries)
└── Config (config.json, entity_registry.json, identity.txt)
```

### Memory Layers

| Layer | Content | Size |
|-------|---------|------|
| Layer 0 | `identity.txt` — who am I | ~100 tokens |
| Layer 1 | Auto-generated from top drawers | ~500-800 tokens |
| Layer 2 | On-demand wing/room filtered | Variable |
| Layer 3 | Deep semantic search | Variable |

### AAAK Compression Dialect

A compact encoding format for memories that reduces token usage while preserving meaning. Includes emotion codes, flag signals, and stop-word removal.

### Knowledge Graph

SQLite-based temporal entity-relationship graph with validity windows and confidence scores. Supports entities (people, projects, concepts) and triples (subject → predicate → object).

## Modules

| Module | Description |
|--------|-------------|
| `config.ts` | Palace configuration management |
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
| `mcp-server.ts` | JSON-RPC MCP server (19 tools) |

## Tests

```bash
bun test
```

## Acknowledgements

This project is a Bun/TypeScript port of the original [mempalace](https://github.com/milla-jovovich/mempalace) by [milla-jovovich](https://github.com/milla-jovovich). All credit for the palace architecture, AAAK compression dialect, knowledge graph design, memory layer system, and MCP tool definitions goes to their work.

## License

MIT
