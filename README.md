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

Authentication for the deployed dev `conv-agent` is handled by Cloudflare Access in front of the Worker. The Worker verifies the `Cf-Access-Jwt-Assertion` header on every non-public request using the JWKS published by the team domain; see [`packages/conv-agent/src/adapter/inbound/services/access-jwt-verification-service.ts`](./packages/conv-agent/src/adapter/inbound/services/access-jwt-verification-service.ts). The local profile omits the Access config vars and runs without JWT enforcement.

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

The local backend launcher runs a fully local stack: [`deployment/local/wrangler-local.toml`](./deployment/local/wrangler-local.toml), `~/.thoth/local-secrets.env`, local Postgres, local MinIO, and `conv-agent`.

The dev backend is deployed to Cloudflare Workers with [`deployment/dev/deploy-worker-dev.sh`](./deployment/dev/deploy-worker-dev.sh) and [`deployment/dev/wrangler-cloud-dev.toml`](./deployment/dev/wrangler-cloud-dev.toml).

### Dev OAuth and Cloudflare Access setup

The dev `conv-agent` Worker is protected by a Cloudflare Access self-hosted
application named `conv-agent-dev`. The Access app gates
`https://conv-agent.yashrahmed.workers.dev` before requests reach the Worker.
Browser authentication is delegated to Google OAuth through Cloudflare Access;
the Worker does not receive or store the Google OAuth client secret.

Create or update the Google OAuth client first:

1. Go to **Google Cloud Console** -> **APIs & Services** -> **Credentials**.
2. Create or edit the OAuth 2.0 client named `thoth-oauth-client`.
3. Set the authorized JavaScript origin to:
   ```text
   https://cold-surf-f14c.cloudflareaccess.com
   ```
4. Set the authorized redirect URI to:
   ```text
   https://cold-surf-f14c.cloudflareaccess.com/cdn-cgi/access/callback
   ```
5. Copy the OAuth client id and client secret into the Cloudflare Zero Trust
   Google identity provider configuration. The client id is safe to identify in
   setup notes, but the client secret must not be committed.

Create or update the app in Cloudflare Zero Trust:

1. Go to **Zero Trust** -> **Access controls** -> **Applications**.
2. Create an application under **Self-hosted and private**.
3. Choose the **Workers** destination type.
4. Set the application name to `conv-agent-dev`.
5. Set the destination/domain to `conv-agent.yashrahmed.workers.dev`.
6. In the application identity provider settings, select only the Google
   identity provider. The current Google IdP id is
   `86130f45-78cf-4879-8213-50ec35304992`.
7. Enable automatic redirect to the identity provider because the app has only
   one allowed IdP.
8. Enable the HTTP-only cookie attribute.
9. Leave the binding cookie disabled unless a later Worker binding flow needs
   it.
10. Leave OPTIONS preflight bypass disabled unless browser CORS preflights fail
    before authentication.
11. Configure the application's **CORS settings** so browser clients can call
    the protected origin cross-origin with credentials:
    - **Access-Control-Allow-Origins**: allow all origins for dev convenience.
    - **Access-Control-Allow-Credentials**: enabled.
    - **Access-Control-Allow-Methods**: `GET, POST, PATCH, DELETE, OPTIONS`.
    - **Access-Control-Allow-Headers**: `Content-Type`.
    - Leave wildcards off — wildcards are incompatible with credentialed
      requests.

    The Worker reflects the request `Origin` header on non-`/auth/*` responses
    instead of using `*`, because credentialed browser requests require a
    concrete `Access-Control-Allow-Origin` value. This is intentionally broad
    for the dev Access app; tighten it before exposing non-dev data.

The app configuration should have this shape:

```json
{
  "name": "conv-agent-dev",
  "type": "self_hosted",
  "allowed_idps": ["86130f45-78cf-4879-8213-50ec35304992"],
  "auto_redirect_to_identity": true,
  "session_duration": "24h",
  "domain": "conv-agent.yashrahmed.workers.dev",
  "destinations": [
    {
      "type": "public",
      "uri": "conv-agent.yashrahmed.workers.dev",
      "zone_name": "yashrahmed.workers.dev"
    }
  ],
  "app_launcher_visible": true,
  "enable_binding_cookie": false,
  "http_only_cookie_attribute": true,
  "options_preflight_bypass": false,
  "self_hosted_domains": ["conv-agent.yashrahmed.workers.dev"]
}
```

Attach two policies to the app.

For browser access, add an allow policy for authenticated Google users. The app
itself is already restricted to the Google IdP, so the policy can allow every
authenticated user:

```json
{
  "name": "Allow all logged in users (dev)",
  "decision": "allow",
  "include": [
    {
      "everyone": {}
    }
  ],
  "exclude": [],
  "require": []
}
```

For automated dev tests, create an Access service token under **Access
controls** -> **Service credentials** -> **Service Tokens**, then attach it with
a Service Auth policy. The policy action must be **Service Auth**, which appears
as `non_identity` in JSON. Using `allow` for a service token causes Cloudflare
Access to redirect to the browser login flow instead of accepting the token.

```json
{
  "name": "Allow dev service tokens",
  "decision": "non_identity",
  "include": [
    {
      "service_token": {
        "token_id": "958c9e74-ec96-4d15-bf66-5e62d49c8ad7"
      }
    }
  ],
  "exclude": [],
  "require": []
}
```

Store the generated service-token client id and client secret in
`~/.thoth/dev-secrets.env`:

```sh
CF_ACCESS_CLIENT_ID=...
CF_ACCESS_CLIENT_SECRET=...
```

Do not commit those values. To verify the service-token path without printing
credentials, run:

```sh
./deployment/dev/test-access-service-token.sh
```

### Credential setup

Credentials are loaded from `~/.thoth`, outside the Git checkout.
Secrets files follow the `~/.thoth/{profile}-secrets.env` naming convention.

For local backend runs:

```sh
mkdir -p ~/.thoth
cp deployment/local/local-secrets.env.example ~/.thoth/local-secrets.env
```

Then edit `~/.thoth/local-secrets.env` if you need non-default local Postgres or MinIO values, and set `LLM_API_KEY`.

For the deployed dev Worker and dev system tests, create `~/.thoth/dev-secrets.env` with:

- `BLOB_STORAGE_ACCESS_KEY_ID`
- `BLOB_STORAGE_SECRET_ACCESS_KEY`
- `LLM_API_KEY`
- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`

`MIGRATION_DATABASE_URL` is also required when running dev database migrations manually.

The `conv-agent-dev` Cloudflare Access AUD tag and team domain are set as `[vars]` in [`deployment/dev/wrangler-cloud-dev.toml`](./deployment/dev/wrangler-cloud-dev.toml) and verified by the Worker on every non-public request.

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
3. Smoke-tests the configured Hyperdrive and R2 bucket.
4. Runs `wrangler deploy` for `conv-agent`.
5. Uploads required `conv-agent` secrets with `wrangler secret put`.

To delete the dev Worker while leaving Hyperdrive and R2 resources intact:

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
3. Start the backend stack (Postgres, MinIO, `conv-agent` on `:3001`):
   ```sh
   ./deployment/local/launch-all.sh start
   ```
4. When you are done and wish to stop everything:
   ```sh
   ./deployment/local/launch-all.sh stop
   ```

Logs land in `/tmp/thoth-local/logs/conv-agent.log`.

### How the local launch works

[`deployment/local/launch-all.sh`](./deployment/local/launch-all.sh) coordinates everything:

1. Stops any running worker and tears down the previous docker-compose stack so each `start` is clean.
2. Copies `~/.thoth/local-secrets.env` to `deployment/local/.dev.vars`. Wrangler picks `.dev.vars` up automatically when it boots.
3. Brings up [`deployment/local/docker-compose.yml`](./deployment/local/docker-compose.yml): Postgres (port `5432`), MinIO (port `9000`), and a one-shot `minio-setup` job that creates the local blob bucket. Postgres data lives under `deployment/local/data/_data/`; MinIO data under `deployment/local/data/minio/`.
4. Launches `wrangler dev` from `packages/conv-agent` with the local config on port `3001`. Miniflare (Cloudflare's local Workers runtime, embedded in wrangler) provides:
   - the local Cloudflare Queue (no LocalStack/SQS needed),
   - the local Hyperdrive shim, which resolves `env.HYPERDRIVE.connectionString` to the local config's `localConnectionString`.
5. Each HTTP request and queue batch builds the dependency graph fresh inside the worker and ends the Postgres connection via `ctx.waitUntil` after responding — Workers does not allow I/O objects (TCP sockets, streams) to be reused across requests, so the cache is request-scoped, not isolate-scoped.
Run Flyway separately with [`deployment/run-flyway-migrations.sh`](./deployment/run-flyway-migrations.sh). The `local` target requires `MIGRATION_DATABASE_URL` in `~/.thoth/local-secrets.env`.

## Launching The UI

The web UI runs locally on Vite (default port `5173`) and points at the deployed
Cloudflare-Access-protected `conv-agent` directly — there is no Vite proxy.

```sh
./deployment/local/launch-web.sh dev
```

How auth works in this configuration:

1. The browser issues fetch calls to `https://conv-agent.yashrahmed.workers.dev`
   with `credentials: 'include'`, so the `CF_Authorization` cookie (set on
   `*.workers.dev`) is sent cross-origin.
2. CF Access validates the cookie and injects `Cf-Access-Jwt-Assertion`; the
   Worker verifies the JWT and serves the response. CF Access also injects the
   CORS response headers (`Access-Control-Allow-Origin`,
   `Access-Control-Allow-Credentials`) based on the app's CORS settings, so the
   browser permits the JS to read the body.
3. If the cookie is missing or expired the Worker returns 401, and the web app
   navigates the page to `<conv-agent>/auth/login?redirect_uri=<current URL>`.
   That endpoint is protected by CF Access, so the IdP flow runs, the cookie
   gets set on the conv-agent origin, and the handler 302s the user back to the
   UI.

Pre-requisite: the CF Access app has CORS configured for
`http://localhost:5173` with credentials enabled — see the Access app setup
section above.

The `local` profile of `launch-web.sh` is intentionally rejected: the local
`conv-agent` runs without JWT verification (no Cloudflare Access in front), so
there is no login flow to complete and no cookie to set.

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

1. For the `dev` profile, loads `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` from `~/.thoth/dev-secrets.env` and exports them so the tests authenticate via the Cloudflare Access service-token policy. Local runs against an unprotected `conv-agent` and sends no auth headers.
2. Sets `CONV_AGENT_URL` to `http://127.0.0.1:3001` for `local` or `https://conv-agent.yashrahmed.workers.dev` for `dev`.
3. Polls `{CONV_AGENT_URL}/health` until the worker is ready (passing the service-token headers in `dev` so Access lets the probe through).
4. Runs `bun test --timeout 180000 src/system-tests` from `packages/conv-agent`. The suite (`src/system-tests/conv-agent-st.test.ts`) creates a conversation, posts user messages with image attachments, waits for queued assistant replies, paginates the message history, and deletes the conversation.

Pass extra Bun test arguments after the optional profile.

## Architecture

See [docs/architecture.md](./docs/architecture.md).
