import { getProxyConfig } from "@thoth/config";

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
          status: "placeholder",
        }),
      );
    }

    return withCors(Response.json({ error: `Route ${req.method} ${url.pathname} is not supported.` }, { status: 404 }));
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

function parseProfileArg(argv: readonly string[]): string {
  const args = argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--profile") {
      const next = args[index + 1];

      if (typeof next !== "string" || next.length === 0) {
        throw new Error("--profile requires a value.");
      }

      return next;
    }

    if (arg.startsWith("--profile=")) {
      const value = arg.slice("--profile=".length);

      if (value.length === 0) {
        throw new Error("--profile requires a value.");
      }

      return value;
    }
  }

  const positional = args.filter((arg) => !arg.startsWith("--"));

  if (positional.length > 1) {
    throw new Error(`Expected at most one positional profile argument; received ${positional.length}.`);
  }

  const unknownFlag = args.find((arg) => arg.startsWith("--") && !arg.startsWith("--profile"));

  if (unknownFlag !== undefined) {
    throw new Error(`Unknown argument: ${unknownFlag}.`);
  }

  return positional[0] ?? "local";
}

if (import.meta.main) {
  const profile = parseProfileArg(process.argv);
  const handler = createProxyFetchHandler();

  const server = Bun.serve({
    port: getProxyConfig(profile).port,
    fetch: handler,
  });

  console.log(`Thoth message-proxy running at http://localhost:${server.port}`);
}
