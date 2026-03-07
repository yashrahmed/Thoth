import { MessageController } from "./controllers/message-controller";
import { MessageRepository } from "../repositories/message-repository";

const DEFAULT_CONV_AGENT_PORT = 3001;

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

    return Response.json({ name: "conv-agent", version: "0.0.1" });
  },
});

console.log(`Thoth conv-agent running at http://localhost:${server.port}`);
