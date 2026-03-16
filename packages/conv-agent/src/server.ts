import { getConvAgentConfig } from "@thoth/config";
import { CreateConversationFlow } from "./application/create-conversation-flow";
import { DeleteConversationFlow } from "./application/delete-conversation-flow";
import { GetConversationFlow } from "./application/get-conversation-flow";
import { ListConversationsFlow } from "./application/list-conversations-flow";
import { createPostgresDatabase } from "./adapter/postgres/postgres-database";
import { PostgresConversationRepository } from "./adapter/postgres/postgres-conversation-repository";
import { createConvAgentFetchHandler } from "./setup";

const repository = new PostgresConversationRepository(
  createPostgresDatabase(getConvAgentConfig().databaseUrl),
);

const server = Bun.serve({
  port: getConvAgentConfig().port,
  fetch: createConvAgentFetchHandler(
    new CreateConversationFlow(repository),
    new GetConversationFlow(repository),
    new ListConversationsFlow(repository),
    new DeleteConversationFlow(repository),
  ),
});

console.log(`Thoth conv-agent running at http://localhost:${server.port}`);
