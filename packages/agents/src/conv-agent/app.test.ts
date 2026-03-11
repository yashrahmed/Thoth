import { describe, expect, it } from "bun:test";
import { createConvAgentFetchHandler } from "./app";

describe("createConvAgentFetchHandler", () => {
  it("routes POST /test/responses to the test response controller", async () => {
    const handler = createConvAgentFetchHandler(
      {} as never,
      {} as never,
      {
        async create() {
          return Response.json({
            message: {
              role: "assistant",
              text: "From handler.",
            },
          });
        },
      } as never,
    );

    const response = await handler(
      new Request("http://localhost/test/responses", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: {
        role: "assistant",
        text: "From handler.",
      },
    });
  });

  it("rejects unsupported methods on /test/responses", async () => {
    const handler = createConvAgentFetchHandler(
      {} as never,
      {} as never,
      {} as never,
    );

    const response = await handler(
      new Request("http://localhost/test/responses", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      error: "Method GET is not supported on /test/responses.",
    });
  });
});
