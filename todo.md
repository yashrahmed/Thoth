### Track 1 - Developing the app in a traditional way.

#### Backend
1. Examine async usage in the context of worker execution.
2. Trials for Auth + Supporting Oauth and multitenancy.
3. Performance improvments.
   1. Separate worker for completions? -- Doesn't really work. Confirm.
   2. Figure out a way around repeated signing.
   3. Perceived-speed wins (server-side only, no UI changes):
      1. Eager assistant placeholder: persist an empty assistant message right after the user message so the next 2s poll renders an acknowledgement bubble instead of silence. Update validation to use the latest *user* message instead of the latest message overall.
      2. Stream the LLM into the placeholder row: switch `model.invoke()` to `model.stream()`, batch updates (~250ms / ~50 tokens) to `messages.content`. Polling cadence renders growing text — fake streaming over the polling channel.
      3. On `LlmError`, write the fallback into the existing placeholder row instead of appending a new message.
      4. Parallelize pre-LLM DB work: with `conversationId` threaded through the dispatch input, run `findAll` + `getFilesOnMessages` concurrently. Saves 100-300ms.
      5. Pre-warm OpenAI: module-scope `fetch('https://api.openai.com/v1/models', { method: 'HEAD' })` on first request so TLS/DNS is hot. Saves 50-200ms on cold isolates.
      6. Trim the system prompt (currently ~150 tokens of metadata-line guard rules) to the minimum that still produces correct output.
      7. Verify OpenAI prompt caching is hitting: log `prompt_tokens_details.cached_tokens` and confirm hit rate >70% on multi-turn convos. Move any volatile content out of the prefix.
      8. Drop `maxRetries` (with the visible fallback message in place, fast failure beats slow self-heal).
   4. Bigger lever (eventually): real streaming via SSE/WebSocket from the worker to the UI. Likely paired with a per-conversation Durable Object so the streamed connection has a stable home and can hold the conversation message list in memory.
   5. Cache API for `GET /chat` polling responses with a 1-2s TTL — reduces Postgres load, doesn't speed up completions but cleans up the read path.
   6. Cloudflare-hosted inference (Workers AI / AI Gateway):
      1. Workers AI: bind `[ai]`, call `env.AI.run("@cf/meta/llama-3.3-70b-instruct", { messages, stream: true })`. Same-colo execution saves ~100-300ms of network overhead vs api.openai.com. Caveat: model quality is a regression from gpt-5.x; small-model latency wins don't offset that for chat. Worth it only if a smaller open model proves "good enough" on the actual prompts.
      2. AI Gateway in front of OpenAI: change base URL to `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai`. Doesn't speed inference but adds prompt caching across identical requests, observability, and provider fallback. Cheap nice-to-have even while staying on OpenAI.
4. Understand how CF agents work.
5. Understand the Cloudflare security model.
6. Idempotency and refresh protection.
7. Set up a basic deploy pipeline.

#### UI
1. Build a basic but chat UI.
2. Checkout [OpenWeb UI](https://docs.openwebui.com/).
3. Figure out md rendering.
4. Build a model picker.

### Track 2 - Develop a mechanism to visualize the code structure and plan code changes.
 ```I will move this into a new project. I wish to be able to build a graph where the node describes the code components```.
1. As of April 09, 2026, I am more inclined to focus on track 03 and instead develop LLM powered workflows to accomplish track 2's goals. I will start out with this and pivot back to developing editing and viz tools. I still think editing and viz tools have a place if only to help the engineer understand the LLM's output.
2. As of April 27,2026. I will start with an editor that looks more like a workbench. The design goal must be to enable an engineer to build systems bottom up and ground the design in real word interactions.
3. May 01, 2026 - This could just be a tool/skill that the agent uses to generate a visualization of the code and render graphs and sequence diagrams.

### Track 3 - Develop techniques to encode world models and test cases.

1. Start with writing test cases using input, output and state descriptions.
2. Learn and try (Quint Lang)[https://quint-lang.org/docs/getting-started]. Use spec modeling to define temporal behaviors.
3. Extend #1 via temporal logic.
4. Encoding world models (for app behavior and changes) via integration tests.
5. Learn ways to maintain a history of changes.

Open Question -

1. How do I improve LLM planning?
   1. Experiment with building workflows.****
   2. You don't. A human in the loop system is a must at this point in time.
   3. Increase the bandwidth b/w the LLMs plans and the engineer making it easier to navigate the codebase and understand the machine's intent. See #2.
   4. For now, it may be prudent to develop tools to enable "gardening".
