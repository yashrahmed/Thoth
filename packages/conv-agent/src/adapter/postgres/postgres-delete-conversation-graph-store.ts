import type { DeleteConversationGraphStore, DeletedConversationGraph } from "../../domain/contracts/delete-conversation-graph-store";
import { EntityType, NotFoundError, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, success, type Result } from "../../domain/objects/result";
import type { PostgresDatabase } from "./postgres-database";

interface CanonicalUrlRow {
  readonly canonical_url: string;
}

export class PostgresDeleteConversationGraphStore implements DeleteConversationGraphStore {
  constructor(private readonly sql: PostgresDatabase) {}

  async deleteConversationGraph(conversationId: string): Promise<Result<DeletedConversationGraph, NotFoundError | StoreError>> {
    try {
      const deletedGraph = await this.sql.begin(async (tx) => {
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

        return success<DeletedConversationGraph>({
          canonicalUrls: canonicalUrlRows.map((row) => row.canonical_url),
        });
      });

      return deletedGraph;
    } catch (error) {
      return failure(new StoreError(EntityType.Conversation, StoreOperation.Remove, getErrorMessage(error)));
    }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected database error.";
}
