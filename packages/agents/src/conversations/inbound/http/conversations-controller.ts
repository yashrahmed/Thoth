import {
  ApplicationError,
  type AttachmentUpload,
  type ConversationsApplicationService,
  type ConversationMessageRole,
} from "@thoth/contracts";
import { RequestValidationError } from "./request-validation-error";

interface CreateConversationBody {
  conversationId?: string;
}

interface JsonMessageBody {
  messageId?: string;
  role: ConversationMessageRole;
  textContent: string | null;
}

interface PostMessageRequestDto {
  messageId?: string;
  role: ConversationMessageRole;
  textContent: string | null;
  attachments: AttachmentUpload[];
}

export function createConversationsHttpHandler(
  service: ConversationsApplicationService,
): (req: Request) => Promise<Response> {
  const controller = new ConversationsController(service);

  return (req: Request) => controller.handle(req);
}

export class ConversationsController {
  public constructor(
    private readonly service: ConversationsApplicationService,
  ) {}

  public async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);

    try {
      if (req.method === "GET" && this.isConversationCollection(segments)) {
        return Response.json(await this.service.listConversations());
      }

      if (req.method === "POST" && this.isConversationCollection(segments)) {
        const body = (await this.parseJsonBody(req)) as CreateConversationBody;

        return Response.json(
          await this.service.createConversation({
            conversationId: this.optionalString(body.conversationId),
          }),
          { status: 201 },
        );
      }

      if (req.method === "GET" && this.isConversationDocument(segments)) {
        const conversation = await this.service.getConversationById(segments[1]!);

        if (!conversation) {
          return Response.json(
            { error: `Conversation "${segments[1]}" was not found.` },
            { status: 404 },
          );
        }

        return Response.json(conversation);
      }

      if (req.method === "DELETE" && this.isConversationDocument(segments)) {
        await this.service.deleteConversation({ conversationId: segments[1]! });

        return new Response(null, { status: 204 });
      }

      if (req.method === "POST" && this.isMessageCollection(segments)) {
        const parsedRequest = await this.parseMessageRequest(req);

        return Response.json(
          await this.service.postMessage({
            conversationId: segments[1]!,
            ...parsedRequest,
          }),
          { status: 201 },
        );
      }

      if (req.method === "DELETE" && this.isMessageDocument(segments)) {
        await this.service.deleteMessage({
          conversationId: segments[1]!,
          messageId: segments[3]!,
        });

        return new Response(null, { status: 204 });
      }
    } catch (error) {
      if (error instanceof ApplicationError) {
        const status = error.code === "NOT_FOUND" ? 404 : 400;

        return Response.json({ error: error.message }, { status });
      }

      if (error instanceof RequestValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }

      throw error;
    }

    return Response.json(
      { error: `Route ${req.method} ${url.pathname} is not supported.` },
      { status: 404 },
    );
  }

  private async parseMessageRequest(
    req: Request,
  ): Promise<PostMessageRequestDto> {
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      return this.parseMultipartMessageRequest(req);
    }

    const body = (await this.parseJsonBody(req)) as unknown as JsonMessageBody;

    return {
      messageId: this.optionalString(body.messageId),
      role: this.parseRole(body.role),
      textContent: this.parseNullableText(body.textContent),
      attachments: [],
    };
  }

  private async parseMultipartMessageRequest(
    req: Request,
  ): Promise<PostMessageRequestDto> {
    let formData: FormData;

    try {
      formData = await req.formData();
    } catch {
      throw new RequestValidationError(
        "Multipart body must be valid form-data content.",
      );
    }

    const rawMessage = formData.get("message");

    if (typeof rawMessage !== "string") {
      throw new RequestValidationError(
        "Multipart message field must be a JSON string.",
      );
    }

    let messageBody: JsonMessageBody;

    try {
      messageBody = JSON.parse(rawMessage) as JsonMessageBody;
    } catch {
      throw new RequestValidationError(
        "Multipart message field must be valid JSON.",
      );
    }

    const attachments: AttachmentUpload[] = [];

    for (const entry of formData.getAll("files")) {
      if (!(entry instanceof File)) {
        throw new RequestValidationError(
          "All files entries must be uploaded files.",
        );
      }

      attachments.push({
        originalFilename: entry.name || "blob",
        mediaType: entry.type || "application/octet-stream",
        byteSize: entry.size,
        body: await entry.arrayBuffer(),
      });
    }

    return {
      messageId: this.optionalString(messageBody.messageId),
      role: this.parseRole(messageBody.role),
      textContent: this.parseNullableText(messageBody.textContent),
      attachments,
    };
  }

  private async parseJsonBody(req: Request): Promise<Record<string, unknown>> {
    if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
      throw new RequestValidationError("Request body must be application/json.");
    }

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      throw new RequestValidationError("Request body must be valid JSON.");
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new RequestValidationError("Request body must be a JSON object.");
    }

    return body as Record<string, unknown>;
  }

  private parseRole(value: unknown): ConversationMessageRole {
    if (
      value !== "assistant" &&
      value !== "developer" &&
      value !== "system" &&
      value !== "user"
    ) {
      throw new RequestValidationError(
        "message.role must be one of assistant, developer, system, or user.",
      );
    }

    return value;
  }

  private parseNullableText(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value !== "string") {
      throw new RequestValidationError(
        "message.textContent must be a string or null.",
      );
    }

    return value;
  }

  private optionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== "string" || !value.trim()) {
      throw new RequestValidationError("Expected a non-empty string.");
    }

    return value;
  }

  private isConversationCollection(segments: string[]): boolean {
    return segments.length === 1 && segments[0] === "conversations";
  }

  private isConversationDocument(segments: string[]): boolean {
    return segments.length === 2 && segments[0] === "conversations";
  }

  private isMessageCollection(segments: string[]): boolean {
    return (
      segments.length === 3 &&
      segments[0] === "conversations" &&
      segments[2] === "messages"
    );
  }

  private isMessageDocument(segments: string[]): boolean {
    return (
      segments.length === 4 &&
      segments[0] === "conversations" &&
      segments[2] === "messages"
    );
  }
}
