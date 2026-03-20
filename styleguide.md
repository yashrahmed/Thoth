# Style Guide

This document captures style and preference guidance for Thoth that is
separate from the architectural rules in [AGENTS.md](./AGENTS.md).

## Naming

- For storage-facing abstractions, prefer the `Repository` suffix
  consistently instead of mixing `Port` and `Repository` naming.
- Keep terminology consistent across code, docs, and interfaces.

## Types

- Prefer `enum` for closed sets of named values instead of string-literal
  unions or `as const` value lists unless there is a specific reason not to.

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

## Simulation Stack

- When planning simulations are rebuilt, use Rapier for rigid body physics
  and Three.js for visualization.
