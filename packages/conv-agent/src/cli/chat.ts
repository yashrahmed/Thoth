import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { OpenAiLlmAdapter } from "../adapter/llm/openai-llm-adapter";
import { LLMMessageType, type LlmCompletionMessage } from "../domain/objects/llm";
import { Message, type MessageWithFiles } from "../domain/objects/message-types";

const CONVERSATION_ID = "cli-chat";

type ChatCommand = "continue" | "exit";

async function main(): Promise<void> {
  const apiKey = process.env.LLM_API_KEY;

  if (typeof apiKey !== "string" || apiKey.length === 0) {
    console.error("LLM_API_KEY is required.");
    process.exitCode = 1;
    return;
  }

  const adapter = new OpenAiLlmAdapter({ apiKey });
  const transcript = createInitialTranscript();

  if (input.isTTY === false) {
    await runBatch(adapter, transcript, await Bun.stdin.text());
    return;
  }

  await runInteractive(adapter, transcript);
}

async function runInteractive(adapter: OpenAiLlmAdapter, transcript: MessageWithFiles[]): Promise<void> {
  const rl = createInterface({ input, output });

  process.on("SIGINT", () => {
    output.write("\n");
    rl.close();
  });

  output.write("Chat started. Type /exit to quit or /reset to clear context.\n\n");

  try {
    while (true) {
      const content = (await rl.question("you> ")).trim();
      const command = handleCommand(content, transcript);

      if (command === "exit") {
        break;
      }

      if (command === "continue") {
        continue;
      }

      await runTurn(adapter, transcript, content);
    }
  } finally {
    rl.close();
  }
}

async function runBatch(adapter: OpenAiLlmAdapter, transcript: MessageWithFiles[], inputText: string): Promise<void> {
  for (const rawLine of inputText.split(/\r?\n/u)) {
    const content = rawLine.trim();
    const command = handleCommand(content, transcript);

    if (command === "exit") {
      return;
    }

    if (command === "continue") {
      continue;
    }

    await runTurn(adapter, transcript, content);
  }
}

async function runTurn(adapter: OpenAiLlmAdapter, transcript: MessageWithFiles[], content: string): Promise<void> {
  transcript.push(createMessage(LLMMessageType.User, content, transcript.length + 1));

  const result = await adapter.llmComplete(transcript);

  if (!result.ok) {
    output.write(`error> ${result.error.message}\n`);
    return;
  }

  if (result.value.messages.length === 0) {
    output.write("bot> \n");
    return;
  }

  for (const message of result.value.messages) {
    transcript.push(createMessage(message.type, message.content, transcript.length + 1));
    output.write(`${formatPrompt(message)}> ${message.content}\n`);
  }
}

function handleCommand(content: string, transcript: MessageWithFiles[]): ChatCommand | undefined {
  if (content.length === 0) {
    return "continue";
  }

  if (content === "/exit" || content === "/quit") {
    return "exit";
  }

  if (content === "/reset") {
    resetTranscript(transcript);
    output.write("Context cleared.\n");
    return "continue";
  }

  return undefined;
}

function createInitialTranscript(): MessageWithFiles[] {
  return [
    createMessage(
      LLMMessageType.System,
      "You are Thoth's CLI chat bot.",
      1,
    ),
  ];
}

function resetTranscript(transcript: MessageWithFiles[]): void {
  transcript.length = 0;
  transcript.push(...createInitialTranscript());
}

function createMessage(type: LLMMessageType, content: string, sequenceNumber: number): MessageWithFiles {
  const timestamp = new Date();
  return {
    ...new Message(`cli-message-${sequenceNumber}`, CONVERSATION_ID, type, sequenceNumber, content, timestamp, timestamp),
    files: [],
  };
}

function formatPrompt(message: LlmCompletionMessage): string {
  return message.type === LLMMessageType.Tool ? "tool" : "bot";
}

await main();
