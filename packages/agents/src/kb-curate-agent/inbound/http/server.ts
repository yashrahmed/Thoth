import { getPortsConfig } from "@thoth/config";
import { KnowledgeCurationService } from "../../application/knowledge-curation-service";

const service = new KnowledgeCurationService();
const port = getPortsConfig().kbCurateAgent;

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "kb-curate-agent" });
    }

    if (url.pathname === "/run" && req.method === "POST") {
      return Response.json(await service.runOnce(), { status: 202 });
    }

    return Response.json({
      name: "kb-curate-agent",
      version: "2.0.0",
      status: "idle",
    });
  },
});

console.log(`Thoth kb-curate-agent running at http://localhost:${server.port}`);
