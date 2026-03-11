import { describe, expect, it } from "bun:test";
import type {
  GenerateResponseInput,
  GenerateResponseOutput,
  LlmServicePort,
} from "@thoth/contracts";
import { GenerateResponseService } from "./generate-response-service";

describe("GenerateResponseService", () => {
  it("delegates to the llm service and returns its response", async () => {
    const input: GenerateResponseInput = {
      messages: [
        { role: "system", text: "Be concise." },
        { role: "user", text: "Say hello." },
      ],
    };
    const expected: GenerateResponseOutput = {
      message: {
        role: "assistant",
        text: "Hello.",
      },
    };
    const calls: GenerateResponseInput[] = [];
    const llmService: LlmServicePort = {
      async generateResponse(nextInput) {
        calls.push(nextInput);
        return expected;
      },
    };

    const service = new GenerateResponseService(llmService);

    const actual = await service.execute(input);

    expect(calls).toEqual([input]);
    expect(actual).toEqual(expected);
  });
});
