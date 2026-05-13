import { buildWorkerDeps, type WorkerEnv } from "./bootstrap";

export type { WorkerEnv } from "./bootstrap";

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const deps = buildWorkerDeps(env);

    try {
      return await deps.httpHandler(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected conv-agent worker error.";
      console.error("[conv-agent] fetch handler failed", error);
      return new Response(JSON.stringify({ error: { kind: "WorkerBootstrapError", message } }), {
        status: 500,
        headers: { "content-type": "application/json", ...CORS_HEADERS },
      });
    } finally {
      ctx.waitUntil(deps.shutdown());
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
