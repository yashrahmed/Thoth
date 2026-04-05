# Thoth

An agent system that manages work and personal information.

## Goal

- Use ideas from LlamaIndex and elsewhere to build an agent that automates as much of your life as possible.
- Add planning as a dedicated capability for constraint-based trip and logistics reasoning.

## Project Structure

```
thoth/
├── packages/
│   ├── conv-agent/                # Primary user-facing conversation service
│   ├── domain/
│   │   ├── entities/              # Shared domain entities
│   │   └── contracts/             # Shared domain contracts
│   ├── message-proxy/             # HTTP API, WebSocket, proxy layer
│   ├── web/                       # React web app
│   ├── mobile/                    # React Native mobile app
│   └── ...                        # Additional adapters and packages as needed
└── docs/                          # Architecture and design docs
```

## Tech Stack

| Concern            | Choice                               |
| ------------------ | ------------------------------------ |
| Runtime            | Bun                                  |
| Language           | TypeScript                           |
| Web                | React + Vite                         |
| Mobile             | React Native                         |
| Architecture       | Hexagonal + DDD                      |
| Monorepo           | Bun workspaces                       |
| LLM layer          | Vercel AI SDK (`ai`)                 |
| LLM providers      | Anthropic / OpenAI / Ollama / Gemini |
| RAG / indexing     | LlamaIndex TypeScript                |
| Vector store       | Postgres + pgvector                  |
| Queue              | BullMQ + Redis                       |
| Browser automation | Playwright                           |

## Configuration

Runtime configuration is loaded from a YAML file referenced by `CONFIG_FILE`.
Each runtime currently reads its own config block:

- `proxy.port`
- `convAgent.port`

For local development:

1. Use [config/launch.yaml](/Users/yashrahmed/Documents/personal-github-repos/Thoth/config/launch.yaml) or another YAML file with the same per-service shape.
2. Inject the config path when starting services.

Examples:

- `CONFIG_FILE=config/launch.yaml bun run --filter @thoth/conv-agent start`
- `CONFIG_FILE=config/launch.yaml bun run --filter @thoth/message-proxy start`

All server entrypoints fail fast if `CONFIG_FILE` is missing or the referenced
YAML file is invalid.

For the local full-stack workflow, [config/launch.yaml](/Users/yashrahmed/Documents/personal-github-repos/Thoth/config/launch.yaml) is a committed non-secret launch config. The local launcher injects it automatically:

- `bun run dev:local:start`
- `bun run dev:local:stop`

The local infrastructure launcher now brings up PostgreSQL plus LocalStack-backed `S3`/`SQS`:

- `bun run db:local:start`
- `bun run db:local:stop`

Persisted LocalStack object-store data is bind-mounted under `db/local/blob-store/`.

## Architecture

See [docs/architecture.md](./docs/architecture.md).
