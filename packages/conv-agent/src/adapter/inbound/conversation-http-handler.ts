import { Hono } from "hono";
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
import type { RequestCompletionFlow } from "../../application/request-completion-flow";
import type { ListConversationsFlow } from "../../application/list-conversations-flow";
import type { UpdateConvFlow } from "../../application/update-conv-flow";
import type { AccessIdentityAuthorizer } from "../../domain/contracts/access-identity-authorizer";
import type { AccessIdentity, AccessIdentityVerifier } from "../../domain/contracts/access-identity-verifier";
import { ConversationResponse, MessageResponse, PageResponse } from "../../domain/objects/response-types";

const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
const ALWAYS_AUTHORIZED_PATHS = new Set(["/auth/logout"]);
const GENERIC_INTERNAL_ERROR_MESSAGE = "An unexpected error occurred.";

interface HandlerVariables {
  identity: AccessIdentity;
}

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
  readonly accessVerification: AccessIdentityVerifier | null;
  readonly accessIdentityAuthorizer: AccessIdentityAuthorizer | null;
  readonly accessTeamDomain: string | null;
  readonly createConversation: CreateConversationFlow;
  readonly getConversation: GetConversationFlow;
  readonly listConversations: ListConversationsFlow;
  readonly updateConv: UpdateConvFlow;
  readonly deleteConversation: DeleteConversationFlow;
  readonly appendMessage: AppendMessageToConversationFlow;
  readonly requestCompletion: RequestCompletionFlow;
  readonly getMessagesOnConversation: GetMessagesOnConversationFlow;
}

export function createConversationHttpHandler(deps: ConversationHttpHandlerDeps): (req: Request) => Response | Promise<Response> {
  const app = new Hono<{ Variables: HandlerVariables }>();

  const { accessIdentityAuthorizer, accessVerification, accessTeamDomain } = deps;

  if (accessVerification) {
    app.use("*", async (c, next) => {
      if (ALWAYS_AUTHORIZED_PATHS.has(c.req.path)) {
        return next();
      }

      const token = c.req.header(ACCESS_JWT_HEADER);

      if (!token) {
        return c.json(
          {
            error: {
              kind: "UnauthorizedError",
              message: "Missing Cf-Access-Jwt-Assertion header.",
            },
          },
          401,
        );
      }

      const result = await accessVerification.verify(token);

      if (!result.ok) {
        return c.json(
          {
            error: {
              kind: "UnauthorizedError",
              message: `Invalid Cf-Access-Jwt-Assertion: ${result.reason}`,
            },
          },
          401,
        );
      }

      if (accessIdentityAuthorizer) {
        const isAuthorized = await accessIdentityAuthorizer.isAuthorized(result.identity);

        if (!isAuthorized) {
          return c.json(
            {
              error: {
                kind: "ForbiddenError",
                message: "Access identity is not authorized for conv-agent.",
              },
            },
            403,
          );
        }
      }

      c.set("identity", result.identity);
      return next();
    });
  }

  app.onError((error, c) => {
    console.error("[conv-agent] HTTP handler error", { path: c.req.path, error });

    return c.json(
      {
        error: {
          kind: "UnexpectedError",
          message: GENERIC_INTERNAL_ERROR_MESSAGE,
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

  // Browser-driven logout. Bounces to the Cloudflare Access team-domain logout endpoint,
  // which clears the CF_Authorization cookie and follows returnTo back to the UI's /login.
  // Hides the team domain from the web bundle. The return URL is computed from the
  // request host (no user-supplied input) so this endpoint can't be used as an open
  // redirect.
  app.get("/auth/logout", (c) => {
    const host = c.req.header("host");
    const loginUrl = host ? `https://${host}/login` : "/login";

    if (!accessTeamDomain) {
      return c.redirect(loginUrl, 302);
    }

    const logoutUrl = new URL("/cdn-cgi/access/logout", accessTeamDomain);
    logoutUrl.searchParams.set("returnTo", loginUrl);
    return c.redirect(logoutUrl.toString(), 302);
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

  // Appending never triggers a completion; clients request one explicitly via
  // /request-completion.
  app.post("/conversations/:id/append-direct", async (c) => {
    const conversationId = c.req.param("id");
    const appendRequestResult = await parseAppendMessageRequest(c.req.raw, conversationId);

    if (!appendRequestResult.ok) {
      return mapError(c, appendRequestResult.error);
    }

    const result = await deps.appendMessage.execute(appendRequestResult.value);

    if (!result.ok) {
      return mapError(c, result.error);
    }

    return c.json(MessageResponse.fromMessageWithFiles(result.value), 201);
  });

  app.post("/conversations/:id/request-completion", async (c) => {
    const conversationId = c.req.param("id");
    const completionRequestResult = await parseRequestCompletionRequest(c.req.raw, conversationId);

    if (!completionRequestResult.ok) {
      return mapError(c, completionRequestResult.error);
    }

    const result = await deps.requestCompletion.execute(completionRequestResult.value);

    if (!result.ok) {
      return mapError(c, result.error);
    }

    return c.json({ status: "accepted" }, 202);
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

  app.patch("/conversations/:id", async (c) => {
    const conversationId = c.req.param("id");
    const updateRequestResult = await parseUpdateConversationRequest(c.req.raw, conversationId);

    if (!updateRequestResult.ok) {
      return mapError(c, updateRequestResult.error);
    }

    const result = await deps.updateConv.execute(updateRequestResult.value);

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

async function parseUpdateConversationRequest(req: Request, conversationId: string): Promise<TransportResult<{ readonly conversationId: string; readonly title: string | null }>> {
  const contentType = req.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return transportFailure("content-type", "content-type must be application/json.");
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return transportFailure("body", "body must be valid JSON.");
  }

  if (!isRecord(body)) {
    return transportFailure("body", "body must be a JSON object.");
  }

  if (typeof body.title !== "string" && body.title !== null) {
    return transportFailure("title", "title must be a string or null.");
  }

  return {
    ok: true,
    value: {
      conversationId,
      title: body.title,
    },
  };
}

async function parseRequestCompletionRequest(
  req: Request,
  conversationId: string,
): Promise<TransportResult<{ readonly conversationId: string; readonly parentMessageId: string; readonly appendPosition: number }>> {
  const contentType = req.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return transportFailure("content-type", "content-type must be application/json.");
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return transportFailure("body", "body must be valid JSON.");
  }

  if (!isRecord(body)) {
    return transportFailure("body", "body must be a JSON object.");
  }

  if (typeof body.parentMessageId !== "string" || body.parentMessageId.trim().length === 0) {
    return transportFailure("parentMessageId", "parentMessageId must be a non-empty string.");
  }

  if (typeof body.appendPosition !== "number" || !Number.isInteger(body.appendPosition) || body.appendPosition <= 0) {
    return transportFailure("appendPosition", "appendPosition must be a positive integer.");
  }

  return {
    ok: true,
    value: {
      conversationId,
      parentMessageId: body.parentMessageId.trim(),
      appendPosition: body.appendPosition,
    },
  };
}

function mapError(c: { json: (data: unknown, status: number) => Response }, error: HandlerError): Response {
  if (error.kind === "ValidationError") {
    return c.json({ error }, 400);
  }

  if (error.kind === "NotFoundError") {
    return c.json({ error }, 404);
  }

  console.error("[conv-agent] request failed", error);

  return c.json(
    {
      error: {
        kind: "UnexpectedError",
        message: GENERIC_INTERNAL_ERROR_MESSAGE,
      },
    },
    500,
  );
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

  const appendPositionResult = parseAppendPositionField(formData);

  if (!appendPositionResult.ok) {
    return appendPositionResult;
  }

  const parentMessageIdResult = parseParentMessageIdField(formData);

  if (!parentMessageIdResult.ok) {
    return parentMessageIdResult;
  }

  const attachments = await parseAttachments(formData);

  return {
    ok: true,
    value: {
      conversationId,
      parentMessageId: parentMessageIdResult.value,
      appendPosition: appendPositionResult.value,
      type: typeValue,
      content: contentResult.value,
      attachments,
    },
  };
}

async function parseAttachments(formData: FormData): Promise<Attachment[]> {
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

  return attachments;
}

function parseContentField(formData: FormData): TransportResult<ApplicationContent> {
  const value = formData.get("content");

  if (typeof value !== "string") {
    return transportFailure("content", "content must be present.");
  }

  return { ok: true, value };
}

function parseAppendPositionField(formData: FormData): TransportResult<number> {
  const value = formData.get("appendPosition");

  if (typeof value !== "string") {
    return transportFailure("appendPosition", "appendPosition must be present.");
  }

  const appendPosition = Number(value);

  if (!Number.isInteger(appendPosition) || appendPosition <= 0) {
    return transportFailure("appendPosition", "appendPosition must be a positive integer.");
  }

  return { ok: true, value: appendPosition };
}

function parseParentMessageIdField(formData: FormData): TransportResult<string | null> {
  const value = formData.get("parentMessageId");

  if (value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return transportFailure("parentMessageId", "parentMessageId must be a string.");
  }

  const parentMessageId = value.trim();

  return { ok: true, value: parentMessageId.length > 0 ? parentMessageId : null };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMessageType(value: string): value is ApplicationMessageType {
  return MESSAGE_TYPES.includes(value as (typeof MESSAGE_TYPES)[number]);
}
