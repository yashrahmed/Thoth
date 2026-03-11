# AGENTS.md

## Architecture

Thoth should be developed using a hexagonal architecture.

- Keep domain logic at the center of the system and follow this layer
  structure:

1. Inbound Adapters (Controllers / UI)
   Receive external input and translate it into application calls.
2. Application Layer (Use Cases / Application Services)
   Orchestrates workflows: loads aggregates, invokes domain logic, calls
   external ports.
3. Domain Layer (Core Model)
   Contains the business model: aggregates, entities, value objects, domain
   services, and repository/port interfaces.
4. Outbound Adapters (Infrastructure)
   Implements technical integrations such as database repositories, external
   APIs, messaging systems, and executors.

- Treat UI, persistence, queues, LLM providers, and external services as
  adapters around the core application.
- Define clear ports/interfaces at the application boundary and implement
  infrastructure concerns behind those ports.
- `message-proxy` and `agents` should run separately as independent services.

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
- For storage-facing abstractions, prefer the `Repository` suffix consistently
  instead of mixing `Port` and `Repository` naming.
- Keep terminology consistent across code, docs, and interfaces.
- When planning simulations are rebuilt, use Rapier for rigid body physics
  and Three.js for visualization.

## Persistence

- Keep SQL migrations as the source of truth for persistence shape.
- Keep domain entities and contracts independent from the database schema.
- Add repository integration tests that run against the local Postgres
  container and exercise contracts end to end.
- Prefer this approach to preserve explicit SQL control, avoid ORM lock-in,
  and catch schema drift with real database-backed verification.
