import { buildWorkerDeps, type WorkerEnv } from "./bootstrap";
import type { SessionStore } from "../config/config";

export type { WorkerEnv } from "./bootstrap";

const sessions: SessionStore = new Map();

export default {
  async fetch(request, env): Promise<Response> {
    const deps = buildWorkerDeps(env, sessions);

    try {
      return await deps.httpHandler(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected proxy-server error.";
      console.error("[proxy-server] fetch handler failed", error);

      return Response.json(
        {
          error: {
            kind: "ProxyServerError",
            message,
          },
        },
        { status: 500 },
      );
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
