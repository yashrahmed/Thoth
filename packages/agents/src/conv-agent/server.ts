import { ConversationController } from "./controllers/conversation-controller";
import { MessageController } from "./controllers/message-controller";
import { PostgresConversationRepository } from "../repositories/postgres-conversation-repository";
import { PostgresFileRepository } from "../repositories/postgres-file-repository";
import { PostgresMessageRepository } from "../repositories/postgres-message-repository";
import { createConvStorePool } from "../repositories/conv-store-database";
import { getPortsConfig } from "@thoth/config";
import { R2BlobRepository } from "../repositories/r2-blob-repository";
import { ConversationService } from "../services/conversation-service";
import { FileService } from "../services/file-service";
import { MessageService } from "../services/message-service";

const convStorePool = createConvStorePool();
const fileRepository = new PostgresFileRepository(convStorePool);
const messageRepository = new PostgresMessageRepository(
  convStorePool,
  fileRepository,
);
const conversationRepository = new PostgresConversationRepository(convStorePool);
const blobRepository = new R2BlobRepository();
const fileService = new FileService(fileRepository, blobRepository);
const conversationService = new ConversationService(
  conversationRepository,
  messageRepository,
  fileService,
);
const messageService = new MessageService(messageRepository, fileService);
const conversationController = new ConversationController(conversationService);
const messageController = new MessageController(messageService);

const port = getPortsConfig().convAgent;

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "conv-agent" });
    }

    if (url.pathname === "/messages") {
      if (req.method === "POST") {
        return messageController.insert(req);
      }

      if (req.method === "DELETE") {
        return messageController.delete(req);
      }

      if (req.method === "GET") {
        return messageController.showAll(req);
      }

      return Response.json(
        { error: `Method ${req.method} is not supported on /messages.` },
        { status: 405 },
      );
    }

    if (url.pathname === "/conversations") {
      if (req.method === "POST") {
        return conversationController.insert(req);
      }

      if (req.method === "PUT") {
        return conversationController.update(req);
      }

      if (req.method === "DELETE") {
        return conversationController.delete(req);
      }

      if (req.method === "GET") {
        return conversationController.show(req);
      }

      return Response.json(
        { error: `Method ${req.method} is not supported on /conversations.` },
        { status: 405 },
      );
    }

    return Response.json({ name: "conv-agent", version: "0.0.1" });
  },
});

console.log(`Thoth conv-agent running at http://localhost:${server.port}`);
