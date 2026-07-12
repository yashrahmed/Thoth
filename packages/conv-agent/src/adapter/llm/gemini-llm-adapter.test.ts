import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { LLMMessageType } from "../../domain/objects/llm";
import { GeminiLlmAdapter } from "./gemini-llm-adapter";

describe("GeminiLlmAdapter", () => {
  afterEach(() => {
    mock.restore();
  });

  test("sends the API key in a header instead of the URL", async () => {
    let requestUrl = "";
    let requestHeaders = new Headers();
    const fetchImplementation = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requestUrl = input.toString();
      requestHeaders = new Headers(init?.headers);

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "hello" }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fetchImplementation);

    const result = await new GeminiLlmAdapter({ apiKey: "secret-api-key" }).llmComplete([
      {
        type: LLMMessageType.User,
        content: "Say hello.",
        files: [],
      },
    ]);

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(requestUrl).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent");
    expect(requestUrl).not.toContain("secret-api-key");
    expect(requestUrl).not.toContain("key=");
    expect(requestHeaders.get("x-goog-api-key")).toBe("secret-api-key");
  });

  test("returns one tool-call message per invocation and preserves provider context for the next invocation", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const fetchImplementation = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requestBodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);

      if (requestBodies.length === 1) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: { id: "call-1", name: "get_elapsed_time", args: { before_turn_number: 1, after_turn_number: 2 } },
                      thoughtSignature: "signed-thought",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "The elapsed time was 42 seconds." }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fetchImplementation);
    const adapter = new GeminiLlmAdapter({ apiKey: "secret-api-key" }, [
      {
        name: "get_elapsed_time",
        description: "Get the elapsed time between two messages.",
        inputSchema: {
          type: "object",
          properties: { before_turn_number: { type: "integer" }, after_turn_number: { type: "integer" } },
          required: ["before_turn_number", "after_turn_number"],
          additionalProperties: false,
        },
      },
    ]);
    const initialMessage = { type: LLMMessageType.User, content: "How much time elapsed between the first and second messages?", files: [] } as const;
    const toolCallResult = await adapter.llmComplete([initialMessage]);

    expect(toolCallResult.ok).toBe(true);
    expect(toolCallResult.ok ? toolCallResult.value : null).toMatchObject({
      type: LLMMessageType.Assistant,
      content: "",
      toolCalls: [{ id: "call-1", name: "get_elapsed_time", inputs: { before_turn_number: 1, after_turn_number: 2 } }],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(requestBodies[0]).toMatchObject({
      tools: [
        {
          functionDeclarations: [
            {
              name: "get_elapsed_time",
              parametersJsonSchema: { type: "object", required: ["before_turn_number", "after_turn_number"] },
            },
          ],
        },
      ],
    });

    if (!toolCallResult.ok) {
      throw new Error("Expected a Gemini tool call.");
    }

    const finalResult = await adapter.llmComplete([
      initialMessage,
      toolCallResult.value,
      {
        type: LLMMessageType.Tool,
        content: JSON.stringify({ status: "ok", elapsedSeconds: 42 }),
        toolCallId: "call-1",
        toolName: "get_elapsed_time",
      },
    ]);

    expect(finalResult).toEqual({ ok: true, value: { type: LLMMessageType.Assistant, content: "The elapsed time was 42 seconds." } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(requestBodies[1]).toMatchObject({
      contents: [
        { role: "user", parts: [{ text: "How much time elapsed between the first and second messages?" }] },
        {
          role: "model",
          parts: [
            {
              functionCall: { id: "call-1", name: "get_elapsed_time" },
              thoughtSignature: "signed-thought",
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "call-1",
                name: "get_elapsed_time",
                response: { status: "ok", elapsedSeconds: 42 },
              },
            },
          ],
        },
      ],
    });
  });
});
