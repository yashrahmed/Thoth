import type {
  ConversationQuery,
  CreateConversationQuery,
  DeleteConversationQuery,
  UpdateConversationQuery,
} from "@thoth/contracts";
import type { Conversation } from "@thoth/entities";

interface ConversationBody {
  id: string;
  messages: unknown[];
  last_create_ts: string;
  last_update_ts: string;
}

class RequestValidationError extends Error {}

export class ConversationController {
  constructor(private readonly conversationRepository: ConversationQuery) {}

  async insert(req: Request): Promise<Response> {
    let query: CreateConversationQuery | UpdateConversationQuery;

    try {
      query = await this.parseMutationQuery(req);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }

      throw error;
    }

    const conversation =
      await this.conversationRepository.createConversation(query);

    return Response.json(this.serializeConversation(conversation), {
      status: 201,
    });
  }

  async update(req: Request): Promise<Response> {
    let query: CreateConversationQuery | UpdateConversationQuery;

    try {
      query = await this.parseMutationQuery(req);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }

      throw error;
    }

    const conversation =
      await this.conversationRepository.updateConversation(query);

    return Response.json(this.serializeConversation(conversation));
  }

  async delete(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversation_id");

    if (!conversationId) {
      return Response.json(
        { error: "conversation_id query parameter is required." },
        { status: 400 },
      );
    }

    const query: DeleteConversationQuery = {
      conversation_id: conversationId,
    };

    await this.conversationRepository.deleteConversation(query);

    return new Response(null, { status: 204 });
  }

  async show(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversation_id");

    if (conversationId) {
      const conversation =
        await this.conversationRepository.getConversationById(conversationId);

      if (!conversation) {
        return Response.json(
          { error: `Conversation with id "${conversationId}" was not found.` },
          { status: 404 },
        );
      }

      return Response.json(this.serializeConversation(conversation));
    }

    const conversations = await this.conversationRepository.listConversations();

    return Response.json(
      conversations.map((conversation) =>
        this.serializeConversation(conversation),
      ),
    );
  }

  private async parseMutationQuery(
    req: Request,
  ): Promise<CreateConversationQuery | UpdateConversationQuery> {
    const body = await this.parseRequestBody(req);

    return {
      conversation: this.parseConversation(body.conversation),
    };
  }

  private async parseRequestBody(
    req: Request,
  ): Promise<{ conversation: ConversationBody }> {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      throw new RequestValidationError("Request body must be valid JSON.");
    }

    if (!this.isObject(body)) {
      throw new RequestValidationError("Request body must be a JSON object.");
    }

    if (!("conversation" in body)) {
      throw new RequestValidationError(
        "Request body must include conversation.",
      );
    }

    return body as { conversation: ConversationBody };
  }

  private parseConversation(conversation: ConversationBody): Conversation {
    if (!this.isObject(conversation)) {
      throw new RequestValidationError("conversation must be a JSON object.");
    }

    if (!this.isNonEmptyString(conversation.id)) {
      throw new RequestValidationError(
        "conversation.id must be a non-empty string.",
      );
    }

    if (!Array.isArray(conversation.messages)) {
      throw new RequestValidationError("conversation.messages must be an array.");
    }

    if (conversation.messages.length > 0) {
      throw new RequestValidationError(
        "conversation.messages must be an empty array for metadata-only responses.",
      );
    }

    return {
      id: conversation.id,
      messages: [],
      last_create_ts: this.parseDate(
        conversation.last_create_ts,
        "conversation.last_create_ts",
      ),
      last_update_ts: this.parseDate(
        conversation.last_update_ts,
        "conversation.last_update_ts",
      ),
    };
  }

  private serializeConversation(conversation: Conversation) {
    return {
      id: conversation.id,
      messages: [],
      last_create_ts: conversation.last_create_ts.toISOString(),
      last_update_ts: conversation.last_update_ts.toISOString(),
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

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }
}
