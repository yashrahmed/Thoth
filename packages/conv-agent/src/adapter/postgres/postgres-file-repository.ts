import type { FileRepository } from "../../domain/contracts/file-repository";
import { File } from "../../domain/objects/message-types";
import { EntityType, NotFoundError, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, type Result, success } from "../../domain/objects/result";
import type { PostgresDatabase } from "./postgres-database";

interface FileRow {
  readonly id: string;
  readonly message_id: string;
  readonly canonical_url: string;
  readonly filename: string;
  readonly mime_type: string;
  readonly size_in_bytes: number;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

export class PostgresFileRepository implements FileRepository {
  constructor(private readonly sql: PostgresDatabase) {}

  async upsertFileRow(record: Omit<File, "id">) {
    try {
      const rows = await this.sql<FileRow[]>`
        insert into thoth.files (
          message_id,
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
          message_id,
          canonical_url,
          filename,
          mime_type,
          size_in_bytes,
          created_at,
          updated_at
      `;

      return mapRow(rows[0], StoreOperation.Persist);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Persist, getErrorMessage(error)));
    }
  }

  async selectFileRow(id: string): Promise<Result<File, NotFoundError | StoreError>> {
    try {
      const rows = await this.sql<FileRow[]>`
        select
          id,
          message_id,
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

      return mapRow(row, StoreOperation.Read);
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
          message_id,
          canonical_url,
          filename,
          mime_type,
          size_in_bytes,
          created_at,
          updated_at
        from thoth.files
        where id = any(${ids as string[]})
      `;

      return mapRows(rows, StoreOperation.Read);
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
          message_id,
          canonical_url,
          filename,
          mime_type,
          size_in_bytes,
          created_at,
          updated_at
        from thoth.files
        where message_id = any(${messageIds as string[]})
        order by created_at asc, id asc
      `;

      return mapRows(rows, StoreOperation.Read);
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
        where message_id = any(${messageIds as string[]})
      `;

      return success(undefined);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Remove, getErrorMessage(error)));
    }
  }
}

function mapRows(rows: FileRow[], operation: StoreOperation): Result<File[], StoreError> {
  const files: File[] = [];

  for (const row of rows) {
    const result = mapRow(row, operation);

    if (!result.ok) {
      return result;
    }

    files.push(result.value);
  }

  return success(files);
}

function mapRow(row: FileRow | undefined, operation: StoreOperation): Result<File, StoreError> {
  if (!row) {
    return failure(new StoreError(EntityType.File, operation, "File row was not returned."));
  }

  try {
    return success(new File(row.id, row.message_id, row.canonical_url, row.filename, row.mime_type, row.size_in_bytes, toDate(row.created_at), toDate(row.updated_at)));
  } catch (error) {
    if (error instanceof Error) {
      return failure(new StoreError(EntityType.File, operation, error.message));
    }

    return failure(new StoreError(EntityType.File, operation, "Unexpected file mapping error."));
  }
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected database error.";
}
