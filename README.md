# Thoth

A fake ChatGPT which will do great things one day...but not today.

## Project Structure

```
thoth/
├── packages/
│   ├── conv-agent/      # Conversation backend, deployed as a Cloudflare Worker
│   ├── web/             # React + Vite web app
│   └── mobile/          # React Native scaffold (placeholder)
├── deployment/          # local + dev deploy scripts, wrangler configs, docker-compose, system-test runner
└── docs/                # Architecture and design docs
```

The conv-agent's hexagonal layout (`domain/`, `application/`, `adapter/`, `worker/`) lives inside `packages/conv-agent/src/`.

Authentication for the deployed dev `conv-agent` is handled by Cloudflare Access in front of the Worker. The Worker verifies the `Cf-Access-Jwt-Assertion` header on every non-public request using the JWKS published by the team domain; see [`packages/conv-agent/src/adapter/inbound/services/access-jwt-verification-service.ts`](./packages/conv-agent/src/adapter/inbound/services/access-jwt-verification-service.ts). Auth must be explicitly configured with `AUTH_ENABLED`: local sets it to `false`, while deployed dev sets it to `true` and requires the Access team domain and AUD.

### Append flow idempotency

The current append-message persistence path locks the conversation row while it
allocates the next `sequence_number`, so concurrent appends to the same
conversation are ordered consistently. That lock does not make append requests
idempotent: a double click or retried request still creates a second valid
message with the next sequence number.

Do not treat the existing sequence lock as duplicate prevention. Reliable
append-flow idempotency requires a data-model change that records message
lineage or client intent separately, such as tracking the previous message on
each message and enforcing the expected relationship when appending. Until that
model exists, the backend can preserve sequence integrity but cannot guarantee
that duplicate append attempts collapse into one operation.

## Tech Stack

| Concern         | Choice                                                               |
| --------------- | -------------------------------------------------------------------- |
| Backend runtime | Cloudflare Workers (workerd) — `wrangler dev` locally via miniflare  |
| Tooling runtime | Bun                                                                  |
| Language        | TypeScript                                                           |
| HTTP framework  | Hono (running inside the Worker `fetch` handler)                     |
| Background work | Worker `ctx.waitUntil` tasks for assistant completions               |
| Database        | Postgres (+ pgvector image), via `postgres.js` fronted by Hyperdrive |
| Blob storage    | Cloudflare R2 over the S3 protocol; MinIO locally                    |
| Web             | React 19 + Vite                                                      |
| Mobile          | React Native (scaffold only)                                         |
| Architecture    | Hexagonal + DDD                                                      |
| Monorepo        | Bun workspaces                                                       |

### R2 access choice

Blob storage uses R2 through its S3-compatible API instead of native Worker R2 bindings. Native bindings are cleaner for a fully deployed Cloudflare Worker, but `wrangler dev` defaults those bindings to local simulated R2 unless the binding is marked remote, and remote bindings require separate Wrangler authentication. The S3-compatible path keeps local, cloud-backed dev, and eventual Worker deployment on the same adapter shape: configure an endpoint, bucket, region, access key, and secret key, then the backend writes directly to the intended R2 bucket. It also preserves standard S3 presigned URL support for later file access flows.

## Dev Setup

Dev runs on Cloudflare under `https://thoth-dev.bots-ns.com`. The web UI is
served at the root of that host, and the API Worker is mounted below
`/api/v1`.

### Dev infrastructure

- UI: `thoth-web-app-dev`, a Cloudflare Worker assets deployment configured by
  [`deployment/dev/wrangler-web-dev.toml`](./deployment/dev/wrangler-web-dev.toml).
  It serves `packages/web/dist`, uses SPA fallback, and is routed at
  `thoth-dev.bots-ns.com/*`.
- API Worker: `thoth-conv-agent-server-dev`, configured by
  [`deployment/dev/wrangler-server-dev.toml`](./deployment/dev/wrangler-server-dev.toml).
  It is routed at `thoth-dev.bots-ns.com/api/v1*`.
- DB: Cloudflare Hyperdrive points the Worker at the dev Postgres database.
  Hyperdrive query caching must stay disabled because the app has
  write-then-immediate-read flows.
- Blob storage: Cloudflare R2 stores uploaded files through the S3-compatible
  adapter. The dev bucket name is configured in the server Wrangler file.
- Background work: the API Worker schedules assistant completions with
  `ctx.waitUntil`. There is no deployed queue, retry, or DLQ in the current
  design.
- Cloudflare Access gateway: two self-hosted Access apps protect the host. The
  gating app covers `thoth-dev.bots-ns.com/*`; the bypass app covers only
  `/login`, `/forbidden`, and `/assets/*` so the SPA shell can load before
  authentication.
- Google OAuth: Cloudflare Access owns the browser OAuth flow. The Google OAuth
  client has JavaScript origin `https://cold-surf-f14c.cloudflareaccess.com`
  and redirect URI
  `https://cold-surf-f14c.cloudflareaccess.com/cdn-cgi/access/callback`.

### Dev credentials

Credentials are loaded from `~/.thoth/dev-secrets.env`, outside the Git
checkout. The dev deploy and system-test scripts expect these values:

- `BLOB_STORAGE_ACCESS_KEY_ID`
- `BLOB_STORAGE_SECRET_ACCESS_KEY`
- `LLM_API_KEY`
- `ALLOWED_USER_EMAILS`, a comma-separated app authorization allowlist
- `ALLOWED_SERVICE_TOKEN_CLIENT_IDS`, a comma-separated Access service-token
  client-id allowlist
- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`
- `MIGRATION_DATABASE_URL`, only when running dev migrations manually

The service-token client id is safe to identify in config. The corresponding
`CF_ACCESS_CLIENT_SECRET`, R2 secret, LLM key, and Google OAuth client secret
must not be committed.

### Dev Access and authorization

Cloudflare Access requires a Google login before browser requests reach the API
Worker. Access injects `Cf-Access-Jwt-Assertion`; the Worker verifies that JWT
using `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` from the server Wrangler
config, then applies a small app-level allowlist.

The current authorizer maps Access identities like this:

- Google browser logins carry an `email` claim and become `type: "user"`.
- Access service-token requests carry `common_name`, which is the service-token
  client id, and become `type: "service-token"`.
- Unknown token shapes are rejected.

`/auth/logout` is the only always-authorized API path at the Worker layer.
Cloudflare Access still protects it, but the Worker skips the app allowlist so
an authenticated-but-unauthorized Google user can still clear the Access
session. The handler only redirects to Cloudflare Access logout and computes
its return URL from the request host.

For automated dev tests, create a Cloudflare Access service token under
**Access controls** -> **Service credentials** -> **Service Tokens**, then add
it to the gating Access app with a **Service Auth** policy. The browser policy
allows authenticated Google users; the Worker allowlist decides which users can
see application data.

To verify the service-token path without printing credentials, run:

```sh
./deployment/dev/test-access-service-token.sh
```

### Dev deploy

Deploy the server from the repo root:

```sh
./deployment/dev/deploy-server-dev.sh deploy
```

The server deploy script reads dev credentials, verifies Wrangler login,
smoke-tests Hyperdrive and R2, deploys the Worker, and uploads required Worker
secrets.

Deploy the web UI from the repo root:

```sh
./deployment/dev/deploy-web-dev.sh deploy
```

The web deploy script builds `packages/web` with `VITE_THOTH_API_URL=/api/v1`
and `VITE_THOTH_PROFILE=dev`, then deploys the assets Worker.

To delete the deployed Workers while leaving external data resources intact:

```sh
./deployment/dev/deploy-server-dev.sh teardown
./deployment/dev/deploy-web-dev.sh teardown
```

### Dev Access troubleshooting

If the browser shows `ERR_TOO_MANY_REDIRECTS` for
`cold-surf-f14c.cloudflareaccess.com` or `thoth-dev.bots-ns.com`, check Access
cookie settings first. A typical loop looks like this:

1. The browser opens `thoth-dev.bots-ns.com`.
2. Cloudflare Access redirects to the team-domain login URL.
3. The user completes Google login.
4. Cloudflare Access redirects back to `thoth-dev.bots-ns.com`.
5. The browser does not send the Access application cookie state that Access
   expects.
6. Access treats the application session as invalid and redirects back to the
   team-domain login URL.
7. The team domain still has enough global session state to redirect back to
   `thoth-dev.bots-ns.com`.
8. The application cookie is still missing or invalid, so the two hosts repeat
   until the browser stops the chain.

Keep the gating app's binding cookie disabled and do not set the Access
SameSite cookie attribute to `Strict`. If the loop is already in progress,
clear cookies for both `thoth-dev.bots-ns.com` and
`cold-surf-f14c.cloudflareaccess.com` before retesting.

## Local Setup

Local setup is for backend development and system tests. It runs the API Worker
locally on `http://127.0.0.1:3001`.

### Local infrastructure

- UI: not supported locally. The local API runs without Cloudflare Access, so
  the browser login/logout flow cannot be exercised correctly from a local Vite
  server. Use the deployed dev UI at `https://thoth-dev.bots-ns.com`.
- API Worker: `wrangler dev` runs `packages/conv-agent` with
  [`deployment/local/wrangler-server-local.toml`](./deployment/local/wrangler-server-local.toml)
  on port `3001`.
- DB: Docker Compose starts local Postgres on port `5432`. Data lives under
  `deployment/local/data/_data/`.
- Blob storage: Docker Compose starts MinIO on port `9000`; a one-shot setup
  job creates the local bucket. Data lives under `deployment/local/data/minio/`.
- Background work: local Wrangler uses the same `ctx.waitUntil` path as dev.
- Hyperdrive: the local binding resolves to the Wrangler
  `localConnectionString`, which points at local Postgres.
- Cloudflare Access gateway: not present locally. `AUTH_ENABLED=false`, so JWT
  verification and app authorization are disabled.

### Local credentials

Create local credentials outside the Git checkout:

```sh
mkdir -p ~/.thoth
cp deployment/local/local-secrets.env.example ~/.thoth/local-secrets.env
```

Set `LLM_API_KEY` and keep `MIGRATION_DATABASE_URL` populated. Override local
Postgres or MinIO values only if you are not using the default Docker Compose
ports.

### Local run

Install dependencies once:

```sh
bun install
```

Run local migrations manually:

```sh
./deployment/run-flyway-migrations.sh local
```

Start the local backend stack:

```sh
./deployment/local/launch-all.sh start
```

Stop it when finished:

```sh
./deployment/local/launch-all.sh stop
```

Logs land in `/tmp/thoth-local/logs/conv-agent.log`.

[`deployment/local/launch-all.sh`](./deployment/local/launch-all.sh) copies
`~/.thoth/local-secrets.env` to `deployment/local/.dev.vars`, starts the local
Docker services, and launches Wrangler from `packages/conv-agent`. Each HTTP
request builds the dependency graph fresh inside the Worker, and any background
completion work scheduled from that request shares the same graph until
`ctx.waitUntil` closes the Postgres connection.

### Local limitations

- The web UI cannot be tested locally with the current auth model.
- Cloudflare Access browser login, logout, bypass apps, Access cookies, and
  Access JWT injection cannot be tested locally.
- Dev-only Cloudflare infrastructure behavior such as real Hyperdrive and real
  R2 is approximated by local Postgres and MinIO.
- App authorization is disabled locally because `AUTH_ENABLED=false`.

## System Tests

The system tests drive an already-running `conv-agent` over HTTP. They exercise
real application flows: create a conversation, upload image attachments, append
messages, wait for background assistant replies, paginate message history, and
delete the conversation.

### Dev system tests

Dev tests target `https://thoth-dev.bots-ns.com/api/v1`. The runner loads
`CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` from
`~/.thoth/dev-secrets.env` and sends them as Cloudflare Access service-token
headers. Access mints the JWT that the Worker verifies, and the Worker then
authorizes the service-token client id through `ALLOWED_SERVICE_TOKEN_CLIENT_IDS`.

Run dev migrations if needed, then run the tests:

```sh
./deployment/run-flyway-migrations.sh dev
./deployment/system-tests/run-system-tests.sh dev
```

### Local system tests

Local tests target `http://127.0.0.1:3001`. The runner sends no Access headers
because the local Worker is not behind Cloudflare Access.

Start the local stack and run the tests:

```sh
./deployment/run-flyway-migrations.sh local
./deployment/local/launch-all.sh start
./deployment/system-tests/run-system-tests.sh
```

Stop the stack when finished:

```sh
./deployment/local/launch-all.sh stop
```

### Test runner behavior

[`deployment/system-tests/run-system-tests.sh`](./deployment/system-tests/run-system-tests.sh)
supports `local` and `dev` profiles. It picks the target URL, loads profile
credentials from `~/.thoth/{profile}-secrets.env`, polls `/health`, and runs:

```sh
bun test --timeout 180000 src/system-tests/conv-agent-st.test.ts
```

Pass extra Bun test arguments after the optional profile.

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

The app performs write-then-immediate-read workflows. For example, `POST /conversations/:id/chat` inserts a user message and schedules background completion work, then the completion flow reads the conversation messages immediately. With Hyperdrive caching enabled, read-only `SELECT` results can be served from cache for the default cache window. That caused stale reads such as:

- the UI seeing conversations that had already been deleted,
- the completion flow reading an empty message list immediately after the user message was inserted,
- completions being skipped because the completion flow believed the conversation had no messages.

Disable caching for the dev Hyperdrive configuration:

```sh
packages/conv-agent/node_modules/.bin/wrangler hyperdrive update <hyperdrive-id> --caching-disabled true
```

The current dev Hyperdrive id is listed in `deployment/dev/wrangler-server-dev.toml`.
