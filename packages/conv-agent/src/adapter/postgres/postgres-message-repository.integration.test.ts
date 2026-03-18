import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgresConversationRepository } from "./postgres-conversation-repository";
import { createPostgresDatabase } from "./postgres-database";
import { PostgresFileRepository } from "./postgres-file-repository";
import { PostgresMessageRepository } from "./postgres-message-repository";

const databaseUrl = process.env.DATABASE_URL;
const dbTest = databaseUrl ? test : test.skip;

dbTest("Postgres repositories migrate and round-trip rich messages", async () => {
  const sql = createPostgresDatabase(databaseUrl!);

  try {
    await sql.unsafe("drop schema if exists thoth cascade");
    await runMigration(sql, "db/migrations/V1__create_thoth_schema.sql");
    await runMigration(
      sql,
      "db/migrations/V6__recreate_message_and_file_store_for_rich_messages.sql",
    );

    const conversationRepository = new PostgresConversationRepository(sql);
    const fileRepository = new PostgresFileRepository(sql);
    const messageRepository = new PostgresMessageRepository(sql);
    const timestamp = new Date("2026-03-16T12:00:00.000Z");

    const conversationResult = await conversationRepository.upsertConversationRow({
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(conversationResult.ok).toBe(true);
    if (!conversationResult.ok) {
      return;
    }

    const fileResult = await fileRepository.upsertFileRow({
      canonicalUrl: "/conversations/test/file-1.txt",
      filename: "file-1.txt",
      mimeType: "text/plain",
      sizeInBytes: 5,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(fileResult.ok).toBe(true);
    if (!fileResult.ok) {
      return;
    }

    const messageResult = await messageRepository.upsertMessageRow({
      conversationId: conversationResult.value.id,
      type: "assistant",
      sequenceNumber: 1,
      content: [{ type: "text", text: "hello" }],
      toolCalls: [{ id: "tool-call-1", name: "search", args: { q: "hello" } }],
      toolCallId: "tool-call-1",
      fileIds: [fileResult.value.id],
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(messageResult.ok).toBe(true);
    if (!messageResult.ok) {
      return;
    }

    const readResult = await messageRepository.selectMessageRow(messageResult.value.id);
    const pageResult = await messageRepository.selectMessagePage({
      conversationId: conversationResult.value.id,
      fromSequence: 1,
      pageSize: 10,
    });
    const listResult = await messageRepository.selectAllMessagesByConversation(
      conversationResult.value.id,
    );
    const countResult = await messageRepository.countMessagesByConversation(
      conversationResult.value.id,
    );

    expect(readResult.ok).toBe(true);
    expect(pageResult.ok).toBe(true);
    expect(listResult.ok).toBe(true);
    expect(countResult).toEqual({ ok: true, value: 1 });
    if (!readResult.ok || !pageResult.ok || !listResult.ok) {
      return;
    }

    expect(readResult.value.type).toBe("assistant");
    expect(readResult.value.content).toEqual([{ type: "text", text: "hello" }]);
    expect(readResult.value.toolCalls).toEqual([
      { id: "tool-call-1", name: "search", args: { q: "hello" } },
    ]);
    expect(readResult.value.toolCallId).toBe("tool-call-1");
    expect(readResult.value.fileIds).toEqual([fileResult.value.id]);
    expect(pageResult.value).toHaveLength(1);
    expect(listResult.value).toHaveLength(1);

    const deleteResult = await messageRepository.deleteMessageRow(messageResult.value.id);
    const missingResult = await messageRepository.selectMessageRow(messageResult.value.id);

    expect(deleteResult).toEqual({ ok: true, value: undefined });
    expect(missingResult.ok).toBe(false);
    if (missingResult.ok) {
      return;
    }
    expect(missingResult.error.kind).toBe("NotFoundError");
  } finally {
    await sql.unsafe("drop schema if exists thoth cascade");
    await sql.end();
  }
});

async function runMigration(
  sql: ReturnType<typeof createPostgresDatabase>,
  relativePath: string,
): Promise<void> {
  const filePath = resolve(process.cwd(), relativePath);
  const statements = readFileSync(filePath, "utf8")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await sql.unsafe(statement);
  }
}
