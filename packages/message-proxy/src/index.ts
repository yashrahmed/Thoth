import { getPortsConfig } from "@thoth/config";

const port = getPortsConfig().proxy;

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "message-proxy" });
    }

    return Response.json({ name: "thoth", version: "0.0.1" });
  },
});

console.log(`Thoth message proxy running at http://localhost:${server.port}`);
