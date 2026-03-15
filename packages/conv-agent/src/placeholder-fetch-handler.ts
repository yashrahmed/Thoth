const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "content-type",
};

export interface PlaceholderFetchHandlerOptions {
  cors?: boolean;
}

export function createPlaceholderFetchHandler(
  service: string,
  options: PlaceholderFetchHandlerOptions = {},
): (req: Request) => Response {
  return (req: Request): Response => {
    const url = new URL(req.url);

    if (options.cors && req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return withCors(
        Response.json({
          status: "ok",
          service,
        }),
        options,
      );
    }

    if (req.method === "GET" && url.pathname === "/") {
      return withCors(
        Response.json({
          name: service,
          status: "placeholder",
        }),
        options,
      );
    }

    return withCors(
      Response.json(
        { error: `Route ${req.method} ${url.pathname} is not supported.` },
        { status: 404 },
      ),
      options,
    );
  };
}

function withCors(
  response: Response,
  options: PlaceholderFetchHandlerOptions,
): Response {
  if (!options.cors) {
    return response;
  }

  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
