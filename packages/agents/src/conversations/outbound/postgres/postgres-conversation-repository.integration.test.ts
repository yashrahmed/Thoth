import { describe, expect, test } from "bun:test";
import {
  Attachment,
  AttachmentId,
  Conversation,
  ConversationId,
  MessageId,
} from "@thoth/entities";
import { createConvStorePool } from "./create-conv-store-pool";
import { PostgresConversationRepository } from "./postgres-conversation-repository";

const dbConfig = getOptionalDbConfig();
const maybeTest = dbConfig ? test : test.skip;

describe("PostgresConversationRepository integration", () => {
  maybeTest("persists and hydrates a conversation aggregate", async () => {
    const pool = createConvStorePool(dbConfig!);
    const repository = new PostgresConversationRepository(pool);
    const conversationId = new ConversationId(crypto.randomUUID());
    const createdAt = new Date("2026-03-11T18:00:00.000Z");
    const attachment = new Attachment({
      id: new AttachmentId(crypto.randomUUID()),
      objectKey: `conversations/${conversationId.value}/message-1/attachment-1.txt`,
      originalFilename: "attachment.txt",
      mediaType: "text/plain",
      byteSize: 4,
      createdAt: new Date("2026-03-11T18:01:00.000Z"),
    });
    const draftConversation = Conversation.createNew({
      id: conversationId,
      createdAt,
    });

    draftConversation.postMessage({
      id: new MessageId(crypto.randomUUID()),
      role: "user",
      textContent: "hello",
      attachments: [attachment],
      occurredAt: new Date("2026-03-11T18:01:00.000Z"),
    });

    const conversation = draftConversation.withUpdatedTimestamp(
      new Date("2026-03-11T18:01:00.000Z"),
    );

    try {
      await repository.save(conversation);

      const loaded = await repository.getById(conversationId);

      expect(loaded?.messages).toHaveLength(1);
      expect(loaded?.messages[0]?.attachments).toHaveLength(1);

      await repository.delete(conversationId);
      expect(await repository.getById(conversationId)).toBeNull();
    } finally {
      await pool.end();
    }
  });
});

function getOptionalDbConfig() {
  const host = process.env.CONV_STORE_DB_HOST;
  const port = process.env.CONV_STORE_DB_PORT;
  const database = process.env.CONV_STORE_DB_NAME;
  const user = process.env.CONV_STORE_DB_USER;
  const password = process.env.CONV_STORE_DB_PASSWORD;
  const ssl = process.env.CONV_STORE_DB_SSL;

  if (!host || !port || !database || !user || !password || !ssl) {
    return null;
  }

  return {
    host,
    port: Number(port),
    database,
    user,
    password,
    ssl: ssl === "true",
  };
}
