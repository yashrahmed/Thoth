# Architecture

## Overview

```
┌─────────────────────────────────────────────────────┐
│                    Channels                         │
│              Web App  ·  Mobile App                 │
└──────────────────────┬──────────────────────────────┘
                       │ normalized messages
┌──────────────────────▼──────────────────────────────┐
│                  Gateway / Router                   │
│   Auth · Rate limiting · Intent classification      │
│   Routes to the right agent                         │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                    Agents                           │
│  ┌────────────┐ ┌───────────┐ ┌──────────────────┐  │
│  │  Research   │ │   Q/A     │ │  KB Composer     │  │
│  │  Agent      │ │   Agent   │ │  (ingestion)     │  │
│  └─────┬──────┘ └─────┬─────┘ └────────┬─────────┘  │
│        │              │                │             │
│        ▼              ▼                ▼             │
│  ┌─────────────────────────────────────────────┐     │
│  │           Tool Registry                     │     │
│  │  Browser · APIs · Web Search · Calendar     │     │
│  └─────────────────────────────────────────────┘     │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                Knowledge Base                       │
│  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │ Vector Store  │  │  Causal Graph Store         │  │
│  │ (pgvector)    │  │  (pg + adjacency or Neo4j)  │  │
│  └──────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Package Structure

```
packages/
  server/         # HTTP API, WebSocket, gateway/router
  agents/         # Agent definitions, orchestration, tool registry
  knowledge/      # Embeddings, vector search, causal graph CRUD
  channels/       # Adapters: future integrations (web/mobile use server directly)
  web/            # React dashboard
  mobile/         # React Native app
  shared/         # Types, schemas, constants
```

## Design Decisions

**Channel adapters are thin.** Each adapter normalizes to a common `Message`
type and pushes into the gateway. Responses flow back the same way. Agents
never know which channel they're talking to.

**Agents are LLM loops with tools.** Each agent takes a message + context,
calls an LLM in a loop with a tool registry, and returns a response. Uses
the Vercel AI SDK's tool-use pattern directly — no heavy framework.

**Single Postgres instance to start.** `pgvector` for embeddings, regular
tables for the causal graph (nodes + edges with metadata). Avoids running
multiple databases. Can swap in Neo4j for the graph later if queries get
complex.

**Ingestion is async.** The KB Composer agent runs as a background job —
picks up new emails/transcripts/messages, chunks them, embeds them, and
extracts causal relations. Uses a simple Redis + BullMQ queue, or a cron
polling a table.

**Browser automation lives in the tool registry.** Playwright as a tool
agents can invoke. Not a separate service.

## Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| LLM layer | Vercel AI SDK (`ai`) | Model-agnostic, TypeScript-first, no platform dependency |
| LLM providers | Anthropic / OpenAI / Ollama / Gemini | Swappable via AI SDK providers |
| RAG / indexing | LlamaIndex TypeScript | Strong document ingestion, chunking, retrieval |
| Vector store | Postgres + pgvector | One database, no extra infra |
| Causal graphs | Postgres tables (start) → Neo4j (if needed) | Nodes + edges + metadata |
| Queue | BullMQ + Redis | Async ingestion jobs |
| Browser automation | Playwright | Headless, Bun/Node compatible |

## Build Order

1. **`packages/agents`** — one working agent with tool-use via Vercel AI SDK
2. **`packages/knowledge`** — pgvector ingestion + retrieval for a single document type
3. **Wire through `packages/server`** — `/chat` endpoint that takes a message, runs the Q/A agent, returns a response
4. **Add channels one at a time** — web app first (already scaffolded), then additional integrations as needed

The causal graph work is a research track that develops in parallel inside
`packages/knowledge` without blocking the rest.

## Notes

- The Vercel AI SDK is a standalone open-source package (`npm install ai`).
  It has no dependency on Vercel's hosting platform.
- LangChain was considered and rejected: heavy abstraction layer, frequent
  breaking changes, painful to debug for custom behavior.
- LlamaIndex TS and the Vercel AI SDK are complementary — AI SDK handles
  the agent/LLM loop, LlamaIndex handles the knowledge pipeline.
