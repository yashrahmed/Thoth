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

### R2 access choice

Blob storage uses R2 through its S3-compatible API instead of native Worker R2 bindings. Native bindings are cleaner for a fully deployed Cloudflare Worker, but `wrangler dev` defaults those bindings to local simulated R2 unless the binding is marked remote, and remote bindings require separate Wrangler authentication. The S3-compatible path keeps local, cloud-backed dev, and eventual Worker deployment on the same adapter shape: configure an endpoint, bucket, region, access key, and secret key, then the backend writes directly to the intended R2 bucket. It also preserves standard S3 presigned URL support for later file access flows.

## Configuration

Cloud deployment is **not yet supported**; the project is currently wired only for local runs. A real Cloudflare deployment path (Hyperdrive id, R2 bucket, secrets via `wrangler secret`) will be set up soon.

The launcher supports two local run profiles:

- **`local`** — [`local-launch/wrangler-local.toml`](./local-launch/wrangler-local.toml) plus `~/.thoth/local-secrets.env`. This profile starts local Postgres and MinIO via Docker and points Hyperdrive at the local database.
- **`dev`** — `local-launch/wrangler-cloud-dev.toml` plus `~/.thoth/dev-secrets.env`. This profile runs the Worker locally against cloud-backed resources and skips local Postgres and MinIO.

### Credential setup

Credentials are loaded from `~/.thoth`, outside the Git checkout.
Secrets files follow the `~/.thoth/{profile}-secrets.env` naming convention.

For the local profile:

```sh
mkdir -p ~/.thoth
cp local-launch/local-secrets.env.example ~/.thoth/local-secrets.env
```

Then edit `~/.thoth/local-secrets.env` if you need non-default local Postgres or MinIO values.

For the cloud-backed dev profile, create `~/.thoth/dev-secrets.env` with the cloud development values, including `MIGRATION_DATABASE_URL`, `BLOB_STORAGE_ACCESS_KEY_ID`, and `BLOB_STORAGE_SECRET_ACCESS_KEY`. The dev profile also requires `local-launch/wrangler-cloud-dev.toml`.

## Running Locally

Pre-requisites:
- `local` profile: Bun, Docker, and `~/.thoth/local-secrets.env` in place with `MIGRATION_DATABASE_URL` populated.
- `dev` profile: Bun, `local-launch/wrangler-cloud-dev.toml`, and `~/.thoth/dev-secrets.env` populated with cloud development values, including `MIGRATION_DATABASE_URL`.

1. Install deps: `bun install`
2. Run migrations manually for the profile you intend to use:
   ```sh
   sh ./deployment/run-flyway-migrations.sh local
   ```
   For the cloud-backed dev profile instead:
   ```sh
   sh ./deployment/run-flyway-migrations.sh dev
   ```
3. Start the backend stack (Postgres, MinIO, conv-agent Worker on `:3001`):
   ```sh
   bun run dev:local:start
   ```
   To start the cloud-backed dev profile instead:
   ```sh
   ./local-launch/launch-all.sh start dev
   ```
4. In a second terminal, start the web app (Vite on `:5173`):
   ```sh
   bun run dev:web
   ```
5. When you are done and wish to stop everything:
   ```sh
   bun run dev:local:stop
   ```

Logs for the worker land in `/tmp/thoth-local/logs/conv-agent.log`.

### How the local launch works

[`local-launch/launch-all.sh`](./local-launch/launch-all.sh) which is what the bun run ... command launches, coordinates everything:

1. Stops any running worker and tears down the previous docker-compose stack so each `start` is clean.
2. Selects a profile-specific Wrangler config and secrets file:
   - `local`: `wrangler-local.toml` + `~/.thoth/local-secrets.env`
   - `dev`: `wrangler-cloud-dev.toml` + `~/.thoth/dev-secrets.env`
3. Copies the selected secrets file → `local-launch/.dev.vars`. Wrangler picks `.dev.vars` up automatically when it boots.
4. For the `local` profile only, brings up [`local-launch/docker-compose.yml`](./local-launch/docker-compose.yml): Postgres (port `5432`), MinIO (port `9000`), and a one-shot `minio-setup` job that creates the local blob bucket. Postgres data lives under `local-launch/data/_data/`; MinIO data under `local-launch/data/minio/`.
5. Launches `wrangler dev` from `packages/conv-agent` with the selected config on port `3001`. Miniflare (Cloudflare's local Workers runtime, embedded in wrangler) provides:
   - the local Cloudflare Queue (no LocalStack/SQS needed),
   - the local Hyperdrive shim, which resolves `env.HYPERDRIVE.connectionString` to the selected config's `localConnectionString`.
6. Each HTTP request and queue batch builds the dependency graph fresh inside the worker and ends the Postgres connection via `ctx.waitUntil` after responding — Workers does not allow I/O objects (TCP sockets, streams) to be reused across requests, so the cache is request-scoped, not isolate-scoped.

Run Flyway separately with [`deployment/run-flyway-migrations.sh`](./deployment/run-flyway-migrations.sh):
- `local`: requires `MIGRATION_DATABASE_URL` in `~/.thoth/local-secrets.env`
- `dev`: requires `MIGRATION_DATABASE_URL` in `~/.thoth/dev-secrets.env`

## Running Integration Tests

The integration suite drives the running Cloudflare Worker over HTTP. Run it from the repo root:

```sh
bun run test:integration
```

[`local-launch/run-integration-tests.sh`](./local-launch/run-integration-tests.sh) orchestrates the full cycle:

1. Calls `./local-launch/launch-all.sh start` to bring up Postgres, MinIO, and the worker on port `3001` (same stack as `bun run dev:local:start`).
2. Polls `http://127.0.0.1:3001/health` until the worker is ready.
3. Runs `bun test --timeout 180000 src/integration` from `packages/conv-agent`. The suite (`src/integration/conv-agent-it.test.ts`) creates a conversation, posts user messages with image attachments, waits for queued assistant replies, paginates the message history, and deletes the conversation.
4. Tears down via `./local-launch/launch-all.sh stop` in an `EXIT` trap, so the stack is stopped even if the tests fail or you Ctrl-C.

> ⚠️ This script reuses the local-dev stack. If you have `bun run dev:local:start` running, the orchestrator will stop your worker, tear down your Postgres + MinIO containers, and rebuild them before the test run — and stop everything again at the end. Anything you had open against the local instance will be disrupted.

## Architecture

See [docs/architecture.md](./docs/architecture.md).
