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

export function createConversationsHttpHandler(
  service: ConversationsApplicationService,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);

    try {
      if (req.method === "GET" && isConversationCollection(segments)) {
        return Response.json(await service.listConversations());
      }

      if (req.method === "POST" && isConversationCollection(segments)) {
        const body = (await parseJsonBody(req)) as CreateConversationBody;

        return Response.json(
          await service.createConversation({
            conversationId: optionalString(body.conversationId),
          }),
          { status: 201 },
        );
      }

      if (req.method === "GET" && isConversationDocument(segments)) {
        const conversation = await service.getConversationById(segments[1]!);

        if (!conversation) {
          return Response.json(
            { error: `Conversation "${segments[1]}" was not found.` },
            { status: 404 },
          );
        }

        return Response.json(conversation);
      }

      if (req.method === "DELETE" && isConversationDocument(segments)) {
        await service.deleteConversation({ conversationId: segments[1]! });

        return new Response(null, { status: 204 });
      }

      if (req.method === "POST" && isMessageCollection(segments)) {
        const parsedRequest = await parseMessageRequest(req);

        return Response.json(
          await service.postMessage({
            conversationId: segments[1]!,
            ...parsedRequest,
          }),
          { status: 201 },
        );
      }

      if (req.method === "DELETE" && isMessageDocument(segments)) {
        await service.deleteMessage({
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
  };
}

async function parseMessageRequest(req: Request): Promise<{
  messageId?: string;
  role: ConversationMessageRole;
  textContent: string | null;
  attachments: AttachmentUpload[];
}> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    return parseMultipartMessageRequest(req);
  }

  const body = (await parseJsonBody(req)) as unknown as JsonMessageBody;

  return {
    messageId: optionalString(body.messageId),
    role: parseRole(body.role),
    textContent: parseNullableText(body.textContent),
    attachments: [],
  };
}

async function parseMultipartMessageRequest(req: Request): Promise<{
  messageId?: string;
  role: ConversationMessageRole;
  textContent: string | null;
  attachments: AttachmentUpload[];
}> {
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
    throw new RequestValidationError("Multipart message field must be valid JSON.");
  }

  const attachments: AttachmentUpload[] = [];

  for (const entry of formData.getAll("files")) {
    if (!(entry instanceof File)) {
      throw new RequestValidationError("All files entries must be uploaded files.");
    }

    attachments.push({
      originalFilename: entry.name || "blob",
      mediaType: entry.type || "application/octet-stream",
      byteSize: entry.size,
      body: await entry.arrayBuffer(),
    });
  }

  return {
    messageId: optionalString(messageBody.messageId),
    role: parseRole(messageBody.role),
    textContent: parseNullableText(messageBody.textContent),
    attachments,
  };
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
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

function parseRole(value: unknown): ConversationMessageRole {
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

function parseNullableText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new RequestValidationError("message.textContent must be a string or null.");
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new RequestValidationError("Expected a non-empty string.");
  }

  return value;
}

function isConversationCollection(segments: string[]): boolean {
  return segments.length === 1 && segments[0] === "conversations";
}

function isConversationDocument(segments: string[]): boolean {
  return segments.length === 2 && segments[0] === "conversations";
}

function isMessageCollection(segments: string[]): boolean {
  return (
    segments.length === 3 &&
    segments[0] === "conversations" &&
    segments[2] === "messages"
  );
}

function isMessageDocument(segments: string[]): boolean {
  return (
    segments.length === 4 &&
    segments[0] === "conversations" &&
    segments[2] === "messages"
  );
}
