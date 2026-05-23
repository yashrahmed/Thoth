import { buildWorkerDeps, type WorkerEnv } from "./bootstrap";

export type { WorkerEnv } from "./bootstrap";

const ALLOWED_CORS_METHODS = "GET,POST,PATCH,DELETE,OPTIONS";
const ALLOWED_CORS_HEADERS = "content-type";
const API_BASE_PATH = "/api/v1";

export default {
  // The actual CF worker entry point.
  async fetch(request, env, ctx): Promise<Response> {
    const normalizedRequest = normalizeApiRequest(request);

    if (normalizedRequest.method === "OPTIONS" && shouldApplyCors(normalizedRequest)) {
      return new Response(null, { status: 204, headers: buildCorsHeaders(normalizedRequest) });
    }

    const deps = buildWorkerDeps(env);

    try {
      const response = await deps.httpHandler(normalizedRequest);
      return withCorsHeaders(normalizedRequest, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected conv-agent worker error.";
      console.error("[conv-agent] fetch handler failed", error);
      const response = new Response(JSON.stringify({ error: { kind: "WorkerBootstrapError", message } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });

      return withCorsHeaders(normalizedRequest, response);
    } finally {
      ctx.waitUntil(deps.shutdown());
    }
  },
} satisfies ExportedHandler<WorkerEnv>;

function normalizeApiRequest(request: Request): Request {
  const url = new URL(request.url);

  if (url.pathname === API_BASE_PATH) {
    url.pathname = "/";
  } else if (url.pathname.startsWith(`${API_BASE_PATH}/`)) {
    url.pathname = url.pathname.slice(API_BASE_PATH.length);
  }

  if (url.href === request.url) {
    return request;
  }

  return new Request(url, request);
}

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
