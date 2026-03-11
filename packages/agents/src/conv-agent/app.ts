import { getPortsConfig } from "@thoth/config";
import { ConversationController } from "./controllers/conversation-controller";
import { MessageController } from "./controllers/message-controller";
import { TestResponseController } from "./controllers/test-response-controller";
import { ConversationRepository } from "../repositories/conversation-repository";
import { MessageRepository } from "../repositories/message-repository";
import { GenerateResponseService } from "../services/generate-response-service";
import { OpenAiLlmService } from "../services/openai-llm-service";

export function createConvAgentFetchHandler(
  conversationController: ConversationController = new ConversationController(
    new ConversationRepository(),
  ),
  messageController: MessageController = new MessageController(
    new MessageRepository(),
  ),
  testResponseController: TestResponseController = new TestResponseController(
    new GenerateResponseService(new OpenAiLlmService()),
  ),
) {
  return async function fetch(req: Request): Promise<Response> {
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

    if (url.pathname === "/test/responses") {
      if (req.method === "POST") {
        return testResponseController.create(req);
      }

      return Response.json(
        {
          error: `Method ${req.method} is not supported on /test/responses.`,
        },
        { status: 405 },
      );
    }

    return Response.json({ name: "conv-agent", version: "0.0.1" });
  };
}

export function createConvAgentServer() {
  const port = getPortsConfig().convAgent;

  return Bun.serve({
    port,
    fetch: createConvAgentFetchHandler(),
  });
}
