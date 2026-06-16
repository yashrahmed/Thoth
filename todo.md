## Next Steps

### Thoth 2
- Build the Graph UI.
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

- [ ] The web client computes `getAppendTarget` from the currently loaded message page; a partial page would produce a wrong parent. Derive the append target from the server's leaf response instead.


### Scalability / cost

- [ ] Every completion re-fetches all conversation files, base64-inlines them, and resends them with the full history — risks the Workers 128 MB memory limit and inflates token costs. Send only the active branch's files; consider the Gemini Files API for provider-side caching. (Related to the "repeated signing" perf item — defaulting to base64 inlining would make this worse, not better.)

### Testing

- [ ] Coverage is thin: one unit test file plus HTTP system tests. The trickiest logic (append-store path allocation, depth-window pagination, completion-context building) has no fast tests. AGENTS.md calls for repository tests against local Postgres; none exist.

### Code health

- [ ] `packages/web/src/App.tsx` is ~1,900 lines (API client, hooks, components, styles, formatters). Split into `api.ts`, hooks, and a `components/` directory before building the branching UI.
