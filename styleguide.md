# Style Guide

This document captures style and preference guidance for Thoth that is
separate from the architectural rules in [AGENTS.md](./AGENTS.md).

## Naming

- For storage-facing abstractions, prefer the `Repository` suffix
  consistently instead of mixing `Port` and `Repository` naming.
- Keep terminology consistent across code, docs, and interfaces.
- Prefer explicit, named structures over ad hoc or duplicated shapes.

## Types

- Prefer `enum` for closed sets of named values instead of string-literal
  unions or `as const` value lists unless there is a specific reason not to.
- Prefer one canonical home for a shared type instead of parallel duplicate
  definitions.
- Group closely related types together when they form a single concept.
  Example: keep file-related types together and keep LLM-related types
  together rather than splitting them across small files without a clear
  benefit.

## Abstractions

- Prefer less ceremony when two layers intentionally use the same shape.
- Remove redundant mappers or wrapper types when they only pass values
  through unchanged.
- Keep abstractions only when they preserve a real boundary, protect against
  likely divergence, or make the code materially easier to understand.

## Build Plan Mapping

- Map each action in [docs/plans/build_plan.md](./docs/plans/build_plan.md)
  exactly once into code at the layer the plan assigns it to.
- If `build_plan.md` declares an `App.*` action, implement that action as a
  flow in the application layer.
- If `build_plan.md` declares a named action without the `App.*` or `Infra.*`
  prefix, implement that action as a domain service method.
- If `build_plan.md` declares an `Infra.*` action, implement that action as a
  repository or adapter method in the outbound layer.
- Do not collapse distinct plan actions into a single code unit when the plan
  models them separately.
  Example: `App.CreateConversation` and `CreateConversation` are separate
  actions and should remain separate in code.
  Example: `CreateNextMessage` and `PersistToMessageDBStore` are separate
  actions and should not be merged into one repository call site name.
- Do not move a plan action into another layer just because the code would be
  shorter there.
  Example: validation and derived values for `ReadPageFromMessageDBStore`
  belong in the domain service method for that action, not in the flow or
  repository.
  Example: raw SQL and provider error translation for `Infra.SelectMessagePage`
  belong in the repository, not in the domain service.

## Boundaries

- Keep conceptual boundaries clean and intentional.
- Keep architectural rules in [AGENTS.md](./AGENTS.md) and style or aesthetic
  preferences in this document.
- When simplifying code, preserve the layer boundary required by the
  architecture even if the implementation becomes more direct.

## Simulation Stack

- When planning simulations are rebuilt, use Rapier for rigid body physics
  and Three.js for visualization.
