import { getPortsConfig } from "@thoth/config";

const port = getPortsConfig().planningAgent;

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "planning-agent" });
    }

    return Response.json({
      name: "planning-agent",
      version: "0.0.1",
      status: "idle",
    });
  },
});

console.log(`Thoth planning-agent running at http://localhost:${server.port}`);

export {};
