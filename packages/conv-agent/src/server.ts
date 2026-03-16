import { getConvAgentConfig } from "@thoth/config";
import { createConversationHttpHandler } from "./adapter/inbound/conversation-http-handler";
import { R2BlobRepository } from "./adapter/blob/r2-blob-repository";
import { PostgresFileRepository } from "./adapter/postgres/postgres-file-repository";
import { CreateConversationFlow } from "./application/create-conversation-flow";
import { DeleteConversationFlow } from "./application/delete-conversation-flow";
import { GetConversationFlow } from "./application/get-conversation-flow";
import { AppendMessageToConversationFlow } from "./application/append-message-to-conversation-flow";
import { GetMessagesOnConversationFlow } from "./application/get-messages-on-conversation-flow";
import { ListConversationsFlow } from "./application/list-conversations-flow";
import { createPostgresDatabase } from "./adapter/postgres/postgres-database";
import { PostgresConversationRepository } from "./adapter/postgres/postgres-conversation-repository";
import { PostgresMessageRepository } from "./adapter/postgres/postgres-message-repository";
import { BlobDomainService } from "./domain/services/blob-domain-service";
import { ConversationDomainService } from "./domain/services/conversation-domain-service";
import { FileDomainService } from "./domain/services/file-domain-service";
import { MessageDomainService } from "./domain/services/message-domain-service";

const config = getConvAgentConfig();
const database = createPostgresDatabase(config.databaseUrl);
const conversationRepository = new PostgresConversationRepository(database);
const messageRepository = new PostgresMessageRepository(database);
const fileRepository = new PostgresFileRepository(database);
const blobRepository = new R2BlobRepository(config.blobStorage, {
  accessKeyId: config.blobStorage.accessKeyId,
  secretAccessKey: config.blobStorage.secretAccessKey,
});
const conversationDomainService = new ConversationDomainService(conversationRepository);
const blobDomainService = new BlobDomainService(blobRepository);
const fileDomainService = new FileDomainService(fileRepository, blobDomainService);
const messageDomainService = new MessageDomainService(messageRepository);

const server = Bun.serve({
  port: config.port,
  fetch: createConversationHttpHandler(
    new CreateConversationFlow(conversationDomainService),
    new GetConversationFlow(conversationDomainService),
    new ListConversationsFlow(conversationDomainService),
    new DeleteConversationFlow(
      conversationDomainService,
      messageDomainService,
      fileDomainService,
    ),
    new AppendMessageToConversationFlow(
      conversationDomainService,
      messageDomainService,
      fileDomainService,
    ),
    new GetMessagesOnConversationFlow(
      conversationDomainService,
      messageDomainService,
      fileDomainService,
    ),
  ),
});

console.log(`Thoth conv-agent running at http://localhost:${server.port}`);
