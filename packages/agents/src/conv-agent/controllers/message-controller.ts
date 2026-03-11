import type {
  CreateMessageInput,
  CreateMessageQuery,
  DeleteMessageQuery,
  MessageQuery,
  MessageUploadInput,
} from "@thoth/contracts";
import type { MessageType } from "@thoth/entities";
import { serializeMessage } from "./serialization";

const MESSAGE_TYPES: MessageType[] = [
  "assistant",
  "developer",
  "system",
  "user",
];

class RequestValidationError extends Error {}

export class MessageController {
  constructor(private readonly messageService: MessageQuery) {}

  async insert(req: Request): Promise<Response> {
    let query: CreateMessageQuery;

    try {
      query = await this.parseMutationQuery(req);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }

      throw error;
    }

    const message = await this.messageService.createMessage(query);

    return Response.json(serializeMessage(message), { status: 201 });
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

    await this.messageService.deleteMessage(query);

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
      await this.messageService.listMessagesByConversationId(conversationId);

    return Response.json(messages.map((message) => serializeMessage(message)));
  }

  private async parseMutationQuery(req: Request): Promise<CreateMessageQuery> {
    const contentType = req.headers.get("content-type") ?? "";

    if (!contentType.includes("multipart/form-data")) {
      throw new RequestValidationError(
        "Request body must be multipart/form-data.",
      );
    }

    let body: FormData;

    try {
      body = await req.formData();
    } catch {
      throw new RequestValidationError(
        "Request body must be valid multipart/form-data.",
      );
    }

    const rawMessage = body.get("message");

    if (typeof rawMessage !== "string") {
      throw new RequestValidationError(
        "Multipart form field message must be a JSON string.",
      );
    }

    let parsedMessage: unknown;

    try {
      parsedMessage = JSON.parse(rawMessage);
    } catch {
      throw new RequestValidationError("message must be valid JSON.");
    }

    return {
      message: this.parseMessage(parsedMessage),
      files: await this.parseFiles(body),
    };
  }

  private async parseFiles(body: FormData): Promise<MessageUploadInput[]> {
    const formFiles = body.getAll("files");
    const uploads: MessageUploadInput[] = [];

    for (const formFile of formFiles) {
      if (!(formFile instanceof File)) {
        throw new RequestValidationError(
          "files form fields must be uploaded files.",
        );
      }

      uploads.push({
        original_filename: formFile.name || "blob",
        content_type: formFile.type || "application/octet-stream",
        byte_size: formFile.size,
        body: await formFile.arrayBuffer(),
      });
    }

    return uploads;
  }

  private parseMessage(message: unknown): CreateMessageInput {
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

    if (
      typeof message.type !== "string" ||
      !MESSAGE_TYPES.includes(message.type as MessageType)
    ) {
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

    return {
      id: message.id,
      conversation_id: message.conversation_id,
      type: message.type as MessageType,
      text_content: message.text_content,
    };
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }
}
