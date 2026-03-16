import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createPostgresDatabase } from "./postgres-database";
import { PostgresConversationRepository } from "./postgres-conversation-repository";
import { PostgresFileRepository } from "./postgres-file-repository";
import { PostgresMessageRepository } from "./postgres-message-repository";

const runIntegration =
  process.env.RUN_POSTGRES_INTEGRATION === "1" &&
  typeof process.env.THOTH_TEST_DATABASE_URL === "string" &&
  process.env.THOTH_TEST_DATABASE_URL.length > 0
    ? true
    : false;

if (!runIntegration) {
  test.skip("postgres repositories (integration)", () => {});
} else {
  describe("postgres repositories (integration)", () => {
  const databaseUrl =
    process.env.THOTH_TEST_DATABASE_URL ??
    "postgresql://thoth:thoth@127.0.0.1:5432/thoth";
  const sql = createPostgresDatabase(databaseUrl);
  const conversationRepository = new PostgresConversationRepository(sql);
  const fileRepository = new PostgresFileRepository(sql);
  const messageRepository = new PostgresMessageRepository(sql);

  beforeAll(async () => {
    await sql`select 1`;
  });

  beforeEach(async () => {
    await sql`delete from thoth.message_files`;
    await sql`delete from thoth.messages`;
    await sql`delete from thoth.files`;
    await sql`delete from thoth.conversations`;
  });

  afterAll(async () => {
    await sql.end();
  });

    test("creates, reads, counts, pages, and deletes messages with file associations", async () => {
    const conversationResult = await conversationRepository.create({
      createdAt: new Date("2026-03-16T12:00:00.000Z"),
      updatedAt: new Date("2026-03-16T12:00:00.000Z"),
    });

    expect(conversationResult.ok).toBe(true);
    if (!conversationResult.ok) {
      return;
    }

    const fileOneResult = await fileRepository.create({
      canonicalUrl: "https://blob/file-1",
      filename: "one.txt",
      mimeType: "text/plain",
      sizeInBytes: 3,
      createdAt: new Date("2026-03-16T12:00:01.000Z"),
      updatedAt: new Date("2026-03-16T12:00:01.000Z"),
    });
    const fileTwoResult = await fileRepository.create({
      canonicalUrl: "https://blob/file-2",
      filename: "two.txt",
      mimeType: "text/plain",
      sizeInBytes: 3,
      createdAt: new Date("2026-03-16T12:00:02.000Z"),
      updatedAt: new Date("2026-03-16T12:00:02.000Z"),
    });

    expect(fileOneResult.ok).toBe(true);
    expect(fileTwoResult.ok).toBe(true);
    if (!fileOneResult.ok || !fileTwoResult.ok) {
      return;
    }

    const messageOneResult = await messageRepository.create({
      conversationId: conversationResult.value.id,
      sequenceNumber: 1,
      textContent: "first",
      fileIds: [fileTwoResult.value.id, fileOneResult.value.id],
      createdAt: new Date("2026-03-16T12:00:03.000Z"),
      updatedAt: new Date("2026-03-16T12:00:03.000Z"),
    });
    const messageTwoResult = await messageRepository.create({
      conversationId: conversationResult.value.id,
      sequenceNumber: 2,
      textContent: "second",
      fileIds: [],
      createdAt: new Date("2026-03-16T12:00:04.000Z"),
      updatedAt: new Date("2026-03-16T12:00:04.000Z"),
    });

    expect(messageOneResult.ok).toBe(true);
    expect(messageTwoResult.ok).toBe(true);
    if (!messageOneResult.ok || !messageTwoResult.ok) {
      return;
    }

    const getMessageResult = await messageRepository.getById(messageOneResult.value.id);
    const listMessageResult = await messageRepository.listByConversation(
      conversationResult.value.id,
    );
    const pageMessageResult = await messageRepository.listPageByConversation({
      conversationId: conversationResult.value.id,
      fromSequence: 2,
      limit: 1,
    });
    const countMessageResult = await messageRepository.countByConversation(
      conversationResult.value.id,
    );

    expect(getMessageResult.ok).toBe(true);
    expect(listMessageResult.ok).toBe(true);
    expect(pageMessageResult.ok).toBe(true);
    expect(countMessageResult.ok).toBe(true);
    if (
      !getMessageResult.ok ||
      !listMessageResult.ok ||
      !pageMessageResult.ok ||
      !countMessageResult.ok
    ) {
      return;
    }

    expect(getMessageResult.value.fileIds).toEqual([
      fileTwoResult.value.id,
      fileOneResult.value.id,
    ]);
    expect(listMessageResult.value.map((message) => message.sequenceNumber)).toEqual([
      1,
      2,
    ]);
    expect(pageMessageResult.value.map((message) => message.sequenceNumber)).toEqual([
      2,
    ]);
    expect(countMessageResult.value).toBe(2);

    const deleteMessageResult = await messageRepository.deleteById(
      messageOneResult.value.id,
    );
    const deleteFileResult = await fileRepository.deleteById(fileOneResult.value.id);

    expect(deleteMessageResult.ok).toBe(true);
    expect(deleteFileResult.ok).toBe(true);
  });
  });
}
