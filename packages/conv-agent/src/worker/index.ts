import { buildWorkerDeps, type WorkerEnv } from "./bootstrap";

export type { WorkerEnv } from "./bootstrap";

const API_BASE_PATH = "/api/v1";
const GENERIC_WORKER_ERROR_MESSAGE = "An unexpected worker error occurred.";

export default {
  // The actual CF worker entry point.
  async fetch(request, env, ctx): Promise<Response> {
    const normalizedRequest = normalizeApiRequest(request);
    let deps: ReturnType<typeof buildWorkerDeps> | undefined;

    try {
      deps = buildWorkerDeps(env);
      return await deps.httpHandler(normalizedRequest);
    } catch (error) {
      console.error("[conv-agent] fetch handler failed", error);
      return new Response(JSON.stringify({ error: { kind: "WorkerBootstrapError", message: GENERIC_WORKER_ERROR_MESSAGE } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    } finally {
      if (deps) {
        ctx.waitUntil(deps.shutdown());
      }
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
