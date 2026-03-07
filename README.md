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
