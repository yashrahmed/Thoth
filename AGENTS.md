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

- Layer dependency rules:
  - Inbound Adapters may define request/response DTOs, transport models, and
    API mappers.
  - Inbound Adapters may depend only on application services, DTOs, and
    mapping utilities.
  - Inbound Adapters must not depend on domain entities, domain aggregates,
    domain value objects, repository interfaces, repository implementations,
    infrastructure adapters, or ORM/database types.
  - Application Layer may define use cases, commands, queries, application
    DTOs, and workflow orchestration logic.
  - Application Layer may depend on domain types, domain services, repository
    interfaces, and external service interfaces.
  - Application Layer must not depend on repository implementations,
    infrastructure adapters, ORM frameworks, HTTP frameworks, or UI
    components.
  - Domain Layer may define entities, aggregates, value objects, domain
    services, domain events, repository interfaces, and domain ports.
  - Domain Layer may depend only on other domain types and standard library
    utilities.
  - Domain Layer must not depend on controllers, UI, application services,
    DTOs, repository implementations, infrastructure code, databases, HTTP
    frameworks, or messaging frameworks.
  - Outbound Adapters may define repository implementations, ORM mappings,
    external API clients, messaging adapters, cache adapters, file storage
    adapters, and executor implementations.
  - Outbound Adapters may depend on domain types, repository interfaces,
    external service interfaces, and application configuration.
  - Outbound Adapters must not be depended on by the domain layer,
    application services, or inbound adapters.

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
