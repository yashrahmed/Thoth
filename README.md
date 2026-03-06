# Thoth

An agent system that manages work and personal information.

## Goal

- Use ideas from LlamaIndex and elsewhere to build an agent that automates as much of your life as possible.

## Project Structure

```
thoth/
├── packages/
│   ├── message-proxy/             # HTTP API, WebSocket, proxy layer
│   ├── conversations-agent/       # Primary user-facing agent
│   ├── knowledge-curation-agent/  # Background knowledge curation
│   ├── web/                       # React web app
│   ├── mobile/                    # React Native mobile app
│   └── shared/                    # Shared types and utilities
└── docs/                          # Architecture and design docs
```

## Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Bun |
| Language | TypeScript |
| Web | React + Vite |
| Mobile | React Native |
| Monorepo | Bun workspaces |
| LLM layer | Vercel AI SDK (`ai`) |
| LLM providers | Anthropic / OpenAI / Ollama / Gemini |
| RAG / indexing | LlamaIndex TypeScript |
| Vector store | Postgres + pgvector |
| Queue | BullMQ + Redis |
| Browser automation | Playwright |

## Architecture

See [docs/architecture.md](./docs/architecture.md).
