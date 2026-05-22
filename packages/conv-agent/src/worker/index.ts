import { buildWorkerDeps, type WorkerEnv } from "./bootstrap";

export type { WorkerEnv } from "./bootstrap";

const ALLOWED_CORS_METHODS = "GET,POST,PATCH,DELETE,OPTIONS";
const ALLOWED_CORS_HEADERS = "content-type";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (request.method === "OPTIONS" && shouldApplyCors(request)) {
      return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
    }

    const deps = buildWorkerDeps(env);

    try {
      const response = await deps.httpHandler(request);
      return withCorsHeaders(request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected conv-agent worker error.";
      console.error("[conv-agent] fetch handler failed", error);
      const response = new Response(JSON.stringify({ error: { kind: "WorkerBootstrapError", message } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });

      return withCorsHeaders(request, response);
    } finally {
      ctx.waitUntil(deps.shutdown());
    }
  },
} satisfies ExportedHandler<WorkerEnv>;

function withCorsHeaders(request: Request, response: Response): Response {
  if (!shouldApplyCors(request)) {
    return response;
  }

  const headers = new Headers(response.headers);

  for (const [name, value] of buildCorsHeaders(request)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function shouldApplyCors(request: Request): boolean {
  const url = new URL(request.url);
  return !url.pathname.startsWith("/auth/");
}

function buildCorsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get("origin");

  if (!origin) {
    return headers;
  }

  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-allow-methods", ALLOWED_CORS_METHODS);
  headers.set("access-control-allow-headers", ALLOWED_CORS_HEADERS);
  headers.set("vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");

  return headers;
}
