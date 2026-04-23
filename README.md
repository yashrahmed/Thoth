# Thoth

An agent system that manages work and personal information.

## Goal

- Use ideas from LlamaIndex and elsewhere to build an agent that automates as much of your life as possible.
- Add planning as a dedicated capability for constraint-based trip and logistics reasoning.

## Project Structure

```
thoth/
├── packages/
│   ├── conv-agent/                # Conversation service and proxy entrypoints
│   ├── domain/
│   │   ├── entities/              # Shared domain entities
│   │   └── contracts/             # Shared domain contracts
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

Runtime configuration is loaded from the selected profile YAML under `packages/conv-agent/resources`.
Each runtime reads its own config block from the shared profile file:

- `proxy.port`
- `convAgent.port`

For local development:

1. Use [local.yaml](/Users/yashrahmed/Documents/personal-github-repos/Thoth/packages/conv-agent/resources/local.yaml) or another YAML file with the same per-service shape.
2. Pass the profile name when starting services.

Examples:

- `bun run --filter @thoth/conv-agent start -- local`
- `bun run --filter @thoth/conv-agent proxy:start -- local`

All server entrypoints fail fast if the selected profile file is missing or the
YAML is invalid.

For the local full-stack workflow, [local.yaml](/Users/yashrahmed/Documents/personal-github-repos/Thoth/packages/conv-agent/resources/local.yaml) is a committed non-secret launch config. The local launcher selects it automatically:

- `bun run dev:local:start`
- `bun run dev:local:stop`

The local infrastructure launcher now brings up PostgreSQL plus LocalStack-backed `S3`/`SQS`:

- `bun run db:local:start`
- `bun run db:local:stop`

Persisted MinIO object-store data is bind-mounted under `local-launch/data/minio/`.

## Architecture

See [docs/architecture.md](./docs/architecture.md).
