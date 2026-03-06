# Infrastructure Options

These are the two "best balance" stack options for a single-user personal
assistant using Postgres, `pgvector`, and object storage for documents/media.

| Stack | Components | Good For | Rough Monthly Cost | Tradeoffs |
|---|---|---|---:|---|
| `Best Balance` | `Cloudflare Pages` + `Neon` + `R2` + `App Runner` | Cheap database with AWS-hosted backend compute | `$10-$40` | Mixed cloud setup |
| `Best Balance + Vercel` | `Vercel` + `Neon` + `R2` + `App Runner` | Better frontend DX with AWS-hosted backend compute | `$10-$50` | More vendors and a higher frontend cost ceiling |
