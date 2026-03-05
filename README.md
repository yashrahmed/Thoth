# Thoth

An agent system that manages work and personal information.

## Goal

- Set up OpenClaw, understand how it works.
- Use ideas from OpenClaw, LlamaIndex and elsewhere to build your own agent that automates as much of your life as possible.

## Architecture

### Channels

- Gmail
- Discord
- Custom Mobile and Web app

### Design

```
Meeting Transcripts ──┐
Teams Chat Messages ──┤
Emails ───────────────┼──►  Knowledge Base  ──►  [ Indexed Knowledge Base ]
Banking Apps & APIs ──┤     Composer Agent              │         ▲
Billing Apps & APIs ──┘                                 │         │
                                                        ▼         │
Mobile App ──┐                                   Research & Q/A Agent
Web App ─────┼──────────────────────────────────►
Email ───────┘
```

- Try browser use for web app integrations.

### Capturing Causal Relationships in the Knowledge Base

#### Why?

Build causal graphical models to help RAG-assisted LLMs answer questions about complex systems.

For this project, an LLM using a causal graph must demonstrate efficacy in the following domains:

1. Hepatic Metabolism.
2. Postgres internals.
3. DOM APIs and CSS (optional).

#### Key Ideas

1. A good causal model with a good retriever can reduce QA errors.
2. Causal graphs may have to be defined at multiple levels of abstraction depending on the use case.
3. An LLM must be able to perform "text-simulations" with these causal graphs for specific scenarios (e.g. simulate why a PG query planner planned a specific query in a certain way, not simply general query planning advice).

#### Notes

1. For Key Idea #3, it would be difficult to get the LLM to correctly ground the knowledge.
2. Complete Basic Stats and Think-Bayes 2.
3. How to capture more abstract relations? Frame hierarchies?
4. Can these models be used to guide coding by describing and constraining app and system structure along with the usage context?

### Questions / Comments

- Check Kimi K2.5.
- Research capabilities outside of ingested data.

### Wildcards

- AR integration to capture spatial data (optional).

## Project Structure

```
thoth/
├── packages/
│   ├── server/        # Backend API server (Bun)
│   ├── web/           # React web app
│   ├── mobile/        # React Native mobile app
│   └── shared/        # Shared types and utilities
└── workspace/         # Local working notes (git-ignored)
```

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript
- **Web:** React
- **Mobile:** React Native
- **Monorepo:** Bun workspaces
