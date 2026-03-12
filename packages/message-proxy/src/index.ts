import { getPortsConfig } from "@thoth/config";

const DEFAULT_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function createProxyFetchHandler() {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: DEFAULT_HEADERS,
      });
    }

    if (url.pathname === "/health") {
      return withCors(Response.json({ status: "ok", service: "message-proxy" }));
    }

    if (url.pathname === "/") {
      return withCors(
        Response.json({
          name: "message-proxy",
          version: "2.0.0",
        }),
      );
    }

    return withCors(
      Response.json(
        { error: `Route ${req.method} ${url.pathname} is not supported.` },
        { status: 404 },
      ),
    );
  };
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(DEFAULT_HEADERS)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

if (import.meta.main) {
  const ports = getPortsConfig();
  const handler = createProxyFetchHandler();

  const server = Bun.serve({
    port: ports.proxy,
    fetch: handler,
  });

  console.log(`Thoth message-proxy running at http://localhost:${server.port}`);
}
