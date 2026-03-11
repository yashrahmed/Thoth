import { Pool } from "pg";
import {
  Attachment,
  AttachmentId,
  Conversation,
  ConversationId,
  type ConversationRepository,
  Message,
  MessageId,
  MessageText,
  assertMessageRole,
} from "@thoth/entities";

interface ConversationRow {
  id: string;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  text_content: string | null;
  created_at: Date;
  updated_at: Date;
}

interface AttachmentRow {
  id: string;
  message_id: string;
  object_key: string;
  original_filename: string;
  media_type: string;
  byte_size: string | number;
  created_at: Date;
}

export class PostgresConversationRepository implements ConversationRepository {
  public constructor(private readonly pool: Pool) {}

  public async getById(
    conversationId: ConversationId,
  ): Promise<Conversation | null> {
    const conversations = await this.hydrateConversations([conversationId.value]);

    return conversations[0] ?? null;
  }

  public async list(): Promise<Conversation[]> {
    const result = await this.pool.query<ConversationRow>(
      `
        SELECT id, created_at, updated_at
        FROM public.conversations
        ORDER BY updated_at DESC, id ASC
      `,
    );

    return this.hydrateRows(result.rows);
  }

  public async save(conversation: Conversation): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO public.conversations (id, created_at, updated_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (id) DO UPDATE
          SET
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at
        `,
        [
          conversation.id.value,
          conversation.createdAt,
          conversation.updatedAt,
        ],
      );

      await client.query(
        `
          DELETE FROM public.attachments
          WHERE message_id IN (
            SELECT id FROM public.messages WHERE conversation_id = $1
          )
        `,
        [conversation.id.value],
      );
      await client.query(
        `
          DELETE FROM public.messages
          WHERE conversation_id = $1
        `,
        [conversation.id.value],
      );

      for (const message of conversation.messages) {
        await client.query(
          `
            INSERT INTO public.messages (
              id,
              conversation_id,
              role,
              text_content,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            message.id.value,
            conversation.id.value,
            message.role,
            message.textContent,
            message.createdAt,
            message.updatedAt,
          ],
        );

        for (const attachment of message.attachments) {
          await client.query(
            `
              INSERT INTO public.attachments (
                id,
                message_id,
                object_key,
                original_filename,
                media_type,
                byte_size,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7)
            `,
            [
              attachment.id.value,
              message.id.value,
              attachment.objectKey,
              attachment.originalFilename,
              attachment.mediaType,
              attachment.byteSize,
              attachment.createdAt,
            ],
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async delete(conversationId: ConversationId): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM public.conversations
        WHERE id = $1
      `,
      [conversationId.value],
    );
  }

  private async hydrateConversations(conversationIds: string[]): Promise<Conversation[]> {
    if (conversationIds.length === 0) {
      return [];
    }

    const result = await this.pool.query<ConversationRow>(
      `
        SELECT id, created_at, updated_at
        FROM public.conversations
        WHERE id = ANY($1::uuid[])
        ORDER BY updated_at DESC, id ASC
      `,
      [conversationIds],
    );

    return this.hydrateRows(result.rows);
  }

  private async hydrateRows(rows: ConversationRow[]): Promise<Conversation[]> {
    if (rows.length === 0) {
      return [];
    }

    const conversationIds = rows.map((row) => row.id);
    const messagesResult = await this.pool.query<MessageRow>(
      `
        SELECT id, conversation_id, role, text_content, created_at, updated_at
        FROM public.messages
        WHERE conversation_id = ANY($1::uuid[])
        ORDER BY conversation_id ASC, created_at ASC, id ASC
      `,
      [conversationIds],
    );
    const messageIds = messagesResult.rows.map((row) => row.id);
    const attachmentsResult =
      messageIds.length === 0
        ? { rows: [] as AttachmentRow[] }
        : await this.pool.query<AttachmentRow>(
            `
              SELECT
                id,
                message_id,
                object_key,
                original_filename,
                media_type,
                byte_size,
                created_at
              FROM public.attachments
              WHERE message_id = ANY($1::uuid[])
              ORDER BY created_at ASC, id ASC
            `,
            [messageIds],
          );

    const attachmentsByMessageId = new Map<string, Attachment[]>();

    for (const row of attachmentsResult.rows) {
      const attachments = attachmentsByMessageId.get(row.message_id) ?? [];
      attachments.push(
        new Attachment({
          id: new AttachmentId(row.id),
          objectKey: row.object_key,
          originalFilename: row.original_filename,
          mediaType: row.media_type,
          byteSize: Number(row.byte_size),
          createdAt: new Date(row.created_at),
        }),
      );
      attachmentsByMessageId.set(row.message_id, attachments);
    }

    const messagesByConversationId = new Map<string, Message[]>();

    for (const row of messagesResult.rows) {
      const messages = messagesByConversationId.get(row.conversation_id) ?? [];
      messages.push(
        new Message({
          id: new MessageId(row.id),
          role: assertMessageRole(row.role),
          text: row.text_content === null ? null : new MessageText(row.text_content),
          attachments: attachmentsByMessageId.get(row.id) ?? [],
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        }),
      );
      messagesByConversationId.set(row.conversation_id, messages);
    }

    return rows.map((row) =>
      Conversation.rehydrate({
        id: new ConversationId(row.id),
        messages: messagesByConversationId.get(row.id) ?? [],
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      }),
    );
  }
}
