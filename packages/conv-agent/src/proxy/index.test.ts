import { describe, expect, test } from "bun:test";
import { createProxyFetchHandler } from "./index";

describe("createProxyFetchHandler", () => {
  test("returns a local health response", async () => {
    const handler = createProxyFetchHandler();

    const response = await handler(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "message-proxy",
    });
  });

  test("returns placeholder metadata for root", async () => {
    const handler = createProxyFetchHandler();

    const response = await handler(new Request("http://localhost/"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: "message-proxy",
      status: "placeholder",
    });
  });
});
