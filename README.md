# Thoth

A fake ChatGPT which will do great things one day...but not today.

## Project Structure

```
thoth/
├── packages/
│   ├── conv-agent/      # Conversation backend, deployed as a Cloudflare Worker
│   ├── proxy-server/     # OAuth client + authenticated proxy for conv-agent
│   ├── web/             # React + Vite web app
│   └── mobile/          # React Native scaffold (placeholder)
├── deployment/          # local + dev deploy scripts, wrangler configs, docker-compose, system-test runner
└── docs/                # Architecture and design docs
```

The conv-agent's hexagonal layout (`domain/`, `application/`, `adapter/`, `worker/`) lives inside `packages/conv-agent/src/`.

The proxy-server follows the same package conventions for its smaller surface:

- `adapter/inbound/` contains the Hono HTTP handler that owns OAuth routes, session-cookie checks, and request proxying.
- `config/` contains runtime config and session-store types.
- `worker/bootstrap.ts` maps Cloudflare Worker bindings into the proxy dependencies.
- `worker/index.ts` is the Cloudflare Worker entrypoint used by Wrangler locally and in dev deploys.

## Tech Stack

| Concern         | Choice                                                               |
| --------------- | -------------------------------------------------------------------- |
| Backend runtime | Cloudflare Workers (workerd) — `wrangler dev` locally via miniflare  |
| Tooling runtime | Bun                                                                  |
| Language        | TypeScript                                                           |
| HTTP framework  | Hono (running inside the Worker `fetch` handler)                     |
| Queue           | Cloudflare Queues (producer + consumer bindings on the same Worker)  |
| Database        | Postgres (+ pgvector image), via `postgres.js` fronted by Hyperdrive |
| Blob storage    | Cloudflare R2 over the S3 protocol; MinIO locally                    |
| Web             | React 19 + Vite                                                      |
| Mobile          | React Native (scaffold only)                                         |
| Architecture    | Hexagonal + DDD                                                      |
| Monorepo        | Bun workspaces                                                       |

### R2 access choice

Blob storage uses R2 through its S3-compatible API instead of native Worker R2 bindings. Native bindings are cleaner for a fully deployed Cloudflare Worker, but `wrangler dev` defaults those bindings to local simulated R2 unless the binding is marked remote, and remote bindings require separate Wrangler authentication. The S3-compatible path keeps local, cloud-backed dev, and eventual Worker deployment on the same adapter shape: configure an endpoint, bucket, region, access key, and secret key, then the backend writes directly to the intended R2 bucket. It also preserves standard S3 presigned URL support for later file access flows.

## Configuration

The local backend launcher runs a fully local stack: [`deployment/local/wrangler-local.toml`](./deployment/local/wrangler-local.toml), [`deployment/local/wrangler-proxy-server-local.toml`](./deployment/local/wrangler-proxy-server-local.toml), `~/.thoth/local-secrets.env`, local Postgres, local MinIO, `conv-agent`, and `proxy-server`.

The dev backend and proxy are deployed to Cloudflare Workers with [`deployment/dev/deploy-worker-dev.sh`](./deployment/dev/deploy-worker-dev.sh), [`deployment/dev/wrangler-cloud-dev.toml`](./deployment/dev/wrangler-cloud-dev.toml), and [`deployment/dev/wrangler-proxy-server-dev.toml`](./deployment/dev/wrangler-proxy-server-dev.toml).

### Credential setup

Credentials are loaded from `~/.thoth`, outside the Git checkout.
Secrets files follow the `~/.thoth/{profile}-secrets.env` naming convention.

For local backend runs:

```sh
mkdir -p ~/.thoth
cp deployment/local/local-secrets.env.example ~/.thoth/local-secrets.env
```

Then edit `~/.thoth/local-secrets.env` if you need non-default local Postgres or MinIO values, set `LLM_API_KEY`, and set the Google OAuth values used by `proxy-server`.

For the deployed dev Workers and local UI-to-dev flow, create `~/.thoth/dev-secrets.env` with:

- `BLOB_STORAGE_ACCESS_KEY_ID`
- `BLOB_STORAGE_SECRET_ACCESS_KEY`
- `LLM_API_KEY`
- `TEMP_BEARER_TOKEN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

`MIGRATION_DATABASE_URL` is also required when running dev database migrations manually.

## Deploying Dev

The dev Workers run fully on Cloudflare infrastructure and are exposed at:

```text
https://conv-agent.yashrahmed.workers.dev
https://proxy-server.yashrahmed.workers.dev
```

Deploy from the repo root:

```sh
./deployment/dev/deploy-worker-dev.sh deploy
```

The deploy script:

1. Reads dev credentials from `~/.thoth/dev-secrets.env`.
2. Verifies Wrangler authentication.
3. Smoke-tests the configured Hyperdrive and R2 bucket.
4. Runs `wrangler deploy` for `conv-agent`.
5. Uploads required `conv-agent` secrets with `wrangler secret put`.
6. Runs `wrangler deploy` for `proxy-server`.
7. Uploads required `proxy-server` secrets with `wrangler secret put`.

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
   ./deployment/run-flyway-migrations.sh local
   ```
3. Start the backend stack (Postgres, MinIO, `conv-agent` on `:3001`, and `proxy-server` on `:8788`):
   ```sh
   ./deployment/local/launch-all.sh start
   ```
4. When you are done and wish to stop everything:
   ```sh
   ./deployment/local/launch-all.sh stop
   ```

Logs land in `/tmp/thoth-local/logs/conv-agent.log` and `/tmp/thoth-local/logs/proxy-server.log`.

### How the local launch works

[`deployment/local/launch-all.sh`](./deployment/local/launch-all.sh) coordinates everything:

1. Stops any running worker and tears down the previous docker-compose stack so each `start` is clean.
2. Copies `~/.thoth/local-secrets.env` to `deployment/local/.dev.vars`. Wrangler picks `.dev.vars` up automatically when it boots.
3. Brings up [`deployment/local/docker-compose.yml`](./deployment/local/docker-compose.yml): Postgres (port `5432`), MinIO (port `9000`), and a one-shot `minio-setup` job that creates the local blob bucket. Postgres data lives under `deployment/local/data/_data/`; MinIO data under `deployment/local/data/minio/`.
4. Launches `wrangler dev` from `packages/conv-agent` with the local config on port `3001`. Miniflare (Cloudflare's local Workers runtime, embedded in wrangler) provides:
   - the local Cloudflare Queue (no LocalStack/SQS needed),
   - the local Hyperdrive shim, which resolves `env.HYPERDRIVE.connectionString` to the local config's `localConnectionString`.
5. Each HTTP request and queue batch builds the dependency graph fresh inside the worker and ends the Postgres connection via `ctx.waitUntil` after responding — Workers does not allow I/O objects (TCP sockets, streams) to be reused across requests, so the cache is request-scoped, not isolate-scoped.
6. Launches `wrangler dev` from `packages/proxy-server` with the local proxy config on port `8788`. The proxy validates the `sid` cookie for API requests, strips browser auth/cookie headers, injects `Authorization: Bearer $TEMP_BEARER_TOKEN`, and relays the request to `conv-agent`.

Run Flyway separately with [`deployment/run-flyway-migrations.sh`](./deployment/run-flyway-migrations.sh). The `local` target requires `MIGRATION_DATABASE_URL` in `~/.thoth/local-secrets.env`.

## Launching The UI

The web UI runs locally with Vite on `:5173`. It calls the backend through the proxy server at `/api`; browser code does not receive the bearer token.

Start the UI against the local Worker:

```sh
./deployment/local/launch-web.sh
```

This proxies:

```text
/api -> http://127.0.0.1:8788
/auth -> http://127.0.0.1:8788
```

Start the UI against the deployed dev Worker:

```sh
./deployment/local/launch-web.sh dev
```

This proxies:

```text
/api -> https://proxy-server.yashrahmed.workers.dev
/auth -> https://proxy-server.yashrahmed.workers.dev
```

[`packages/web/vite.config.ts`](./packages/web/vite.config.ts) only forwards local `/api` and `/auth` traffic to the proxy server. The proxy is the only component that knows the backend bearer token.

## Temporal Awareness

Every user and assistant message sent to the LLM is prefixed with a `sent at ...` header derived from the message's `createdAt`, so the model can reason about when each turn happened and how much time has passed between them.

The header is rendered as the first line of each user/assistant turn:

```
sent at 2026-05-10 14:30:22 +00:00 UTC

<message content>
```

Format details:

- Timestamps are always UTC for now. A per-user timezone setting is on the roadmap; once added, the header will switch to the user's local zone with the offset and abbreviation (e.g. `-05:00 CDT`).
- System and tool messages are not stamped. System messages are directives, not turns; tool messages are model-generated and have no meaningful authoring time.
- The header rendering and the system preamble live in [llm-prompt-domain-service.ts](packages/conv-agent/src/domain/services/llm-prompt-domain-service.ts). The `LlmCompletionFlow` calls the service to shape every message and to prepend the system prompt before handing the result to the LLM adapter, which stays prompt-agnostic. New LLM adapters inherit the behavior automatically.
- Because assistant turns also carry the header, the model would otherwise learn to mimic the format and emit a literal `sent at ...` line at the top of its replies. The system prompt prepended by `LlmPromptDomainService.buildSystemPrompt()` instructs the model to treat the header as system-injected metadata and never reproduce it. This is defense-in-depth, not a guarantee — see the caveat below.

## Caveats

### Cloudflare Secrets Store

Cloudflare Secrets Store is useful for the deployed dev Worker because secrets become account-level values that can be bound to the Worker instead of uploaded with `wrangler secret put`. The main caveat is that local and deployed secret access differ: local runs still need `~/.thoth/local-secrets.env` / `.dev.vars`, while deployed Workers read Secrets Store bindings asynchronously with `await env.<BINDING>.get()`.

For this repo, moving to Secrets Store mainly changes the dev deploy path. It does not remove local credential files, and it requires small Worker bootstrap changes because Secrets Store bindings are not plain string environment variables.

### `sent at` header is user-spoofable

Because the `sent at ...` header is prepended to the same text channel as the user's content, a user can type a line that looks like the header (e.g. `sent at 2099-01-01 00:00:00 +00:00 UTC\n\n...`) inside their own message. The model sees both lines in one user turn and may treat the spoofed timestamp as authoritative.

The risk is low — turns are still role-tagged and the legitimate header always appears first — and we do not defend against it. If temporal claims ever become security-relevant (rate limits, eligibility windows, audit), move the timestamp out of the text channel into a structured field the LLM can see but the user cannot author.

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

## Running System Tests

The system test suite drives an already-running `conv-agent` Worker over HTTP against real infrastructure (Postgres, R2, the LLM provider). The test runner does not start or stop services, and it does not run Flyway migrations.

Run against the local profile:

```sh
./deployment/run-flyway-migrations.sh local
./deployment/local/launch-all.sh start
./deployment/system-tests/run-system-tests.sh
```

When you are done with the local stack:

```sh
./deployment/local/launch-all.sh stop
```

Run against the deployed dev profile:

```sh
./deployment/run-flyway-migrations.sh dev
./deployment/system-tests/run-system-tests.sh dev
```

[`deployment/system-tests/run-system-tests.sh`](./deployment/system-tests/run-system-tests.sh) supports `local` and `dev` profiles:

1. Loads `TEMP_BEARER_TOKEN` from `~/.thoth/{profile}-secrets.env`.
2. Sets `CONV_AGENT_URL` to `http://127.0.0.1:3001` for `local` or `https://conv-agent.yashrahmed.workers.dev` for `dev`.
3. Polls `{CONV_AGENT_URL}/health` until the worker is ready.
4. Runs `bun test --timeout 180000 src/system-tests` from `packages/conv-agent`. The suite (`src/system-tests/conv-agent-st.test.ts`) creates a conversation, posts user messages with image attachments, waits for queued assistant replies, paginates the message history, and deletes the conversation.

Pass extra Bun test arguments after the optional profile.

## Architecture

See [docs/architecture.md](./docs/architecture.md).
