const DEFAULT_KB_CURATE_AGENT_PORT = 3002;

const port = Number(
  process.env.KB_CURATE_AGENT_PORT ?? DEFAULT_KB_CURATE_AGENT_PORT,
);

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
