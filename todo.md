## Next Steps

### Thoth 2
- Build the Graph UI.
    - Figure out how to render graphs.
    - Learn Three.js.
    - Complete React Tutorial.
    - Complete React Native tutorial.
    - Learn some basic graphic design.
    - Resdesign the UI to make it appealing.
- Tech Debt
  - Improve logging (Add structured logs).
  - Try implementing PKCE + local UI launch.
  - Timestamps on tool messages?
  - Figure out a way around repeated signing, defaulting to base64?
- Search and MCP integration.
  - Utility API integration, for example with Groot API reverse engineering.
  - Search support.

### Future versions.
- User management.
- Document vault and memories.
- Model picker.
- Automatic research and knowledge synthesis plus continual learning.
- Deeplink content support.
- Add support for overlay mode and video/audio inputs.
- Completion streaming.
- Context compaction support.
- Thoth mobile prototype.
- [Experimental] In-context RAG for long conversations to improve completion time.
- [Experimental] Talking forms.

## Performance Improvements
- Cloudflare-hosted inference, Workers AI / AI Gateway:
  - Explore CF agents as an inference option to reduce completion time.

## DevOps

- GitHub Actions for building and deploying the app.

## Reviews by Fable

Findings from a code review on 2026-06-09.

### Correctness

- [x] LLM completion context ignores the message tree. Fixed: completion is now requested explicitly via `POST /conversations/:id/request-completion` with `parentMessageId` + `appendPosition`; the prompt is built from the ancestor chain of the parent message (files scoped to that chain too), and duplicate/stale runs are dropped when the declared position is occupied. `validateTriggerMessage` is gone; the parent must be a user message.
- [ ] The web client computes `getAppendTarget` from the currently loaded message page; a partial page would produce a wrong parent. Derive the append target from the server's leaf response instead.

### Security

- [ ] No data ownership model: `thoth.conversations` has no owner column, so any allowed user or service token can read/modify/delete every conversation. Add `owner_identity` and scope queries by it (already on the roadmap as "User management"; cheaper to do before document vault / memories land).
- [ ] CORS reflects any `Origin` with `access-control-allow-credentials: true` (worker `index.ts`). With cookie-based Access auth this lets arbitrary sites make authenticated browser requests. Lock to an origin allowlist, or drop CORS since UI and API share an origin.
- [x] Internal error messages leak to clients: 500 paths (worker fetch handler, Hono `onError`, `mapError`) return raw `error.message`, including DB errors. Log details, return generic messages for non-validation errors.
- [x] Gemini API key is sent in the URL query string (`gemini-llm-adapter.ts`); URLs end up in logs/proxies. Use the `x-goog-api-key` header.

### Scalability / cost

- [ ] Every completion re-fetches all conversation files, base64-inlines them, and resends them with the full history — risks the Workers 128 MB memory limit and inflates token costs. Send only the active branch's files; consider the Gemini Files API for provider-side caching. (Related to the "repeated signing" perf item — defaulting to base64 inlining would make this worse, not better.)

### Testing

- [ ] Coverage is thin: one unit test file plus HTTP system tests. The trickiest logic (append-store path allocation, depth-window pagination, completion-context building) has no fast tests. AGENTS.md calls for repository tests against local Postgres; none exist.

### Docs drift

- [x] README "Append flow idempotency" section still describes `sequence_number` locking (dropped in V19); the `messages_path_unique` constraint now does provide duplicate-append protection. (Rewritten to describe explicit append positions and the request-completion contract.)
- [x] AGENTS.md links to `styleguide.md`, which does not exist.

### Code health

- [ ] `packages/web/src/App.tsx` is ~1,900 lines (API client, hooks, components, styles, formatters). Split into `api.ts`, hooks, and a `components/` directory before building the branching UI.
- [ ] Postgres adapters duplicate `mapRow`/`mapRows`/`toDate`/`getErrorMessage` helpers (~150 lines); extract shared row mappers.
- [x] In `persistMessages`, the back-patch of `child_count` on the previous row is a smell — chain inserts know intermediate nodes have exactly one child, so set `child_count` at insert time.

### Strategic

- [ ] Move completion execution from `ctx.waitUntil` to Cloudflare Queues or Workflows to get retry/DLQ semantics; the `LLMCompletionRunService` port makes this a new adapter rather than a redesign. Prioritize right after the branch-aware completion fix.
