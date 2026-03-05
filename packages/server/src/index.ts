import type { Message } from "@thoth/shared";

const server = Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    return Response.json({ name: "thoth", version: "0.0.1" });
  },
});

console.log(`Thoth server running at http://localhost:${server.port}`);
