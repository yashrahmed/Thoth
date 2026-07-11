# Tool-Based Time Measurement

## Problem

Thoth currently gives the LLM temporal awareness by prepending a timestamp to
every user and assistant message. Because the timestamp is placed in the same
text channel as the message content, weaker models sometimes imitate the
metadata and include a completion time or a `sent at ...` line in their reply.

Message timestamps should remain in persistence for ordering, auditing, and UI
display, but they should no longer be rendered into the message text sent to
the LLM. Temporal information should instead be available through tools and
returned as structured tool results only when needed.

## Design Principles

- The application, not the model, owns timestamp lookup, timezone conversion,
  message selection, and elapsed-time arithmetic.
- The model should express the temporal fact it needs rather than calculate it
  from raw timestamps.
- Do not require the model to count conversation turns.
- Do not accept a turn ID unless that ID has already been made visible to the
  model. IDs that exist only in persistence or application DTOs cannot be used
  reliably by the model.
- Resolve all message selectors only against the messages authorized for the
  current completion.
- Treat temporal tool results as transient. Do not persist them as conversation
  history, because values involving the current time become stale.
- If a semantic selector matches multiple messages, return an ambiguity result
  instead of guessing.

## Proposed Tools

### `get_current_time`

Returns the current time in UTC and in the user's configured timezone.

Input:

```json
{}
```

Example output:

```json
{
  "utc": "2026-07-11T18:42:10Z",
  "timezone": "America/Chicago",
  "local": "2026-07-11T13:42:10-05:00"
}
```

The model should use this tool for questions involving "now," "today," or the
current date and time.

### `get_turn_age`

Returns how long ago a selected message was sent. The message is selected by a
relative or semantic selector, not by a numeric position that the model must
count.

Example input using a relative selector:

```json
{
  "turn": {
    "kind": "relative",
    "value": "latest_user"
  }
}
```

Example input using a semantic selector:

```json
{
  "turn": {
    "kind": "semantic",
    "role": "user",
    "query": "my question about deployment"
  }
}
```

Example output:

```json
{
  "sentAt": "2026-07-11T12:40:05-05:00",
  "ageSeconds": 3725,
  "description": "1 hour, 2 minutes, and 5 seconds ago"
}
```

### `get_elapsed_time`

Calculates the elapsed time between two selected messages, or between a message
and the current time.

Example input for two relative messages:

```json
{
  "start": {
    "kind": "relative",
    "value": "previous_user"
  },
  "end": {
    "kind": "relative",
    "value": "latest_user"
  }
}
```

Example input for a content-specific message and the current time:

```json
{
  "start": {
    "kind": "semantic",
    "role": "user",
    "query": "my question about deployment"
  },
  "end": {
    "kind": "now"
  }
}
```

Example output:

```json
{
  "start": "2026-07-11T10:12:00-05:00",
  "end": "2026-07-11T11:14:05-05:00",
  "elapsedSeconds": 3725,
  "description": "1 hour, 2 minutes, and 5 seconds"
}
```

## Message Selectors

The tool contract should support two selector types.

Relative selectors cover common references without requiring counting:

```ts
type RelativeMessageSelector = {
  readonly kind: "relative";
  readonly value:
    | "latest_user"
    | "previous_user"
    | "latest_assistant"
    | "previous_assistant"
    | "first_user"
    | "first_assistant";
};
```

Semantic selectors cover content-specific references to older messages:

```ts
type SemanticMessageSelector = {
  readonly kind: "semantic";
  readonly role: "user" | "assistant";
  readonly query: string;
};

type MessageSelector = RelativeMessageSelector | SemanticMessageSelector;

type TimeEndpoint = MessageSelector | { readonly kind: "now" };
```

Semantic matching may be implemented as deterministic text matching initially
and replaced or augmented by retrieval later. The result should identify no
match, one match, or an ambiguous set of matches explicitly.

## Why Turn IDs Alone Do Not Solve Selection

Turn IDs are not part of the message text sent to the model. A model therefore
cannot provide the ID of a message it is referring to unless the ID is exposed
through some other model-visible channel. Asking for an unseen numeric turn ID
implicitly asks the model to count messages, which is unreliable for weaker
models.

Opaque IDs can still be used internally after the application resolves a
relative or semantic selector. They should not be the primary model-facing
input unless a preceding tool result explicitly exposed them.

## Tool Errors

Tool results should distinguish selection failures from execution failures.

No match:

```json
{
  "status": "not_found",
  "message": "No authorized user message matched the supplied description."
}
```

Ambiguous match:

```json
{
  "status": "ambiguous",
  "matches": [
    { "preview": "How should deployment work?" },
    { "preview": "Can we simplify the deployment script?" }
  ]
}
```

The model can use these results to ask the user which message they meant.

## Application and Adapter Responsibilities

The application layer should:

- Build the temporal tool definitions available for the completion.
- Bind execution to the authorized conversation messages and user timezone.
- Resolve relative and semantic message selectors.
- Read timestamps and calculate derived values.
- Orchestrate the tool-call loop and enforce its maximum number of rounds.

The LLM adapters should:

- Translate provider-neutral tool definitions into provider-specific schemas.
- Translate provider tool calls and tool results into provider-neutral types.
- Preserve tool-call identifiers required by the provider.
- Avoid owning temporal business rules or message-selection logic.

The persistence adapters should continue storing message timestamps unchanged.
No database migration is required for removing timestamps from LLM message
content.

## Migration

1. Introduce provider-neutral tool definitions, tool calls, and tool results at
   the application boundary.
2. Implement the temporal tools with selector resolution scoped to the current
   completion's authorized messages.
3. Add native tool declaration and tool-result handling to each LLM adapter.
4. Remove the `sent at ...` prefix from rendered user and assistant messages.
5. Replace the timestamp-specific system prompt with concise instructions about
   when to use the temporal tools.
6. Keep completion sanitization temporarily during rollout, then remove it once
   evaluation shows that models no longer reproduce timestamp metadata.
7. Add tests for current time, relative selectors, semantic selection, no match,
   ambiguous matches, timezone handling, and ordinary prompts that should not
   call a temporal tool.
