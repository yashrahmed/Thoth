# AGENTS.md

## Architecture

Thoth should be developed using a hexagonal architecture.

- Keep domain logic at the center of the system.
- Treat UI, persistence, queues, LLM providers, and external services as
  adapters around the core application.
- Define clear ports/interfaces at the application boundary and implement
  infrastructure concerns behind those ports.

## Domain-Driven Design

Use ideas from Domain-Driven Design during development.

- Model the core business concepts explicitly in the domain layer.
- Prefer rich domain entities and value objects over scattered primitive data.
- Keep bounded contexts clear as the system grows.
- Use application services to orchestrate use cases without pushing business
  rules into framework or transport code.

## Development Guidance

- Avoid coupling domain models directly to database, HTTP, or SDK-specific
  shapes.
- Add new capabilities by extending the domain and ports first, then wiring
  adapters around them.
- Keep terminology consistent across code, docs, and interfaces.

## Persistence

- Keep SQL migrations as the source of truth for persistence shape.
- Keep domain entities and contracts independent from the database schema.
- Add repository integration tests that run against the local Postgres
  container and exercise contracts end to end.
- Prefer this approach to preserve explicit SQL control, avoid ORM lock-in,
  and catch schema drift with real database-backed verification.
