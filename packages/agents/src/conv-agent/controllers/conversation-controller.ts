import type {
  ConversationMutationInput,
  ConversationQuery,
  CreateConversationQuery,
  DeleteConversationQuery,
  UpdateConversationQuery,
} from "@thoth/contracts";
import { serializeConversation } from "./serialization";

interface ConversationBody {
  id: string;
}

class RequestValidationError extends Error {}

export class ConversationController {
  constructor(private readonly conversationService: ConversationQuery) {}

  async insert(req: Request): Promise<Response> {
    let query: CreateConversationQuery;

    try {
      query = await this.parseMutationQuery(req);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }

      throw error;
    }

    const conversation =
      await this.conversationService.createConversation(query);

    return Response.json(serializeConversation(conversation), {
      status: 201,
    });
  }

  async update(req: Request): Promise<Response> {
    let query: UpdateConversationQuery;

    try {
      query = await this.parseMutationQuery(req);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }

      throw error;
    }

    const conversation =
      await this.conversationService.updateConversation(query);

    return Response.json(serializeConversation(conversation));
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

    await this.conversationService.deleteConversation(query);

    return new Response(null, { status: 204 });
  }

  async show(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversation_id");

    if (conversationId) {
      const conversation =
        await this.conversationService.getConversationById(conversationId);

      if (!conversation) {
        return Response.json(
          { error: `Conversation with id "${conversationId}" was not found.` },
          { status: 404 },
        );
      }

      return Response.json(serializeConversation(conversation));
    }

    const conversations = await this.conversationService.listConversations();

    return Response.json(
      conversations.map((conversation) => serializeConversation(conversation)),
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

  private parseConversation(conversation: unknown): ConversationMutationInput {
    if (!this.isObject(conversation)) {
      throw new RequestValidationError("conversation must be a JSON object.");
    }

    if (!this.isNonEmptyString(conversation.id)) {
      throw new RequestValidationError(
        "conversation.id must be a non-empty string.",
      );
    }

    return {
      id: conversation.id,
    };
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }
}
