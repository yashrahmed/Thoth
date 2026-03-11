import { afterEach, describe, expect, it } from "bun:test";
import type { GenerateResponseInput } from "@thoth/contracts";
import {
  OpenAiLlmService,
  mapPromptMessages,
} from "./openai-llm-service";

describe("mapPromptMessages", () => {
  it("maps llm prompt messages to provider messages", () => {
    expect(
      mapPromptMessages([
        { role: "system", text: "Be brief." },
        { role: "developer", text: "Follow house style." },
        { role: "user", text: "Hi" },
      ]),
    ).toEqual([
      { role: "system", content: "Be brief." },
      { role: "system", content: "Follow house style." },
      { role: "user", content: "Hi" },
    ]);
  });
});

describe("OpenAiLlmService", () => {
  const originalConfigFile = process.env.CONFIG_FILE;

  afterEach(() => {
    process.env.CONFIG_FILE = originalConfigFile;
  });

  it("passes the configured model and mapped messages to generateText", async () => {
    process.env.CONFIG_FILE = "config/launch.yaml";

    const input: GenerateResponseInput = {
      messages: [
        { role: "developer", text: "Prefer bullets." },
        { role: "user", text: "Summarize this." },
      ],
    };
    const modelCalls: string[] = [];
    const generateCalls: unknown[] = [];
    const modelFactory = ((modelId: string) => {
      modelCalls.push(modelId);
      return { modelId } as never;
    }) as never;
    const generateTextFn = (async (payload: unknown) => {
      generateCalls.push(payload);
      return { text: "Short summary." };
    }) as never;

    const service = new OpenAiLlmService(modelFactory, generateTextFn);

    const actual = await service.generateResponse(input);

    expect(modelCalls).toEqual(["gpt-4o-mini"]);
    expect(generateCalls).toEqual([
      {
        model: { modelId: "gpt-4o-mini" },
        messages: [
          { role: "system", content: "Prefer bullets." },
          { role: "user", content: "Summarize this." },
        ],
      },
    ]);
    expect(actual).toEqual({
      message: {
        role: "assistant",
        text: "Short summary.",
      },
    });
  });

  it("rejects empty provider text responses", async () => {
    process.env.CONFIG_FILE = "config/launch.yaml";

    const service = new OpenAiLlmService(
      ((_: string) => ({}) as never) as never,
      (async () => ({ text: "   " })) as never,
    );

    await expect(
      service.generateResponse({
        messages: [{ role: "user", text: "Hello" }],
      }),
    ).rejects.toThrow("LLM provider returned an empty text response.");
  });
});
