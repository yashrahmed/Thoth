import { describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { FileRepository } from "./file-repository";
import { MessageRepository } from "./message-repository";

const dbConfig = getOptionalDbConfig();
const maybeTest = dbConfig ? test : test.skip;

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

describe("FileRepository integration", () => {
  maybeTest("persists file metadata and hydrates message reads with files", async () => {
    const pool = new Pool(dbConfig!);
    const fileRepository = new FileRepository(dbConfig!);
    const messageRepository = new MessageRepository(dbConfig!, fileRepository);
    const conversationId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const now = new Date("2026-03-10T12:00:00.000Z");

    try {
      await pool.query(
        `
          INSERT INTO public.conversations (
            id,
            last_create_ts,
            last_update_ts
          )
          VALUES ($1, $2, $3)
        `,
        [conversationId, now, now],
      );
      await pool.query(
        `
          INSERT INTO public.messages (
            id,
            conversation_id,
            type,
            text_content,
            last_create_ts,
            last_update_ts
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [messageId, conversationId, "user", "hello", now, now],
      );

      await fileRepository.create(
        {
          id: crypto.randomUUID(),
          object_key: `conversations/${crypto.randomUUID()}.png`,
          original_filename: "hello.png",
          byte_size: 4,
          last_create_ts: now,
        },
        messageId,
      );

      const files = await fileRepository.listByMessageId(messageId);
      const hydratedMessage = await messageRepository.getMessageById(messageId);

      expect(files).toHaveLength(1);
      expect(hydratedMessage?.files).toHaveLength(1);

      await messageRepository.deleteMessage(messageId, conversationId);

      expect(await fileRepository.listByMessageId(messageId)).toEqual([]);
    } finally {
      await pool.query(
        `
          DELETE FROM public.conversations
          WHERE id = $1
        `,
        [conversationId],
      );
      await pool.end();
    }
  });
});
