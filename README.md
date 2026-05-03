# Thoth

A fake ChatGPT which will do great things one day...but not today.

## Project Structure

```
thoth/
├── packages/
│   ├── conv-agent/      # Conversation backend, deployed as a Cloudflare Worker
│   ├── web/             # React + Vite web app
│   └── mobile/          # React Native scaffold (placeholder)
├── deployment/          # local + dev deploy scripts, wrangler configs, docker-compose
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

The local backend launcher runs a fully local stack: [`deployment/local/wrangler-local.toml`](./deployment/local/wrangler-local.toml), `~/.thoth/local-secrets.env`, local Postgres, and local MinIO.

The dev backend is deployed to Cloudflare Workers with [`deployment/dev/deploy-worker-dev.sh`](./deployment/dev/deploy-worker-dev.sh) and [`deployment/dev/wrangler-cloud-dev.toml`](./deployment/dev/wrangler-cloud-dev.toml).

### Credential setup

Credentials are loaded from `~/.thoth`, outside the Git checkout.
Secrets files follow the `~/.thoth/{profile}-secrets.env` naming convention.

For local backend runs:

```sh
mkdir -p ~/.thoth
cp deployment/local/local-secrets.env.example ~/.thoth/local-secrets.env
```

Then edit `~/.thoth/local-secrets.env` if you need non-default local Postgres or MinIO values.

For the deployed dev Worker and local UI-to-dev flow, create `~/.thoth/dev-secrets.env` with:

- `BLOB_STORAGE_ACCESS_KEY_ID`
- `BLOB_STORAGE_SECRET_ACCESS_KEY`
- `TEMP_BEARER_TOKEN`

`MIGRATION_DATABASE_URL` is also required when running dev database migrations manually.

## Deploying Dev

The dev Worker runs fully on Cloudflare infrastructure and is exposed at:

```text
https://conv-agent.yashrahmed.workers.dev
```

Deploy from the repo root:

```sh
./deployment/dev/deploy-worker-dev.sh deploy
```

The deploy script:

1. Reads dev credentials from `~/.thoth/dev-secrets.env`.
2. Verifies Wrangler authentication.
3. Smoke-tests the configured Hyperdrive, Queue, and R2 bucket.
4. Runs `wrangler deploy` for `conv-agent`.
5. Uploads required Worker secrets with `wrangler secret put`.

To delete the dev Worker while leaving Hyperdrive, Queue, and R2 resources intact:

```sh
./deployment/dev/deploy-worker-dev.sh teardown
```

## Running Locally

Pre-requisites:
- Bun and Docker.
- `~/.thoth/local-secrets.env` in place with `MIGRATION_DATABASE_URL` populated.

1. Install deps: `bun install`
2. Run local migrations manually:
   ```sh
   ./deployment/local/db-local.sh migrate
   ```
3. Start the backend stack (Postgres, MinIO, conv-agent Worker on `:3001`):
   ```sh
   ./deployment/local/launch-all.sh start
   ```
4. When you are done and wish to stop everything:
   ```sh
   ./deployment/local/launch-all.sh stop
   ```

Logs for the worker land in `/tmp/thoth-local/logs/conv-agent.log`.

### How the local launch works

[`deployment/local/launch-all.sh`](./deployment/local/launch-all.sh) coordinates everything:

1. Stops any running worker and tears down the previous docker-compose stack so each `start` is clean.
2. Copies `~/.thoth/local-secrets.env` to `deployment/local/.dev.vars`. Wrangler picks `.dev.vars` up automatically when it boots.
3. Brings up [`deployment/local/docker-compose.yml`](./deployment/local/docker-compose.yml): Postgres (port `5432`), MinIO (port `9000`), and a one-shot `minio-setup` job that creates the local blob bucket. Postgres data lives under `deployment/local/data/_data/`; MinIO data under `deployment/local/data/minio/`.
4. Launches `wrangler dev` from `packages/conv-agent` with the local config on port `3001`. Miniflare (Cloudflare's local Workers runtime, embedded in wrangler) provides:
   - the local Cloudflare Queue (no LocalStack/SQS needed),
   - the local Hyperdrive shim, which resolves `env.HYPERDRIVE.connectionString` to the local config's `localConnectionString`.
5. Each HTTP request and queue batch builds the dependency graph fresh inside the worker and ends the Postgres connection via `ctx.waitUntil` after responding — Workers does not allow I/O objects (TCP sockets, streams) to be reused across requests, so the cache is request-scoped, not isolate-scoped.

For database-only work, use [`deployment/local/db-local.sh`](./deployment/local/db-local.sh):

```sh
./deployment/local/db-local.sh up
./deployment/local/db-local.sh migrate
./deployment/local/db-local.sh stop
```

The `migrate` command runs Flyway through [`deployment/run-flyway-migrations.sh`](./deployment/run-flyway-migrations.sh) and requires `MIGRATION_DATABASE_URL` in `~/.thoth/local-secrets.env`.

## Launching The UI

The web UI runs locally with Vite on `:5173`. It always calls the backend through a local Vite proxy at `/api`; browser code does not receive the bearer token.

Start the UI against the local Worker:

```sh
./deployment/local/launch-web.sh
```

This uses `~/.thoth/local-secrets.env` and proxies:

```text
/api -> http://127.0.0.1:3001
```

Start the UI against the deployed dev Worker:

```sh
./deployment/local/launch-web.sh dev
```

This uses `~/.thoth/dev-secrets.env` and proxies:

```text
/api -> https://conv-agent.yashrahmed.workers.dev
```

The launcher reads `TEMP_BEARER_TOKEN` from the selected secrets file and exports it only into the Vite dev-server process. [`packages/web/vite.config.ts`](./packages/web/vite.config.ts) injects it as `Authorization: Bearer ...` on proxied API requests.

## Caveats

### Hyperdrive query caching

Hyperdrive query caching must be disabled for the dev Hyperdrive config used by `conv-agent`.

The app performs write-then-immediate-read workflows. For example, `POST /conversations/:id/chat` inserts a user message and dispatches a queue completion, then the queue consumer reads the conversation messages immediately. With Hyperdrive caching enabled, read-only `SELECT` results can be served from cache for the default cache window. That caused stale reads such as:

- the UI seeing conversations that had already been deleted,
- the queue consumer reading an empty message list immediately after the user message was inserted,
- completions being skipped because the completion flow believed the conversation had no messages.

Disable caching for the dev Hyperdrive configuration:

```sh
packages/conv-agent/node_modules/.bin/wrangler hyperdrive update <hyperdrive-id> --caching-disabled true
```

The current dev Hyperdrive id is listed in `deployment/dev/wrangler-cloud-dev.toml`.

## Running Integration Tests

The integration suite drives the running Cloudflare Worker over HTTP. Run it from the repo root:

```sh
./deployment/local/run-integration-tests.sh
```

[`deployment/local/run-integration-tests.sh`](./deployment/local/run-integration-tests.sh) orchestrates the full cycle:

1. Calls `./deployment/local/launch-all.sh start` to bring up Postgres, MinIO, and the worker on port `3001`.
2. Polls `http://127.0.0.1:3001/health` until the worker is ready.
3. Runs `bun test --timeout 180000 src/integration` from `packages/conv-agent`. The suite (`src/integration/conv-agent-it.test.ts`) creates a conversation, posts user messages with image attachments, waits for queued assistant replies, paginates the message history, and deletes the conversation.
4. Tears down via `./deployment/local/launch-all.sh stop` in an `EXIT` trap, so the stack is stopped even if the tests fail or you Ctrl-C.

> ⚠️ This script reuses the local-dev stack. If you have `./deployment/local/launch-all.sh start` running, the orchestrator will stop your worker, tear down your Postgres + MinIO containers, and rebuild them before the test run — and stop everything again at the end. Anything you had open against the local instance will be disrupted.

## Architecture

See [docs/architecture.md](./docs/architecture.md).
