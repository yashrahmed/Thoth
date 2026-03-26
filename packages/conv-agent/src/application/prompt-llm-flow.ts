import { LLMMessageType } from "../domain/objects/llm";
import { failure, success, type Result } from "../domain/objects/result";
import { LlmError, ValidationError } from "../domain/objects/errors";
import { LlmDomainService } from "../domain/services/llm-domain-service";

interface PromptLlmRequest {
  readonly prompt: string;
}

export class PromptLlmFlow {
  constructor(
    private readonly llmDomainService: LlmDomainService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(request: PromptLlmRequest): Promise<Result<string, ValidationError | LlmError>> {
    const prompt = request.prompt.trim();

    if (prompt.length === 0) {
      return failure(new ValidationError("prompt", "prompt must be a non-empty string."));
    }

    const timestamp = this.now();
    const llmResult = await this.llmDomainService.complete([
      {
        id: crypto.randomUUID(),
        conversationId: crypto.randomUUID(),
        type: LLMMessageType.User,
        sequenceNumber: 1,
        content: prompt,
        fileIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);

    if (!llmResult.ok) {
      return llmResult;
    }

    const responseText = llmResult.value.content.trim();

    if (responseText.length === 0) {
      return failure(new LlmError("LLM response did not contain any text content."));
    }

    return success(responseText);
  }
}
