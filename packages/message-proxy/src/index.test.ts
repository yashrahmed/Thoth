import { describe, expect, mock, test } from "bun:test";
import { createProxyFetchHandler } from "./index";

describe("createProxyFetchHandler", () => {
  test("returns a local health response", async () => {
    const fetchMock = mock(async () => Response.json({ forwarded: true }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const handler = createProxyFetchHandler({
      conversationsBaseUrl: "http://127.0.0.1:3001",
    });

    const response = await handler(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("forwards conversation requests to the conversations service", async () => {
    const fetchMock = mock(async (request: RequestInfo | URL) => {
      const forwardedUrl =
        typeof request === "string"
          ? request
          : request instanceof Request
            ? request.url
            : request.toString();

      expect(forwardedUrl).toBe("http://127.0.0.1:3001/conversations");

      return Response.json({ forwarded: true });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const handler = createProxyFetchHandler({
      conversationsBaseUrl: "http://127.0.0.1:3001",
    });

    const response = await handler(new Request("http://localhost/conversations"));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
