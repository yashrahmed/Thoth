# Tool-Based Time Measurement

## Problem

Thoth previously gave the LLM temporal awareness by prepending a timestamp to
every user and assistant message. Because the timestamp was placed in the same
text channel as message content, weaker models sometimes imitated the metadata
and included a completion time or a `sent at ...` line in their replies.

Message timestamps remain in persistence for ordering, auditing, and UI
display, but they are no longer rendered into message text sent to the LLM.
Temporal information is available through two transient tools.

## Tools

### `get_current_time`

Returns the authoritative current time in UTC and in the configured timezone.
The configured timezone is UTC until per-user timezone settings are available.

Input:

```json
{}
```

Example output:

```json
{
  "status": "ok",
  "utc": "2026-07-11T18:42:10.000Z",
  "timezone": "UTC",
  "local": "2026-07-11T18:42:10+00:00"
}
```

### `get_elapsed_time`

Calculates the elapsed time between two messages authorized for the current
completion.

Input:

```json
{
  "before_turn_number": 1,
  "after_turn_number": 2
}
```

Example output:

```json
{
  "status": "ok",
  "beforeTurnNumber": 1,
  "afterTurnNumber": 2,
  "beforeTimestamp": "2026-07-11T12:00:00.000Z",
  "afterTimestamp": "2026-07-11T12:01:05.000Z",
  "elapsedSeconds": 65,
  "description": "1 minute and 5 seconds"
}
```

Turn numbers are 1-based positions in the messages supplied to the current
completion:

```text
turn 1 → first supplied message
turn 2 → second supplied message
turn 3 → third supplied message
```

The definitions are static. They accept positive integer turn numbers and
contain no persisted IDs or per-request values. The model calls
`get_elapsed_time` with the relevant positions. `TimingToolsService.run_tool`
maps each position to `messageContext[turnNumber - 1]`, validates that both
messages exist, and subtracts their persisted timestamps.

## Initialization and Execution

At adapter initialization:

1. `TimingToolsService.get_description()` returns the two static tool
   definitions.
2. The OpenAI adapter binds those definitions to its model client.
3. The Gemini adapter stores the definitions used in every Generate Content
   request.

At completion time:

1. The completion service loads the ordered messages selected by the caller.
2. The completion service calls the configured adapter once.
3. The adapter returns exactly one provider-neutral message. An assistant
   message may contain one or more structured tool calls.
4. For each tool call, the completion service calls
   `TimingToolsService.run_tool(toolName, inputs, messages)`, then appends the
   correlated tool result to its transient transcript.
5. The completion service calls the adapter again with the extended transcript
   and repeats until the adapter returns a message without tool calls.
6. An unresolved tool fails the completion with an `LlmError`.

## Responsibilities

The completion/domain layer:

- Owns the provider-independent tool-call continuation loop.
- Passes exactly the authorized messages into `TimingToolsService.run_tool` as
  its message context.
- Resolves tool names and fails the completion when no matching timing tool
  exists.
- Performs timestamp lookup and elapsed-time arithmetic in code.
- Keeps temporal tool results transient and out of persisted conversation
  history.

The OpenAI and Gemini outbound adapters:

- Translate the provider-neutral tool definitions into native function
  declarations during initialization.
- Perform one model invocation per adapter call and return one message.
- Translate transient assistant tool-call messages and correlated tool-result
  messages to and from provider-native formats.
- Preserve provider call IDs and continuation data such as OpenAI reasoning
  items and Gemini thought signatures.
- Do not resolve or execute tools.

The persistence adapters continue storing message timestamps unchanged. No
database migration is required.

## Validation

- Unit tests verify static definitions, absence of persisted IDs, current time,
  1-based turn mapping, elapsed-time arithmetic, and out-of-range rejection.
- Dedicated system tests require both OpenAI GPT and Gemini to call
  `get_elapsed_time` with turn numbers 1 and 2 and return the exact computed
  duration.
