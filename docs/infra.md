# Infrastructure

This document tracks the deployed dev infrastructure shape. The current dev
host is `https://thoth-dev.bots-ns.com`.

## Dev components

| Component | Current Setup | Notes |
| --- | --- | --- |
| Web UI | Cloudflare Worker assets deployment | `thoth-web-app-dev` serves `packages/web/dist` at `thoth-dev.bots-ns.com/*` with single-page-app fallback. |
| API | Cloudflare Worker | `thoth-conv-agent-server-dev` is routed at `thoth-dev.bots-ns.com/api/v1*`. |
| Auth gateway | Cloudflare Access | Access protects browser and system-test traffic before it reaches the API Worker. |
| Postgres | Postgres behind Cloudflare Hyperdrive | The Worker uses the `HYPERDRIVE` binding. Hyperdrive query caching must stay disabled for write-then-immediate-read flows. |
| Object storage | Cloudflare R2 over the S3-compatible API | The Worker writes to the dev R2 bucket through the blob repository adapter. |
| Background work | Worker `ctx.waitUntil` | Assistant completions are scheduled inside the API Worker. There is no deployed queue, retry, or DLQ in the current design. |
