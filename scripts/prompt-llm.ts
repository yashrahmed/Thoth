import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenAiLlmCompletionService } from "../packages/conv-agent/src/adapter/llm/openai-llm-completion-service";
import { PromptLlmFlow } from "../packages/conv-agent/src/application/prompt-llm-flow";
import { LlmDomainService } from "../packages/conv-agent/src/domain/services/llm-domain-service";

const LLM_CREDS_PATH = resolve(import.meta.dir, "../config/llm-creds.yaml");

async function main() {
  const prompt = Bun.argv.slice(2).join(" ").trim();

  if (prompt.length === 0) {
    printError("Usage: bun scripts/prompt-llm.ts <prompt>");
  }

  const apiKey = readOpenAiApiKey() ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    printError(`Missing OpenAI credentials. Set OPENAI_API_KEY or create ${LLM_CREDS_PATH}.`);
  }

  const flow = new PromptLlmFlow(
    new LlmDomainService(
      createOpenAiLlmCompletionService({
        apiKey,
      }),
    ),
  );
  const result = await flow.execute({ prompt });

  if (!result.ok) {
    printError(result.error.message);
  }

  console.log(result.value);
}

function readOpenAiApiKey(): string | undefined {
  if (!existsSync(LLM_CREDS_PATH)) {
    return undefined;
  }

  const fileContents = readFileSync(LLM_CREDS_PATH, "utf8");
  const match = fileContents.match(/^\s*OPENAI_API_KEY\s*:\s*(?:"([^"]*)"|'([^']*)'|([^#\n]+?))\s*(?:#.*)?$/m);
  const apiKey = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();

  return apiKey.length > 0 ? apiKey : undefined;
}

function printError(message: string): never {
  console.error(message);
  process.exit(1);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected LLM prompt failure.";

  printError(message);
});
