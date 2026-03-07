import type {
  CreateMessageQuery,
  DeleteMessageQuery,
  MessageQuery,
  UpdateMessageQuery,
} from "@thoth/contracts";
import type { Message, MessageType } from "@thoth/entities";

const MESSAGE_TYPES: MessageType[] = [
  "assistant",
  "developer",
  "system",
  "user",
];

interface MessageBody {
  id: string;
  conversation_id: string;
  type: MessageType;
  text_content: string | null;
  media_content: string | null;
  last_create_ts: string;
  last_update_ts: string;
}

class RequestValidationError extends Error {}

export class MessageController {
  constructor(private readonly messageRepository: MessageQuery) {}

  async insert(req: Request): Promise<Response> {
    let query: CreateMessageQuery | UpdateMessageQuery;

    try {
      query = await this.parseMutationQuery(req);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }

      throw error;
    }

    const message = await this.messageRepository.createMessage(query);

    return Response.json(this.serializeMessage(message), { status: 201 });
  }

  async update(req: Request): Promise<Response> {
    let query: CreateMessageQuery | UpdateMessageQuery;

    try {
      query = await this.parseMutationQuery(req);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }

      throw error;
    }

    const message = await this.messageRepository.updateMessage(query);

    return Response.json(this.serializeMessage(message));
  }

  async delete(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const messageId = url.searchParams.get("messageId");
    const conversationId = url.searchParams.get("conversation_id");

    if (!messageId || !conversationId) {
      return Response.json(
        {
          error:
            "messageId and conversation_id query parameters are required.",
        },
        { status: 400 },
      );
    }

    const query: DeleteMessageQuery = {
      conversation_id: conversationId,
      messageId,
    };

    await this.messageRepository.deleteMessage(query);

    return new Response(null, { status: 204 });
  }

  async showAll(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversation_id");

    if (!conversationId) {
      return Response.json(
        { error: "conversation_id query parameter is required." },
        { status: 400 },
      );
    }

    const messages =
      await this.messageRepository.listMessagesByConversationId(
        conversationId,
      );

    return Response.json(
      messages.map((message) => this.serializeMessage(message)),
    );
  }

  private async parseMutationQuery(
    req: Request,
  ): Promise<CreateMessageQuery | UpdateMessageQuery> {
    const body = await this.parseRequestBody(req);

    return {
      message: this.parseMessage(body.message),
    };
  }

  private async parseRequestBody(
    req: Request,
  ): Promise<{ message: MessageBody }> {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      throw new RequestValidationError("Request body must be valid JSON.");
    }

    if (!this.isObject(body)) {
      throw new RequestValidationError("Request body must be a JSON object.");
    }

    if (!("message" in body)) {
      throw new RequestValidationError("Request body must include message.");
    }

    return body as { message: MessageBody };
  }

  private parseMessage(message: MessageBody): Message {
    if (!this.isObject(message)) {
      throw new RequestValidationError("message must be a JSON object.");
    }

    if (!this.isNonEmptyString(message.id)) {
      throw new RequestValidationError("message.id must be a non-empty string.");
    }

    if (!this.isNonEmptyString(message.conversation_id)) {
      throw new RequestValidationError(
        "message.conversation_id must be a non-empty string.",
      );
    }

    if (!MESSAGE_TYPES.includes(message.type)) {
      throw new RequestValidationError(
        "message.type must be one of assistant, developer, system, or user.",
      );
    }

    if (
      message.text_content !== null &&
      typeof message.text_content !== "string"
    ) {
      throw new RequestValidationError(
        "message.text_content must be a string or null.",
      );
    }

    if (
      message.media_content !== null &&
      typeof message.media_content !== "string"
    ) {
      throw new RequestValidationError(
        "message.media_content must be a string or null.",
      );
    }

    const lastCreateTs = this.parseDate(
      message.last_create_ts,
      "message.last_create_ts",
    );
    const lastUpdateTs = this.parseDate(
      message.last_update_ts,
      "message.last_update_ts",
    );

    return {
      ...message,
      media_content: this.parseUrl(
        message.media_content,
        "message.media_content",
      ),
      last_create_ts: lastCreateTs,
      last_update_ts: lastUpdateTs,
    };
  }

  private serializeMessage(message: Message) {
    return {
      ...message,
      media_content: message.media_content?.toString() ?? null,
      last_create_ts: message.last_create_ts.toISOString(),
      last_update_ts: message.last_update_ts.toISOString(),
    };
  }

  private parseDate(value: unknown, fieldName: string): Date {
    if (typeof value !== "string") {
      throw new RequestValidationError(`${fieldName} must be a string.`);
    }

    const date = new Date(value);

    if (Number.isNaN(date.valueOf())) {
      throw new RequestValidationError(`${fieldName} must be a valid date.`);
    }

    return date;
  }

  private parseUrl(value: unknown, fieldName: string): URL | null {
    if (value === null) {
      return null;
    }

    if (typeof value !== "string") {
      throw new RequestValidationError(`${fieldName} must be a string or null.`);
    }

    try {
      return new URL(value);
    } catch {
      throw new RequestValidationError(`${fieldName} must be a valid URL.`);
    }
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }
}
