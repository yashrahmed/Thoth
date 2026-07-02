import type { DeleteConversationStore, DeletedConversation } from "../../domain/contracts/delete-conversation-store";
import { EntityType, NotFoundError, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, success, type Result } from "../../domain/objects/result";
import { getErrorMessage } from "../common/errors";
import type { PostgresDatabase } from "./postgres-database";

interface CanonicalUrlRow {
  readonly canonical_url: string;
}

export class PostgresDeleteConversationStore implements DeleteConversationStore {
  constructor(private readonly sql: PostgresDatabase) {}

  async deleteConversation(conversationId: string): Promise<Result<DeletedConversation, NotFoundError | StoreError>> {
    try {
      const deletedConversation = await this.sql.begin(async (tx) => {
        const sql = tx as unknown as PostgresDatabase;
        const lockedConversationRows = await sql<{ id: string }[]>`
          select id
          from thoth.conversations
          where id = ${conversationId}
          for update
        `;

        if (!lockedConversationRows[0]) {
          return failure(new NotFoundError(EntityType.Conversation, conversationId));
        }

        const canonicalUrlRows = await sql<CanonicalUrlRow[]>`
          select f.canonical_url
          from thoth.messages as m
          join thoth.files as f on f.message_id = m.id
          where m.conversation_id = ${conversationId}
          order by f.created_at asc, f.id asc
        `;

        await sql`
          delete from thoth.conversations
          where id = ${conversationId}
        `;

        return success<DeletedConversation>({
          canonicalUrls: canonicalUrlRows.map((row) => row.canonical_url),
        });
      });

      return deletedConversation;
    } catch (error) {
      return failure(new StoreError(EntityType.Conversation, StoreOperation.Remove, getErrorMessage(error)));
    }
  }
}
