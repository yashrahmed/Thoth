import type { File as DomainFile, FileId, MessageId } from "@thoth/entities";
import type { FileRepository as FileRepositoryContract } from "@thoth/contracts";
import { Pool } from "pg";
import {
  getConvStoreDatabaseConfig,
} from "./conv-store-database";

interface FileRow {
  id: string;
  message_id: string;
  object_key: string;
  original_filename: string;
  byte_size: string | number;
  last_create_ts: Date;
}

export class FileRepository implements FileRepositoryContract {
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

  async create(file: DomainFile, messageId: MessageId): Promise<DomainFile> {
    const result = await this.pool.query<FileRow>(
      `
        INSERT INTO public.files (
          id,
          message_id,
          object_key,
          original_filename,
          byte_size,
          last_create_ts
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          id,
          message_id,
          object_key,
          original_filename,
          byte_size,
          last_create_ts
      `,
      [
        file.id,
        messageId,
        file.object_key,
        file.original_filename,
        file.byte_size,
        file.last_create_ts,
      ],
    );

    return this.mapRowToFile(result.rows[0]);
  }

  async getById(fileId: FileId): Promise<DomainFile | null> {
    const result = await this.pool.query<FileRow>(
      `
        SELECT
          id,
          message_id,
          object_key,
          original_filename,
          byte_size,
          last_create_ts
        FROM public.files
        WHERE id = $1
      `,
      [fileId],
    );

    return result.rows[0] ? this.mapRowToFile(result.rows[0]) : null;
  }

  async listByMessageId(messageId: MessageId): Promise<DomainFile[]> {
    const rows = await this.listRowsByMessageIds([messageId]);

    return rows.get(messageId) ?? [];
  }

  async getByObjectKey(objectKey: string): Promise<DomainFile | null> {
    const result = await this.pool.query<FileRow>(
      `
        SELECT
          id,
          message_id,
          object_key,
          original_filename,
          byte_size,
          last_create_ts
        FROM public.files
        WHERE object_key = $1
      `,
      [objectKey],
    );

    return result.rows[0] ? this.mapRowToFile(result.rows[0]) : null;
  }

  async delete(fileId: FileId): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM public.files
        WHERE id = $1
      `,
      [fileId],
    );
  }

  async listByMessageIds(
    messageIds: MessageId[],
  ): Promise<Map<MessageId, DomainFile[]>> {
    return this.listRowsByMessageIds(messageIds);
  }

  private async listRowsByMessageIds(
    messageIds: MessageId[],
  ): Promise<Map<MessageId, DomainFile[]>> {
    if (messageIds.length === 0) {
      return new Map();
    }

    const result = await this.pool.query<FileRow>(
      `
        SELECT
          id,
          message_id,
          object_key,
          original_filename,
          byte_size,
          last_create_ts
        FROM public.files
        WHERE message_id = ANY($1::uuid[])
        ORDER BY last_create_ts ASC, id ASC
      `,
      [messageIds],
    );

    const filesByMessageId = new Map<MessageId, DomainFile[]>();

    for (const row of result.rows) {
      const files = filesByMessageId.get(row.message_id) ?? [];
      files.push(this.mapRowToFile(row));
      filesByMessageId.set(row.message_id, files);
    }

    return filesByMessageId;
  }

  private mapRowToFile(row: FileRow): DomainFile {
    return {
      id: row.id,
      object_key: row.object_key,
      original_filename: row.original_filename,
      byte_size: Number(row.byte_size),
      last_create_ts: new Date(row.last_create_ts),
    };
  }
}
