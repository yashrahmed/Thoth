import type { CreateFileRecord, FileRepository } from "../../domain/contracts/file-repository";
import { File } from "../../domain/objects/file";
import { EntityType, NotFoundError, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, type Result, success } from "../../domain/objects/result";
import type { PostgresDatabase } from "./postgres-database";

interface FileRow {
  readonly id: string;
  readonly canonical_url: string;
  readonly filename: string;
  readonly mime_type: string;
  readonly size_in_bytes: number;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

export class PostgresFileRepository implements FileRepository {
  constructor(private readonly sql: PostgresDatabase) {}

  async upsertFileRow(record: CreateFileRecord) {
    try {
      const rows = await this.sql<FileRow[]>`
        insert into thoth.files (
          canonical_url,
          filename,
          mime_type,
          size_in_bytes,
          created_at,
          updated_at
        )
        values (
          ${record.canonicalUrl},
          ${record.filename},
          ${record.mimeType},
          ${record.sizeInBytes},
          ${record.createdAt.toISOString()},
          ${record.updatedAt.toISOString()}
        )
        returning
          id,
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
}

function mapRow(row: FileRow | undefined, operation: StoreOperation): Result<File, StoreError> {
  if (!row) {
    return failure(new StoreError(EntityType.File, operation, "File row was not returned."));
  }

  try {
    return success(
      new File({
        id: row.id,
        canonicalUrl: row.canonical_url,
        filename: row.filename,
        mimeType: row.mime_type,
        sizeInBytes: row.size_in_bytes,
        createdAt: toDate(row.created_at),
        updatedAt: toDate(row.updated_at),
      }),
    );
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
