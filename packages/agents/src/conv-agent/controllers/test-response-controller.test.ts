import { describe, expect, it } from "bun:test";
import type {
  GenerateResponseInput,
  GenerateResponseOutput,
} from "@thoth/contracts";
import { TestResponseController } from "./test-response-controller";

describe("TestResponseController", () => {
  it("returns the generated assistant message", async () => {
    const calls: GenerateResponseInput[] = [];
    const controller = new TestResponseController({
      async execute(input): Promise<GenerateResponseOutput> {
        calls.push(input);
        return {
          message: {
            role: "assistant",
            text: "Hello there.",
          },
        };
      },
    });

    const response = await controller.create(
      new Request("http://localhost/test/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", text: "Say hello." }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        messages: [{ role: "user", text: "Say hello." }],
      },
    ]);
    expect(await response.json()).toEqual({
      message: {
        role: "assistant",
        text: "Hello there.",
      },
    });
  });

  it("rejects invalid payloads", async () => {
    const controller = new TestResponseController({
      async execute(): Promise<GenerateResponseOutput> {
        throw new Error("should not be called");
      },
    });

    const response = await controller.create(
      new Request("http://localhost/test/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", text: "", conversation_id: "123" }],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "messages[0].conversation_id is not allowed.",
    });
  });
});
