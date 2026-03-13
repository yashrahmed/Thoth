import { getPortsConfig } from "@thoth/config";
import { ConversationsService } from "../application/conversations-service";
import { ConversationsController } from "../inbound/http/conversations-controller";
import { R2BlobStore } from "../outbound/blob/r2-blob-store";
import { createConvStorePool } from "../outbound/postgres/create-conv-store-pool";
import { PostgresConversationRepository } from "../outbound/postgres/postgres-conversation-repository";

const pool = createConvStorePool();
const conversationRepository = new PostgresConversationRepository(pool);
const blobStore = new R2BlobStore();
const conversationsService = new ConversationsService(
  conversationRepository,
  blobStore,
);
const conversationsController = new ConversationsController(conversationsService);
const port = getPortsConfig().convAgent;

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "conv-agent" });
    }

    if (url.pathname === "/") {
      return Response.json({
        name: "conv-agent",
        version: "2.0.0",
        capabilities: ["conversations"],
      });
    }

    if (url.pathname.startsWith("/conversations")) {
      return conversationsController.handle(req);
    }

    return Response.json(
      { error: `Route ${req.method} ${url.pathname} is not supported.` },
      { status: 404 },
    );
  },
});

console.log(`Thoth conv-agent running at http://localhost:${server.port}`);
