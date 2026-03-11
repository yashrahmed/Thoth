import type { Conversation, ConversationId } from "@thoth/entities";
import { Pool } from "pg";
import {
  getConvStoreDatabaseConfig,
} from "./conv-store-database";

interface ConversationRow {
  id: string;
  last_create_ts: Date;
  last_update_ts: Date;
}

export class ConversationRepository {
  private readonly pool: Pool;

  constructor(databaseConfig = getConvStoreDatabaseConfig()) {
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

  async createConversation(
    conversationId: ConversationId,
    createdAt: Date,
  ): Promise<Conversation> {
    const result = await this.pool.query<ConversationRow>(
      `
        INSERT INTO public.conversations (
          id,
          last_create_ts,
          last_update_ts
        )
        VALUES ($1, $2, $3)
        RETURNING
          id,
          last_create_ts,
          last_update_ts
      `,
      [conversationId, createdAt, createdAt],
    );

    return this.mapRowToConversation(result.rows[0]);
  }

  async getConversationById(
    conversationId: ConversationId,
  ): Promise<Conversation | null> {
    const result = await this.pool.query<ConversationRow>(
      `
        SELECT
          id,
          last_create_ts,
          last_update_ts
        FROM public.conversations
        WHERE id = $1
      `,
      [conversationId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToConversation(result.rows[0]);
  }

  async listConversations(): Promise<Conversation[]> {
    const result = await this.pool.query<ConversationRow>(
      `
        SELECT
          id,
          last_create_ts,
          last_update_ts
        FROM public.conversations
        ORDER BY last_update_ts DESC
      `,
    );

    return result.rows.map((row) => this.mapRowToConversation(row));
  }

  async updateConversation(
    conversationId: ConversationId,
    updatedAt: Date,
  ): Promise<Conversation> {
    const result = await this.pool.query<ConversationRow>(
      `
        UPDATE public.conversations
        SET
          last_update_ts = $2
        WHERE id = $1
        RETURNING
          id,
          last_create_ts,
          last_update_ts
      `,
      [conversationId, updatedAt],
    );

    if (result.rows.length === 0) {
      throw new Error(
        `Conversation with id "${conversationId}" does not exist.`,
      );
    }

    return this.mapRowToConversation(result.rows[0]);
  }

  async deleteConversation(conversationId: ConversationId): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM public.conversations
        WHERE id = $1
      `,
      [conversationId],
    );
  }

  private mapRowToConversation(row: ConversationRow): Conversation {
    return {
      id: row.id,
      messages: [],
      last_create_ts: new Date(row.last_create_ts),
      last_update_ts: new Date(row.last_update_ts),
    };
  }
}
