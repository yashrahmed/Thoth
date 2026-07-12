import { LlmError } from "../objects/errors";
import type { LlmToolDefinition } from "../objects/llm";
import type { Message } from "../objects/message-types";

const TOOL_DEFINITIONS: ReadonlyArray<LlmToolDefinition> = [
  {
    name: "get_current_time",
    description: "Get the authoritative current date and time. Use this instead of guessing the current time.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_elapsed_time",
    description:
      "Calculate elapsed time between two conversation turns. Turn numbers are 1-based positions in the messages supplied to the current completion: turn 1 is the first message, turn 2 is the second message, and so on.",
    inputSchema: {
      type: "object",
      properties: {
        before_turn_number: {
          type: "integer",
          minimum: 1,
          description: "The 1-based position of the earlier turn in the supplied conversation messages.",
        },
        after_turn_number: {
          type: "integer",
          minimum: 1,
          description: "The 1-based position of the later turn in the supplied conversation messages.",
        },
      },
      required: ["before_turn_number", "after_turn_number"],
      additionalProperties: false,
    },
  },
];

export class TimingToolsService {
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly timezone = "UTC",
  ) {}

  get_description(): ReadonlyArray<LlmToolDefinition> {
    return TOOL_DEFINITIONS;
  }

  async run_tool(toolName: string, inputs: Readonly<Record<string, unknown>>, messageContext: ReadonlyArray<Message>): Promise<string> {
    if (toolName === "get_current_time") {
      return JSON.stringify(this.currentTimeResult());
    }

    if (toolName === "get_elapsed_time") {
      return JSON.stringify(elapsedTimeResult(messageContext, inputs));
    }

    throw new LlmError(`Timing tool cannot be resolved: ${toolName}.`);
  }

  private currentTimeResult(): Readonly<Record<string, unknown>> {
    const now = this.now();

    return {
      status: "ok",
      utc: now.toISOString(),
      timezone: this.timezone,
      local: formatInTimezone(now, this.timezone),
    };
  }
}

function elapsedTimeResult(messages: ReadonlyArray<Message>, args: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const beforeTurnNumber = args.before_turn_number;
  const afterTurnNumber = args.after_turn_number;

  if (!isTurnNumber(beforeTurnNumber) || !isTurnNumber(afterTurnNumber)) {
    return {
      status: "invalid_arguments",
      message: "before_turn_number and after_turn_number must both be positive integers.",
      availableTurnCount: messages.length,
    };
  }

  const beforeMessage = messages[beforeTurnNumber - 1];
  const afterMessage = messages[afterTurnNumber - 1];

  if (!beforeMessage || !afterMessage) {
    return {
      status: "invalid_turn_number",
      message: "Both turn numbers must identify messages supplied to the current completion.",
      availableTurnCount: messages.length,
    };
  }

  const seconds = Math.trunc((afterMessage.createdAt.getTime() - beforeMessage.createdAt.getTime()) / 1_000);

  return {
    status: "ok",
    beforeTurnNumber,
    afterTurnNumber,
    beforeTimestamp: beforeMessage.createdAt.toISOString(),
    afterTimestamp: afterMessage.createdAt.toISOString(),
    elapsedSeconds: seconds,
    description: formatDuration(seconds),
  };
}

function isTurnNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function formatDuration(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  let remaining = Math.abs(seconds);
  const includeDays = remaining >= 86_400;
  const days = includeDays ? Math.floor(remaining / 86_400) : 0;
  if (includeDays) {
    remaining %= 86_400;
  }
  const hours = Math.floor(remaining / 3_600);
  remaining %= 3_600;
  const minutes = Math.floor(remaining / 60);
  const finalSeconds = remaining % 60;
  const parts = [
    days > 0 ? formatDurationUnit(days, "day") : "",
    hours > 0 ? formatDurationUnit(hours, "hour") : "",
    minutes > 0 ? formatDurationUnit(minutes, "minute") : "",
    formatDurationUnit(finalSeconds, "second"),
  ].filter((part) => part.length > 0);

  if (parts.length === 1) {
    return `${sign}${parts[0]}`;
  }

  if (parts.length === 2) {
    return `${sign}${parts[0]} and ${parts[1]}`;
  }

  return `${sign}${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function formatDurationUnit(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

function formatInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const offsetName = values.get("timeZoneName") ?? "GMT";
  const offset = offsetName === "GMT" ? "+00:00" : offsetName.replace("GMT", "");

  return `${values.get("year")}-${values.get("month")}-${values.get("day")}T${values.get("hour")}:${values.get("minute")}:${values.get("second")}${offset}`;
}
