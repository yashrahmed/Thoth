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
});
