import { ConversationController } from "./controllers/conversation-controller";
import { MessageController } from "./controllers/message-controller";
import { ConversationRepository } from "../repositories/conversation-repository";
import { MessageRepository } from "../repositories/message-repository";

const DEFAULT_CONV_AGENT_PORT = 3001;

const conversationRepository = new ConversationRepository();
const conversationController = new ConversationController(conversationRepository);
const messageRepository = new MessageRepository();
const messageController = new MessageController(messageRepository);

const port = Number(process.env.CONV_AGENT_PORT ?? DEFAULT_CONV_AGENT_PORT);

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

      if (req.method === "PUT") {
        return messageController.update(req);
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
