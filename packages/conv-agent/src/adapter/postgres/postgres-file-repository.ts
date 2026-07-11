import type { FileRepository } from "../../domain/contracts/file-repository";
import type { File } from "../../domain/objects/message-types";
import { EntityType, NotFoundError, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, type Result, success } from "../../domain/objects/result";
import { getErrorMessage } from "../common/errors";
import { mapFileRow, mapFileRows, type FileRow } from "../common/row-mapper";
import type { PostgresDatabase } from "./postgres-database";

export class PostgresFileRepository implements FileRepository {
  constructor(private readonly sql: PostgresDatabase) {}

  async upsertFileRow(record: Omit<File, "id">) {
    try {
      const rows = await this.sql<FileRow[]>`
        insert into thoth.files (
          message_id_bigint,
          canonical_url,
          filename,
          mime_type,
          size_in_bytes,
          created_at,
          updated_at
        )
        values (
          ${record.messageId},
          ${record.canonicalUrl},
          ${record.filename},
          ${record.mimeType},
          ${record.sizeInBytes},
          ${record.createdAt.toISOString()},
          ${record.updatedAt.toISOString()}
        )
        returning
          id,
          message_id_bigint::text as message_id,
          canonical_url,
          filename,
          mime_type,
          size_in_bytes,
          created_at,
          updated_at
      `;

      return mapFileRow(rows[0], StoreOperation.Persist);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Persist, getErrorMessage(error)));
    }
  }

  async selectFileRow(id: string): Promise<Result<File, NotFoundError | StoreError>> {
    try {
      const rows = await this.sql<FileRow[]>`
        select
          id,
          message_id_bigint::text as message_id,
          canonical_url,
          filename,
          mime_type,
          size_in_bytes,
          created_at,
          updated_at
        from thoth.files
        where id = ${id}
      `;

      const row = rows[0];

      if (!row) {
        return failure(new NotFoundError(EntityType.File, id));
      }

      return mapFileRow(row, StoreOperation.Read);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Read, getErrorMessage(error)));
    }
  }

  async selectFileRows(ids: ReadonlyArray<string>): Promise<Result<File[], StoreError>> {
    if (ids.length === 0) {
      return success([]);
    }

    try {
      const rows = await this.sql<FileRow[]>`
        select
          id,
          message_id_bigint::text as message_id,
          canonical_url,
          filename,
          mime_type,
          size_in_bytes,
          created_at,
          updated_at
        from thoth.files
        where id = any(${ids as string[]})
      `;

      return mapFileRows(rows, StoreOperation.Read);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Read, getErrorMessage(error)));
    }
  }

  async selectFileRowsByMessageIds(messageIds: ReadonlyArray<string>): Promise<Result<File[], StoreError>> {
    if (messageIds.length === 0) {
      return success([]);
    }

    try {
      const rows = await this.sql<FileRow[]>`
        select
          id,
          message_id_bigint::text as message_id,
          canonical_url,
          filename,
          mime_type,
          size_in_bytes,
          created_at,
          updated_at
        from thoth.files
        where message_id_bigint = any(${messageIds as string[]}::bigint[])
        order by created_at asc, id asc
      `;

      return mapFileRows(rows, StoreOperation.Read);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Read, getErrorMessage(error)));
    }
  }

  async selectFileRowsByConversationId(conversationId: string): Promise<Result<File[], StoreError>> {
    try {
      const rows = await this.sql<FileRow[]>`
        select
          f.id,
          f.message_id_bigint::text as message_id,
          f.canonical_url,
          f.filename,
          f.mime_type,
          f.size_in_bytes,
          f.created_at,
          f.updated_at
        from thoth.files f
        join thoth.messages m on m.id_bigint = f.message_id_bigint
        where m.conversation_id = ${conversationId}
        order by f.created_at asc, f.id asc
      `;

      return mapFileRows(rows, StoreOperation.Read);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Read, getErrorMessage(error)));
    }
  }

  async deleteFileRow(id: string): Promise<Result<void, StoreError>> {
    try {
      await this.sql`
        delete from thoth.files
        where id = ${id}
      `;

      return success(undefined);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Remove, getErrorMessage(error)));
    }
  }

  async deleteFileRows(ids: ReadonlyArray<string>): Promise<Result<void, StoreError>> {
    if (ids.length === 0) {
      return success(undefined);
    }

    try {
      await this.sql`
        delete from thoth.files
        where id = any(${ids as string[]})
      `;

      return success(undefined);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Remove, getErrorMessage(error)));
    }
  }

  async deleteFileRowsByMessageIds(messageIds: ReadonlyArray<string>): Promise<Result<void, StoreError>> {
    if (messageIds.length === 0) {
      return success(undefined);
    }

    try {
      await this.sql`
        delete from thoth.files
        where message_id_bigint = any(${messageIds as string[]}::bigint[])
      `;

      return success(undefined);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Remove, getErrorMessage(error)));
    }
  }
}
