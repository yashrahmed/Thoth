import { describe, expect, test } from "bun:test";

import { LlmError } from "../objects/errors";
import { LLMMessageType } from "../objects/llm";
import { Message } from "../objects/message-types";
import { TimingToolsService } from "./timing-tools-service";

const CONVERSATION_ID = "conversation-1";
const NOW = new Date("2026-07-11T13:02:05.000Z");
const MESSAGES = [
  message("persisted-id-101", LLMMessageType.User, "First turn", "2026-07-11T12:00:00.000Z"),
  message("persisted-id-205", LLMMessageType.Assistant, "Second turn", "2026-07-11T12:01:05.000Z"),
  message("persisted-id-309", LLMMessageType.User, "Third turn", "2026-07-11T12:30:00.000Z"),
];

describe("TimingToolsService", () => {
  test("describes static tools with 1-based integer turn numbers", () => {
    const definitions = createService().get_description();

    expect(definitions.map((definition) => definition.name)).toEqual(["get_current_time", "get_elapsed_time"]);
    expect(definitions.find((definition) => definition.name === "get_elapsed_time")?.inputSchema).toMatchObject({
      properties: {
        before_turn_number: { type: "integer", minimum: 1 },
        after_turn_number: { type: "integer", minimum: 1 },
      },
      required: ["before_turn_number", "after_turn_number"],
    });
    expect(JSON.stringify(definitions)).not.toContain("persisted-id");
  });

  test("returns the authoritative current time", async () => {
    const result = await runTool("get_current_time", {});

    expect(result).toEqual({
      status: "ok",
      utc: NOW.toISOString(),
      timezone: "UTC",
      local: "2026-07-11T13:02:05+00:00",
    });
  });

  test("calculates elapsed time from the injected message context", async () => {
    const result = await runTool("get_elapsed_time", {
      before_turn_number: 1,
      after_turn_number: 2,
    });

    expect(result).toEqual({
      status: "ok",
      beforeTurnNumber: 1,
      afterTurnNumber: 2,
      beforeTimestamp: "2026-07-11T12:00:00.000Z",
      afterTimestamp: "2026-07-11T12:01:05.000Z",
      elapsedSeconds: 65,
      description: "1 minute and 5 seconds",
    });
  });

  test("rejects turn numbers outside the supplied message context", async () => {
    const result = await runTool("get_elapsed_time", {
      before_turn_number: 1,
      after_turn_number: 4,
    });

    expect(result).toEqual({
      status: "invalid_turn_number",
      message: "Both turn numbers must identify messages supplied to the current completion.",
      availableTurnCount: 3,
    });
  });

  test("throws an LLM failure when a tool cannot be resolved", async () => {
    expect(createService().run_tool("unknown_tool", {}, MESSAGES)).rejects.toEqual(new LlmError("Timing tool cannot be resolved: unknown_tool."));
  });
});

async function runTool(name: string, inputs: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
  return JSON.parse(await createService().run_tool(name, inputs, MESSAGES)) as Record<string, unknown>;
}

function createService(): TimingToolsService {
  return new TimingToolsService(() => NOW);
}

function message(id: string, type: LLMMessageType, content: string, createdAt: string): Message {
  const timestamp = new Date(createdAt);
  return new Message(id, CONVERSATION_ID, type, content, timestamp, timestamp);
}
