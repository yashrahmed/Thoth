import { describe, expect, mock, test } from "bun:test";
import { createProxyFetchHandler } from "./index";

describe("createProxyFetchHandler", () => {
  test("returns a local health response", async () => {
    const fetchMock = mock(async () => Response.json({ forwarded: true }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const handler = createProxyFetchHandler();

    const response = await handler(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not proxy conversation routes", async () => {
    const fetchMock = mock(async () => Response.json({ forwarded: true }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const handler = createProxyFetchHandler();

    const response = await handler(new Request("http://localhost/conversations"));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
