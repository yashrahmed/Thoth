# Infrastructure Options

Current direction: 

| Component | Preferred Option | Notes |
| --- | --- | --- |
| Compute | `Cloudflare Workers` | Prefer `Workers` so compute, blob storage, and async delivery stay on the same platform. Keep compute behind ports so the application layer stays independent from runtime details. |
| Queueing | `Cloudflare Queues` | Prefer `Cloudflare Queues` when compute runs on `Cloudflare Workers`, and when we want async delivery closer to `R2`. |
| Object Storage | `R2` | Prefer `R2` when compute runs on `Cloudflare Workers` because of low storage pricing and no direct egress fees. |
| Postgres | `Neon Postgres` | `Neon` is preferred because it keeps standard Postgres semantics while adding autoscaling and branching for preview environments and integration testing. |
