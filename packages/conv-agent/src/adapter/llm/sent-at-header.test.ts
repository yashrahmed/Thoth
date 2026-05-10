import { expect, test } from "bun:test";
import { LLMMessageType } from "../../domain/objects/llm";
import { formatSentAtHeader, withSentAtHeader } from "./sent-at-header";

const createdAt = new Date("2026-05-10T14:30:22.987Z");

test("formats the sent-at header in UTC with second precision", () => {
  expect(formatSentAtHeader(createdAt)).toBe("sent at 2026-05-10 14:30:22 +00:00 UTC");
});

test("prepends the header before user message content", () => {
  const text = withSentAtHeader({
    type: LLMMessageType.User,
    content: "Hello there",
    createdAt,
  });

  expect(text).toBe("sent at 2026-05-10 14:30:22 +00:00 UTC\n\nHello there");
});

test("prepends the header before assistant message content", () => {
  const text = withSentAtHeader({
    type: LLMMessageType.Assistant,
    content: "Hi back",
    createdAt,
  });

  expect(text).toBe("sent at 2026-05-10 14:30:22 +00:00 UTC\n\nHi back");
});

test("does not modify system message content", () => {
  const text = withSentAtHeader({
    type: LLMMessageType.System,
    content: "you are a helpful assistant",
    createdAt,
  });

  expect(text).toBe("you are a helpful assistant");
});

test("does not modify tool message content", () => {
  const text = withSentAtHeader({
    type: LLMMessageType.Tool,
    content: "tool output",
    createdAt,
  });

  expect(text).toBe("tool output");
});
