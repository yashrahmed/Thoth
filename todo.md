   
#### Post Milestone 1 (Maybe in a different project)
1. Plan to split the UI and the server.****
2. Idempotency and refresh protection.
3. Definitely a better way to build and manage login and logout flow.
4. Domain setup for local testing.
5. Beefed up security.
6. A proper user management system that tracks user to conversations.
7. Performance improvments.
   1. Figure out a way around repeated signing.
   2. Bigger lever (eventually): real streaming via SSE/WebSocket from the worker to the UI. Likely paired with a per-conversation Durable Object so the streamed connection has a stable home and can hold the conversation message list in memory.
   3. Cloudflare-hosted inference (Workers AI / AI Gateway):
      1. Workers AI: bind `[ai]`, call `env.AI.run("@cf/meta/llama-3.3-70b-instruct", { messages, stream: true })`. Same-colo execution saves ~100-300ms of network overhead vs api.openai.com. Caveat: model quality is a regression from gpt-5.x; small-model latency wins don't offset that for chat. Worth it only if a smaller open model proves "good enough" on the actual prompts.
8. Build a small user management system.
9. Understand how CF agents work.
10. Understand the Cloudflare security model.
11. Set up a basic deploy pipeline.