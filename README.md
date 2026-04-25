# Thoth

A fake ChatGPT which will do great things one day...but not today.

## Project Structure

```
thoth/
├── packages/
│   ├── conv-agent/      # Conversation backend, deployed as a Cloudflare Worker
│   ├── web/             # React + Vite web app
│   └── mobile/          # React Native scaffold (placeholder)
├── local-launch/        # docker-compose + launch script for local dev
├── integration/         # docker-compose + script for integration-test infra
└── docs/                # Architecture and design docs
```

The conv-agent's hexagonal layout (`domain/`, `application/`, `adapter/`, `worker/`) lives inside `packages/conv-agent/src/`.

## Tech Stack

| Concern            | Choice                                                               |
| ------------------ | -------------------------------------------------------------------- |
| Backend runtime    | Cloudflare Workers (workerd) — `wrangler dev` locally via miniflare  |
| Tooling runtime    | Bun                                                                  |
| Language           | TypeScript                                                           |
| HTTP framework     | Hono (running inside the Worker `fetch` handler)                     |
| Queue              | Cloudflare Queues (producer + consumer bindings on the same Worker)  |
| Database           | Postgres (+ pgvector image), via `postgres.js` fronted by Hyperdrive |
| Blob storage       | Cloudflare R2 over the S3 protocol; MinIO locally                    |
| Web                | React 19 + Vite                                                      |
| Mobile             | React Native (scaffold only)                                         |
| Architecture       | Hexagonal + DDD                                                      |
| Monorepo           | Bun workspaces                                                       |

## Configuration

Cloud deployment is **not yet supported**; the project is currently wired only for local runs. A real Cloudflare deployment path (Hyperdrive id, R2 bucket, secrets via `wrangler secret`) will be set up soon.

Local config lives in two places:

- **Worker config** — [`packages/conv-agent/wrangler.toml`](./packages/conv-agent/wrangler.toml): bindings (Hyperdrive, R2 access env vars, Cloudflare Queue producer/consumer), `compatibility_flags = ["nodejs_compat"]`, dev port `3001`, and a `localConnectionString` that points Hyperdrive at the local Postgres.
- **Local secrets** — [`local-launch/local-secrets.env.example`](./local-launch/local-secrets.env.example): copy to `local-launch/local-secrets.env` and fill in MinIO credentials. The launcher copies this file into `packages/conv-agent/.dev.vars` at start-up so `wrangler dev` picks it up; the file is removed on stop.

## Running Locally

Pre-requisites: Bun, Docker, and the `local-secrets.env` file in place.

1. Install deps: `bun install`
2. Start the backend stack (Postgres, MinIO, conv-agent Worker on `:3001`):
   ```sh
   bun run dev:local:start
   ```
3. In a second terminal, start the web app (Vite on `:5173`):
   ```sh
   bun run dev:web
   ```
4. When you are done and wish to stop everything:
   ```sh
   bun run dev:local:stop
   ```

Logs for the worker land in `/tmp/thoth-local/logs/conv-agent.log`.

### How the local launch works

[`local-launch/launch-all.sh`](./local-launch/launch-all.sh) which is what the bun run ... command launches, coordinates everything:

1. Stops any running worker and tears down the previous docker-compose stack so each `start` is clean.
2. Copies `local-launch/local-secrets.env` → `packages/conv-agent/.dev.vars`. Wrangler picks `.dev.vars` up automatically when it boots.
3. Brings up [`local-launch/docker-compose.yml`](./local-launch/docker-compose.yml): Postgres (port `5432`), MinIO (port `9000`), and a one-shot `minio-setup` job that creates the local blob bucket. Postgres data lives under `local-launch/data/_data/`; MinIO data under `local-launch/data/minio/`.
4. Runs the Flyway migrations container against Postgres using SQL under `packages/conv-agent/resources/db/migrations/`.
5. Launches `wrangler dev` from `packages/conv-agent` on port `3001`. Miniflare (Cloudflare's local Workers runtime, embedded in wrangler) provides:
   - the local Cloudflare Queue (no LocalStack/SQS needed),
   - the local Hyperdrive shim, which resolves `env.HYPERDRIVE.connectionString` to the `localConnectionString` from `wrangler.toml` and points the worker's `postgres.js` client at `127.0.0.1:5432`.
6. Each HTTP request and queue batch builds the dependency graph fresh inside the worker and ends the Postgres connection via `ctx.waitUntil` after responding — Workers does not allow I/O objects (TCP sockets, streams) to be reused across requests, so the cache is request-scoped, not isolate-scoped.

## Architecture

See [docs/architecture.md](./docs/architecture.md).
