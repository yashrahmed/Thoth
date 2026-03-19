import type {
  AppendMessageRequest,
  AppendMessageResult,
  AppendMessageToConversationFlow,
} from "../../application/append-message-to-conversation-flow";
import type { CreateConversationFlow } from "../../application/create-conversation-flow";
import type { DeleteConversationFlow } from "../../application/delete-conversation-flow";
import type { GetConversationFlow } from "../../application/get-conversation-flow";
import type {
  GetMessagesItem,
  GetMessagesOnConversationFlow,
} from "../../application/get-messages-on-conversation-flow";
import type { ListConversationsFlow } from "../../application/list-conversations-flow";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const MESSAGE_TYPES = ["user", "assistant", "system", "tool"] as const;

interface TransportValidationError {
  readonly kind: "ValidationError";
  readonly fieldName: string;
  readonly message: string;
}

type TransportResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: TransportValidationError };

type HandlerError =
  | TransportValidationError
  | {
      readonly kind: string;
      readonly fieldName?: string;
      readonly message?: string;
      readonly entityType?: string;
      readonly id?: string;
      readonly operation?: string;
    };

export function createConversationHttpHandler(
  createConversation: CreateConversationFlow,
  getConversation: GetConversationFlow,
  listConversations: ListConversationsFlow,
  deleteConversation: DeleteConversationFlow,
  appendMessageToConversation: AppendMessageToConversationFlow,
  getMessagesOnConversation: GetMessagesOnConversationFlow,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      const pathname = normalizePathname(url.pathname);

      if (req.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
      }

      if (req.method === "GET" && pathname === "/health") {
        return withCors(
          Response.json({
            status: "ok",
            service: "conv-agent",
          }),
        );
      }

      if (req.method === "GET" && pathname === "/") {
        return withCors(
          Response.json({
            name: "conv-agent",
            status: "ok",
          }),
        );
      }

      if (req.method === "POST" && pathname === "/conversations") {
        const result = await createConversation.execute();
        return withCors(mapConversationResult(result, 201));
      }

      if (req.method === "GET" && pathname === "/conversations") {
        const pageNum = Number(url.searchParams.get("pageNum"));
        const pageSize = Number(url.searchParams.get("pageSize"));
        const result = await listConversations.execute({
          pageNum,
          pageSize,
        });

        if (!result.ok) {
          return withCors(mapError(result.error));
        }

        return withCors(
          Response.json({
            items: result.value.map(toConversationResponse),
            pageNum,
            pageSize,
          }),
        );
      }

      const chatRoute = getConversationChatRoute(pathname);

      if (chatRoute && req.method === "POST") {
        const appendRequestResult = await parseAppendMessageRequest(
          req,
          chatRoute.conversationId,
        );

        if (!appendRequestResult.ok) {
          return withCors(mapError(appendRequestResult.error));
        }

        const result = await appendMessageToConversation.execute(
          appendRequestResult.value,
        );

        return withCors(mapMessageResult(result, 201));
      }

      if (chatRoute && req.method === "GET") {
        const pageNum = Number(url.searchParams.get("pageNum"));
        const pageSize = Number(url.searchParams.get("pageSize"));
        const result = await getMessagesOnConversation.execute({
          conversationId: chatRoute.conversationId,
          pageNum,
          pageSize,
        });

        if (!result.ok) {
          return withCors(mapError(result.error));
        }

        return withCors(
          Response.json({
            items: result.value.map(toMessageResponse),
            pageNum,
            pageSize,
          }),
        );
      }

      const conversationId = getConversationId(pathname);

      if (conversationId && req.method === "GET") {
        const result = await getConversation.execute({ conversationId });
        return withCors(mapConversationResult(result, 200));
      }

      if (conversationId && req.method === "DELETE") {
        const result = await deleteConversation.execute({
          conversationId,
        });

        if (!result.ok) {
          return withCors(mapError(result.error));
        }

        return withCors(new Response(null, { status: 204 }));
      }

      return withCors(
        Response.json(
          { error: `Route ${req.method} ${pathname} is not supported.` },
          { status: 404 },
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected conv-agent error.";

      return withCors(
        Response.json(
          {
            error: {
              kind: "UnexpectedError",
              message,
            },
          },
          { status: 500 },
        ),
      );
    }
  };
}

function mapConversationResult(
  result:
    | Awaited<ReturnType<CreateConversationFlow["execute"]>>
    | Awaited<ReturnType<GetConversationFlow["execute"]>>,
  successStatus: number,
): Response {
  if (!result.ok) {
    return mapError(result.error);
  }

  return Response.json(toConversationResponse(result.value), {
    status: successStatus,
  });
}

function mapMessageResult(
  result: Awaited<ReturnType<AppendMessageToConversationFlow["execute"]>>,
  successStatus: number,
): Response {
  if (!result.ok) {
    return mapError(result.error);
  }

  return Response.json(toMessageResponse(result.value), {
    status: successStatus,
  });
}

function mapError(error: HandlerError): Response {
  if (error.kind === "ValidationError" || error.kind === "ConstructionError") {
    return Response.json({ error }, { status: 400 });
  }

  if (error.kind === "NotFoundError") {
    return Response.json({ error }, { status: 404 });
  }

  return Response.json({ error }, { status: 500 });
}

function toConversationResponse(conversation: {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}) {
  return {
    id: conversation.id,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

function toMessageResponse(message: AppendMessageResult | GetMessagesItem) {
  if ("files" in message) {
    return {
      id: message.id,
      conversationId: message.conversationId,
      type: message.type,
      sequenceNumber: message.sequenceNumber,
      content: message.content,
      toolCalls: message.toolCalls,
      toolCallId: message.toolCallId,
      files: message.files.map((file) => ({
        id: file.id,
        canonicalUrl: file.canonicalUrl,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeInBytes: file.sizeInBytes,
        createdAt: file.createdAt.toISOString(),
        updatedAt: file.updatedAt.toISOString(),
      })),
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
    };
  }

  return {
    id: message.id,
    conversationId: message.conversationId,
    type: message.type,
    sequenceNumber: message.sequenceNumber,
    content: message.content,
    toolCalls: message.toolCalls,
    toolCallId: message.toolCallId,
    fileIds: [...message.fileIds],
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}

function getConversationId(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 2 && segments[0] === "conversations") {
    return segments[1] ?? null;
  }

  return null;
}

function getConversationChatRoute(
  pathname: string,
): { readonly conversationId: string } | null {
  const segments = pathname.split("/").filter(Boolean);

  if (
    segments.length === 3 &&
    segments[0] === "conversations" &&
    segments[2] === "chat"
  ) {
    return {
      conversationId: segments[1] ?? "",
    };
  }

  return null;
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function parseAppendMessageRequest(
  req: Request,
  conversationId: string,
): Promise<TransportResult<AppendMessageRequest>> {
  const contentType = req.headers.get("content-type") ?? "";

  if (!contentType.includes("multipart/form-data")) {
    return transportFailure(
      "content-type",
      "content-type must be multipart/form-data.",
    );
  }

  let formData: FormData;

  try {
    formData = await req.formData();
  } catch {
    return transportFailure("body", "body must be valid multipart/form-data.");
  }

  const typeValue = formData.get("type");

  if (typeof typeValue !== "string" || !isMessageType(typeValue)) {
    return transportFailure(
      "type",
      "type must be one of user, assistant, system, or tool.",
    );
  }

  const contentResult = parseJsonField<AppendMessageRequest["content"]>(
    formData,
    "content",
  );

  if (!contentResult.ok) {
    return contentResult;
  }

  const toolCallsEntry = formData.get("toolCalls");
  let toolCalls: AppendMessageRequest["toolCalls"] = [];

  if (toolCallsEntry !== null) {
    const toolCallsResult = parseJsonValue<AppendMessageRequest["toolCalls"]>(
      toolCallsEntry,
      "toolCalls",
    );

    if (!toolCallsResult.ok) {
      return toolCallsResult;
    }

    toolCalls = toolCallsResult.value;
  }

  const toolCallIdEntry = formData.get("toolCallId");
  const toolCallId =
    typeof toolCallIdEntry === "string" ? toolCallIdEntry : "";

  const attachments: Array<
    AppendMessageRequest["attachments"][number]
  > = [];

  for (const [, value] of formData.entries()) {
    if (typeof value === "string") {
      continue;
    }

    const fileValue = value as {
      readonly name: string;
      readonly type: string;
      arrayBuffer(): Promise<ArrayBuffer>;
    };

    attachments.push({
      content: await fileValue.arrayBuffer(),
      filename: fileValue.name,
      mimeType: fileValue.type || "application/octet-stream",
    });
  }

  return {
    ok: true,
    value: {
      conversationId,
      type: typeValue,
      content: contentResult.value,
      toolCalls,
      toolCallId,
      attachments,
    },
  };
}

function parseJsonField<T>(
  formData: FormData,
  fieldName: string,
): TransportResult<T> {
  const value = formData.get(fieldName);

  if (typeof value !== "string") {
    return transportFailure(fieldName, `${fieldName} must be present.`);
  }

  return parseJsonValue<T>(value, fieldName);
}

function parseJsonValue<T>(
  value: FormDataEntryValue,
  fieldName: string,
): TransportResult<T> {
  if (typeof value !== "string") {
    return transportFailure(fieldName, `${fieldName} must be a JSON string.`);
  }

  try {
    return {
      ok: true,
      value: JSON.parse(value) as T,
    };
  } catch {
    return transportFailure(fieldName, `${fieldName} must be valid JSON.`);
  }
}

function transportFailure(
  fieldName: string,
  message: string,
): TransportResult<never> {
  return {
    ok: false,
    error: {
      kind: "ValidationError",
      fieldName,
      message,
    },
  };
}

function isMessageType(value: string): value is AppendMessageRequest["type"] {
  return MESSAGE_TYPES.includes(value as (typeof MESSAGE_TYPES)[number]);
}
