import type {
  CreateMessageQuery,
  DeleteMessageQuery,
  MessageQuery,
  UpdateMessageQuery,
} from "@thoth/contracts";
import type { Message, MessageType } from "@thoth/entities";

interface MessageBody {
  id: string;
  type: MessageType;
  text_content: string | null;
  media_content: string | null;
  last_create_ts: string;
  last_update_ts: string;
}

interface MessageMutationBody {
  conversationId: string;
  message: MessageBody;
}

export class MessageController {
  constructor(private readonly messageRepository: MessageQuery) {}

  async insert(req: Request): Promise<Response> {
    const query = await this.parseMutationQuery(req);
    const message = await this.messageRepository.createMessage(query);

    return Response.json(this.serializeMessage(message), { status: 201 });
  }

  async update(req: Request): Promise<Response> {
    const query = await this.parseMutationQuery(req);
    const message = await this.messageRepository.updateMessage(query);

    return Response.json(this.serializeMessage(message));
  }

  async delete(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const messageId = url.searchParams.get("messageId");
    const conversationId = url.searchParams.get("conversationId");

    if (!messageId || !conversationId) {
      return Response.json(
        {
          error:
            "messageId and conversationId query parameters are required.",
        },
        { status: 400 },
      );
    }

    const query: DeleteMessageQuery = {
      conversationId,
      messageId,
    };

    await this.messageRepository.deleteMessage(query);

    return new Response(null, { status: 204 });
  }

  async showAll(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversationId");

    if (!conversationId) {
      return Response.json(
        { error: "conversationId query parameter is required." },
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
    const body = (await req.json()) as MessageMutationBody;

    return {
      conversationId: body.conversationId,
      message: this.parseMessage(body.message),
    };
  }

  private parseMessage(message: MessageBody): Message {
    return {
      ...message,
      media_content: message.media_content
        ? new URL(message.media_content)
        : null,
      last_create_ts: new Date(message.last_create_ts),
      last_update_ts: new Date(message.last_update_ts),
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
}
