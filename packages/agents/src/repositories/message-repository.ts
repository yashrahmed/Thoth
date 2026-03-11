import type { ConversationId, Message, MessageId } from "@thoth/entities";
import { Pool } from "pg";
import {
  getConvStoreDatabaseConfig,
} from "./conv-store-database";
import { FileRepository } from "./file-repository";

interface MessageRow {
  id: string;
  conversation_id: string;
  type: Message["type"];
  text_content: string | null;
  last_create_ts: Date;
  last_update_ts: Date;
}

export class MessageRepository {
  private readonly pool: Pool;

  constructor(
    databaseConfig = getConvStoreDatabaseConfig(),
    private readonly fileRepository: FileRepository = new FileRepository(
      databaseConfig,
    ),
  ) {
    if (Number.isNaN(databaseConfig.port)) {
      throw new Error("CONV_STORE_DB_PORT must be a valid number.");
    }

    this.pool = new Pool({
      host: databaseConfig.host,
      port: databaseConfig.port,
      database: databaseConfig.database,
      user: databaseConfig.user,
      password: databaseConfig.password,
      ssl: databaseConfig.ssl,
    });
  }

  async createMessage(message: Message): Promise<Message> {
    const result = await this.pool.query<MessageRow>(
      `
        INSERT INTO public.messages (
          id,
          conversation_id,
          type,
          text_content,
          last_create_ts,
          last_update_ts
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          id,
          conversation_id,
          type,
          text_content,
          last_create_ts,
          last_update_ts
      `,
      [
        message.id,
        message.conversation_id,
        message.type,
        message.text_content,
        message.last_create_ts,
        message.last_update_ts,
      ],
    );

    return this.hydrateRow(result.rows[0], []);
  }

  async getMessageById(messageId: MessageId): Promise<Message | null> {
    const result = await this.pool.query<MessageRow>(
      `
        SELECT
          id,
          conversation_id,
          type,
          text_content,
          last_create_ts,
          last_update_ts
        FROM public.messages
        WHERE id = $1
      `,
      [messageId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const filesByMessageId = await this.fileRepository.listByMessageIds([
      messageId,
    ]);

    return this.hydrateRow(
      result.rows[0],
      filesByMessageId.get(messageId) ?? [],
    );
  }

  async listMessagesByConversationId(
    conversationId: ConversationId,
  ): Promise<Message[]> {
    const groupedMessages = await this.listMessagesByConversationIds([
      conversationId,
    ]);

    return groupedMessages.get(conversationId) ?? [];
  }

  async listMessagesByConversationIds(
    conversationIds: ConversationId[],
  ): Promise<Map<ConversationId, Message[]>> {
    if (conversationIds.length === 0) {
      return new Map();
    }

    const result = await this.pool.query<MessageRow>(
      `
        SELECT
          id,
          conversation_id,
          type,
          text_content,
          last_create_ts,
          last_update_ts
        FROM public.messages
        WHERE conversation_id = ANY($1::uuid[])
        ORDER BY conversation_id ASC, last_create_ts ASC, id ASC
      `,
      [conversationIds],
    );

    const filesByMessageId = await this.fileRepository.listByMessageIds(
      result.rows.map((row) => row.id),
    );
    const messagesByConversationId = new Map<ConversationId, Message[]>();

    for (const row of result.rows) {
      const messages = messagesByConversationId.get(row.conversation_id) ?? [];
      messages.push(this.hydrateRow(row, filesByMessageId.get(row.id) ?? []));
      messagesByConversationId.set(row.conversation_id, messages);
    }

    return messagesByConversationId;
  }

  async deleteMessage(
    messageId: MessageId,
    conversationId: ConversationId,
  ): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM public.messages
        WHERE id = $1 AND conversation_id = $2
      `,
      [messageId, conversationId],
    );
  }

  async deleteMessageById(messageId: MessageId): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM public.messages
        WHERE id = $1
      `,
      [messageId],
    );
  }

  private hydrateRow(row: MessageRow, files: Message["files"]): Message {
    return {
      id: row.id,
      conversation_id: row.conversation_id,
      type: row.type,
      text_content: row.text_content,
      files,
      last_create_ts: new Date(row.last_create_ts),
      last_update_ts: new Date(row.last_update_ts),
    };
  }
}
