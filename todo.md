### Track 1 - Developing the app in a traditional way.

#### Backend
1. Examine async usage in the context of worker execution.
2. Trials for Auth + Supporting Oauth and multitenancy.
   1. Try out a simple proxy server with Google Auth (Requires UI changes).
   2. Google token verification.
   3. Session persistance.
   4. Add support for user management.
   5. Try out CF Access / CF Zero trust reverse proxy.
3. Performance improvments.
   1. Figure out a way around repeated signing.
   2. Bigger lever (eventually): real streaming via SSE/WebSocket from the worker to the UI. Likely paired with a per-conversation Durable Object so the streamed connection has a stable home and can hold the conversation message list in memory.
   3. Cloudflare-hosted inference (Workers AI / AI Gateway):
      1. Workers AI: bind `[ai]`, call `env.AI.run("@cf/meta/llama-3.3-70b-instruct", { messages, stream: true })`. Same-colo execution saves ~100-300ms of network overhead vs api.openai.com. Caveat: model quality is a regression from gpt-5.x; small-model latency wins don't offset that for chat. Worth it only if a smaller open model proves "good enough" on the actual prompts.
4. Understand how CF agents work.
5. Understand the Cloudflare security model.
6. Idempotency and refresh protection.
7. Set up a basic deploy pipeline.
8. Advanced Oauth -
   1. Production hardening:
      1. HTTPS everywhere; `Secure` cookie attribute; `__Host-` prefix for session cookie.
      2. CSRF middleware for non-OAuth POSTs (separate from OAuth `state`).
      3. Rate limiting on `/login` and `/callback`.
      4. Server-side session expiry (idle timeout + absolute timeout); don't rely on the cookie alone.
      5. Session rotation on privilege change (rotate sid after login, after role change).
      6. Distributed session storage (Redis / DB) once there's more than one server process.
      7. Revocation: `/logout`, "log out everywhere", account deletion cascades to sessions.
   2. Token mechanics:
      1. Refresh tokens — long-lived, used to rotate access tokens without re-prompting the user.
      2. Distinguish access token vs id_token vs refresh token (different audiences, lifetimes, storage).
      3. JWT signature verification with JWKS via `jose` (replace the v1 "decode without verify" shortcut).
      4. Token introspection (RFC 7662) vs self-contained JWTs — when to use which.
   3. OpenID Connect details on top of plain OAuth:
      1. `nonce` parameter (defends against a different replay attack than `state`).
      2. Discovery document at `/.well-known/openid-configuration` — auto-config endpoints/JWKS.
      3. UserInfo endpoint — alternative to reading identity from the id_token.
      4. Standard claims: sub, email, name, picture, email_verified, iss, aud, exp, iat.
      5. Logout flows: front-channel, back-channel, RP-initiated logout.
   4. Other OAuth flows (learn when needed):
      1. Client Credentials — machine-to-machine, no user involved.
      2. Device Code — for smart TVs, CLIs, anything without a browser.
      3. Token Exchange (RFC 8693) — proxying identity between services.
      4. Skip: Implicit and Resource Owner Password (both deprecated).
   5. Multi-tenant / multi-IdP:
      1. Namespace routes (`/auth/<provider>/...`) once a second IdP is added.
      2. Account linking — same email from Google + GitHub → one user or two?
      3. IdP-initiated SSO vs SP-initiated.
      4. Just-in-Time provisioning of user records on first login.
      5. SAML for enterprise customers (different protocol, similar problems).
   6. Authorization (the other half — what the user can do, not just who they are):
      1. OAuth scopes vs app-internal permissions.
      2. RBAC / ABAC / ReBAC — pick a model.
      3. Policy engines (OPA, Cedar) when rules get complex.
      4. Per-request authorization vs per-session authorization.
   7. Frontier (ignore until specifically needed):
      1. mTLS-bound tokens (RFC 8705).
      2. DPoP — proof-of-possession tokens (RFC 9449).
      3. FAPI 2.0 — banking-grade OAuth profile.
      4. Verifiable Credentials / DIDs / wallet-based flows.

#### UI
1. Build a basic but chat UI.
2. Figure out md rendering.
3. Build a model picker.

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
   1. Experiment with building and storing workflows.****
   2. You don't. A human in the loop system is a must at this point in time.
   3. Increase the bandwidth b/w the LLMs plans and the engineer making it easier to navigate the codebase and understand the machine's intent. See #2.
   4. For now, it may be prudent to develop tools to enable "gardening".
