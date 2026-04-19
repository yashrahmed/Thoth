import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  MESSAGE_TYPES,
  type AppendMessageToConversationFlow,
  type AppendMessageRequest as ApplicationAppendMessageRequest,
  type Attachment,
} from "../../application/append-message-to-conversation-flow";
import type { CreateConversationFlow } from "../../application/create-conversation-flow";
import type { DeleteConversationFlow } from "../../application/delete-conversation-flow";
import type { GetConversationFlow } from "../../application/get-conversation-flow";
import { type GetMessagesOnConversationFlow } from "../../application/get-messages-on-conversation-flow";
import type { ListConversationsFlow } from "../../application/list-conversations-flow";
import { ConversationResponse, MessageResponse, PageResponse } from "../../domain/objects/response-types";

interface TransportValidationError {
  readonly kind: "ValidationError";
  readonly fieldName: string;
  readonly message: string;
}

type TransportResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: TransportValidationError };

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

type ApplicationMessageType = ApplicationAppendMessageRequest["type"];
type ApplicationContent = ApplicationAppendMessageRequest["content"];

interface ConversationHttpHandlerDeps {
  readonly createConversation: CreateConversationFlow;
  readonly getConversation: GetConversationFlow;
  readonly listConversations: ListConversationsFlow;
  readonly deleteConversation: DeleteConversationFlow;
  readonly appendMessageToConversation: AppendMessageToConversationFlow;
  readonly getMessagesOnConversation: GetMessagesOnConversationFlow;
}

export function createConversationHttpHandler(deps: ConversationHttpHandlerDeps): (req: Request) => Response | Promise<Response> {
  const app = new Hono();

  app.use("*", cors());

  app.onError((error, c) => {
    const message = error instanceof Error ? error.message : "Unexpected conv-agent error.";

    return c.json(
      {
        error: {
          kind: "UnexpectedError",
          message,
        },
      },
      500,
    );
  });

  app.get("/health", (c) => {
    return c.json({ status: "ok", service: "conv-agent" });
  });

  app.get("/", (c) => {
    return c.json({ name: "conv-agent", status: "ok" });
  });

  app.post("/conversations", async (c) => {
    const result = await deps.createConversation.execute();

    if (!result.ok) {
      return mapError(c, result.error);
    }

    return c.json(ConversationResponse.fromConversation(result.value), 201);
  });

  app.get("/conversations", async (c) => {
    const pageNum = Number(c.req.query("pageNum"));
    const pageSize = Number(c.req.query("pageSize"));
    const result = await deps.listConversations.execute({ pageNum, pageSize });

    if (!result.ok) {
      return mapError(c, result.error);
    }

    return c.json(new PageResponse(result.value.map(ConversationResponse.fromConversation), pageNum, pageSize));
  });

  app.post("/conversations/:id/chat", async (c) => {
    const conversationId = c.req.param("id");
    const appendRequestResult = await parseAppendMessageRequest(c.req.raw, conversationId);

    if (!appendRequestResult.ok) {
      return mapError(c, appendRequestResult.error);
    }

    const result = await deps.appendMessageToConversation.execute(appendRequestResult.value);

    if (!result.ok) {
      return mapError(c, result.error);
    }

    return c.body(null, 204);
  });

  app.get("/conversations/:id/chat", async (c) => {
    const conversationId = c.req.param("id");
    const pageNum = Number(c.req.query("pageNum"));
    const pageSize = Number(c.req.query("pageSize"));
    const result = await deps.getMessagesOnConversation.execute({ conversationId, pageNum, pageSize });

    if (!result.ok) {
      return mapError(c, result.error);
    }

    return c.json(new PageResponse(result.value.map(MessageResponse.fromMessageWithFiles), pageNum, pageSize));
  });

  app.get("/conversations/:id", async (c) => {
    const conversationId = c.req.param("id");
    const result = await deps.getConversation.execute({ conversationId });

    if (!result.ok) {
      return mapError(c, result.error);
    }

    return c.json(ConversationResponse.fromConversation(result.value));
  });

  app.delete("/conversations/:id", async (c) => {
    const conversationId = c.req.param("id");
    const result = await deps.deleteConversation.execute({ conversationId });

    if (!result.ok) {
      return mapError(c, result.error);
    }

    return c.body(null, 204);
  });

  return (req: Request) => app.fetch(req);
}

function mapError(c: { json: (data: unknown, status: number) => Response }, error: HandlerError): Response {
  if (error.kind === "ValidationError") {
    return c.json({ error }, 400);
  }

  if (error.kind === "NotFoundError") {
    return c.json({ error }, 404);
  }

  return c.json({ error }, 500);
}

async function parseAppendMessageRequest(req: Request, conversationId: string): Promise<TransportResult<ApplicationAppendMessageRequest>> {
  const contentType = req.headers.get("content-type") ?? "";

  if (!contentType.includes("multipart/form-data")) {
    return transportFailure("content-type", "content-type must be multipart/form-data.");
  }

  let formData: FormData;

  try {
    formData = await req.formData();
  } catch {
    return transportFailure("body", "body must be valid multipart/form-data.");
  }

  const typeValue = formData.get("type");

  if (typeof typeValue !== "string" || !isMessageType(typeValue)) {
    return transportFailure("type", "type must be one of user, assistant, system, or tool.");
  }

  const contentResult = parseContentField(formData);

  if (!contentResult.ok) {
    return contentResult;
  }

  const attachments: Attachment[] = [];

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
      attachments,
    },
  };
}

function parseContentField(formData: FormData): TransportResult<ApplicationContent> {
  const value = formData.get("content");

  if (typeof value !== "string") {
    return transportFailure("content", "content must be present.");
  }

  return { ok: true, value };
}

function transportFailure(fieldName: string, message: string): TransportResult<never> {
  return {
    ok: false,
    error: {
      kind: "ValidationError",
      fieldName,
      message,
    },
  };
}

function isMessageType(value: string): value is ApplicationMessageType {
  return MESSAGE_TYPES.includes(value as (typeof MESSAGE_TYPES)[number]);
}
