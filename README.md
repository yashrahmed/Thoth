# Thoth

An agent system that manages work and personal information.

## Goal

- Use ideas from LlamaIndex and elsewhere to build an agent that automates as much of your life as possible.
- Add planning as a dedicated capability for constraint-based trip and logistics reasoning.

## Project Structure

```
thoth/
├── packages/
│   ├── agents/                    # Primary and background agent workflows
│   │   └── planning-agent/        # Planning logic with frame, plan, and sim modules
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

| Concern | Choice |
|---|---|
| Runtime | Bun |
| Language | TypeScript |
| Web | React + Vite |
| Mobile | React Native |
| Architecture | Hexagonal + DDD |
| Monorepo | Bun workspaces |
| LLM layer | Vercel AI SDK (`ai`) |
| LLM providers | Anthropic / OpenAI / Ollama / Gemini |
| RAG / indexing | LlamaIndex TypeScript |
| Vector store | Postgres + pgvector |
| Queue | BullMQ + Redis |
| Browser automation | Playwright |

## Configuration

Runtime configuration is loaded from a YAML file referenced by `CONFIG_FILE`.
That file must be injected at startup and is not intended to be source
controlled. Credentials and database connection settings are injected through
environment variables, not stored in the YAML config.

For local development:

1. Copy [config/local.yaml.example](/Users/yashrahmed/Documents/personal-github-repos/Thoth/config/local.yaml.example) to `config/local.yaml`.
2. Inject the config path when starting services.

Examples:

- `CONFIG_FILE=config/local.yaml bun run --filter @thoth/agents start:conv-agent`
- `CONFIG_FILE=config/local.yaml bun run --filter @thoth/message-proxy start`

All server entrypoints fail fast if `CONFIG_FILE` is missing or the referenced
YAML file is invalid.

For direct manual starts, also export:

- `OPENAI_API_KEY`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `CONV_STORE_DB_HOST`
- `CONV_STORE_DB_PORT`
- `CONV_STORE_DB_NAME`
- `CONV_STORE_DB_USER`
- `CONV_STORE_DB_PASSWORD`
- `CONV_STORE_DB_SSL`

For the local full-stack workflow, [config/launch.yaml](/Users/yashrahmed/Documents/personal-github-repos/Thoth/config/launch.yaml) is a committed non-secret launch config. The local launcher injects it automatically:

- `bun run dev:local:start`
- `bun run dev:local:stop`

The local launcher expects these local secret files:

- `config/llm-creds.yaml`
- `config/cloudflare-creds.yaml`
- `config/@db-creds.yaml`

The local database launcher now uses command-based scripts as well:

- `bun run db:local:start`
- `bun run db:local:stop`

## Planning

Thoth now includes a dedicated `planning-agent` service for planning-oriented
reasoning. The initial merge keeps it narrow and internal:

- `frame` for intent and grounded planning structures
- `plan` for pure planning and orchestration utilities
- `sim` for grounded physics simulation checks

The first version only exposes a health endpoint and shared modules. Public
planning APIs and conversation-agent integration come next.

## Architecture

See [docs/architecture.md](./docs/architecture.md).
