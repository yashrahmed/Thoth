import type {
  GenerateResponseInput,
  GenerateResponseOutput,
  LlmPromptMessage,
} from "@thoth/contracts";

interface GenerateResponseUseCase {
  execute(input: GenerateResponseInput): Promise<GenerateResponseOutput>;
}

const MESSAGE_ROLES = ["assistant", "developer", "system", "user"] as const;
const ALLOWED_MESSAGE_FIELDS = new Set(["role", "text"]);

class RequestValidationError extends Error {}

export class TestResponseController {
  constructor(private readonly generateResponse: GenerateResponseUseCase) {}

  async create(req: Request): Promise<Response> {
    let input: GenerateResponseInput;

    try {
      input = await this.parseRequestBody(req);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }

      throw error;
    }

    const output = await this.generateResponse.execute(input);

    return Response.json(output);
  }

  private async parseRequestBody(req: Request): Promise<GenerateResponseInput> {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      throw new RequestValidationError("Request body must be valid JSON.");
    }

    if (!this.isObject(body)) {
      throw new RequestValidationError("Request body must be a JSON object.");
    }

    const { messages } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new RequestValidationError(
        "messages must be a non-empty array of prompt messages.",
      );
    }

    return {
      messages: messages.map((message, index) =>
        this.parsePromptMessage(message, index),
      ),
    };
  }

  private parsePromptMessage(
    value: unknown,
    index: number,
  ): LlmPromptMessage {
    const fieldPrefix = `messages[${index}]`;

    if (!this.isObject(value)) {
      throw new RequestValidationError(`${fieldPrefix} must be a JSON object.`);
    }

    for (const field of Object.keys(value)) {
      if (!ALLOWED_MESSAGE_FIELDS.has(field)) {
        throw new RequestValidationError(
          `${fieldPrefix}.${field} is not allowed.`,
        );
      }
    }

    if (!this.isMessageRole(value.role)) {
      throw new RequestValidationError(
        `${fieldPrefix}.role must be one of assistant, developer, system, or user.`,
      );
    }

    if (typeof value.text !== "string" || value.text.trim().length === 0) {
      throw new RequestValidationError(
        `${fieldPrefix}.text must be a non-empty string.`,
      );
    }

    return {
      role: value.role,
      text: value.text,
    };
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private isMessageRole(value: unknown): value is LlmPromptMessage["role"] {
    return (
      typeof value === "string" &&
      MESSAGE_ROLES.includes(value as (typeof MESSAGE_ROLES)[number])
    );
  }
}
