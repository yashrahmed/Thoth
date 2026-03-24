import { R2BlobRepository } from "./adapter/blob/r2-blob-repository";
import { createConversationHttpHandler } from "./adapter/inbound/conversation-http-handler";
import { PlaceholderLlmRepository } from "./adapter/llm/placeholder-llm-repository";
import { createPostgresDatabase } from "./adapter/postgres/postgres-database";
import { PostgresConversationRepository } from "./adapter/postgres/postgres-conversation-repository";
import { PostgresFileRepository } from "./adapter/postgres/postgres-file-repository";
import { PostgresMessageRepository } from "./adapter/postgres/postgres-message-repository";
import { AppendMessageToConversationFlow } from "./application/append-message-to-conversation-flow";
import { CreateConversationFlow } from "./application/create-conversation-flow";
import { DeleteConversationFlow } from "./application/delete-conversation-flow";
import { GetConversationFlow } from "./application/get-conversation-flow";
import { GetMessagesOnConversationFlow } from "./application/get-messages-on-conversation-flow";
import { ListConversationsFlow } from "./application/list-conversations-flow";
import { BlobDomainService } from "./domain/services/blob-domain-service";
import { ConversationDomainService } from "./domain/services/conversation-domain-service";
import { FileDomainService } from "./domain/services/file-domain-service";
import { LlmDomainService } from "./domain/services/llm-domain-service";
import { MessageContentDomainService } from "./domain/services/message-content-domain-service";
import { MessageDomainService } from "./domain/services/message-domain-service";

interface ConvSetupBlobStorage {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly folder: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

interface ConvSetupInput {
  readonly port: number;
  readonly databaseUrl: string;
  readonly blobStorage: ConvSetupBlobStorage;
}

export interface ConvSetupResult {
  readonly server: Bun.Server<undefined>;
  stop(): Promise<void>;
}

export async function convSetup(input: ConvSetupInput): Promise<ConvSetupResult> {
  const database = createPostgresDatabase(input.databaseUrl);

  try {
    const conversationRepository = new PostgresConversationRepository(database);
    const messageRepository = new PostgresMessageRepository(database);
    const fileRepository = new PostgresFileRepository(database);
    const blobRepository = new R2BlobRepository(input.blobStorage, {
      accessKeyId: input.blobStorage.accessKeyId,
      secretAccessKey: input.blobStorage.secretAccessKey,
    });
    const conversationDomainService = new ConversationDomainService(conversationRepository);
    const blobDomainService = new BlobDomainService(blobRepository);
    const llmDomainService = new LlmDomainService(new PlaceholderLlmRepository());
    const fileDomainService = new FileDomainService(fileRepository, blobDomainService);
    const messageContentDomainService = new MessageContentDomainService();
    const messageDomainService = new MessageDomainService(messageRepository, messageContentDomainService);
    const server = Bun.serve({
      port: input.port,
      fetch: createConversationHttpHandler({
        createConversation: new CreateConversationFlow(conversationDomainService),
        getConversation: new GetConversationFlow(conversationDomainService),
        listConversations: new ListConversationsFlow(conversationDomainService),
        deleteConversation: new DeleteConversationFlow(conversationDomainService, messageDomainService, fileDomainService),
        appendMessageToConversation: new AppendMessageToConversationFlow(conversationDomainService, messageDomainService, fileDomainService, llmDomainService),
        getMessagesOnConversation: new GetMessagesOnConversationFlow(conversationDomainService, messageDomainService, fileDomainService),
      }),
    });
    let stopped = false;

    return {
      server,
      async stop() {
        if (stopped) {
          return;
        }

        stopped = true;

        try {
          await server.stop(true);
        } finally {
          await database.end();
        }
      },
    };
  } catch (error) {
    await database.end();
    throw error;
  }
}
