import { getPortsConfig } from "@thoth/config";

const port = getPortsConfig().kbCurateAgent;

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "kb-curate-agent" });
    }

    return Response.json({
      name: "kb-curate-agent",
      version: "0.0.1",
      status: "idle",
    });
  },
});

console.log(`Thoth kb-curate-agent running at http://localhost:${server.port}`);

export {};
