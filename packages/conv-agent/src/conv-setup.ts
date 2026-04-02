import { R2BlobRepository } from "./adapter/blob/r2-blob-repository";
import { createConversationHttpHandler } from "./adapter/inbound/conversation-http-handler";
import { createPostgresDatabase } from "./adapter/postgres/postgres-database";
import { PostgresConversationRepository } from "./adapter/postgres/postgres-conversation-repository";
import { PostgresAppendUserMessageStore } from "./adapter/postgres/postgres-append-user-message-store";
import { PostgresDeleteConversationGraphStore } from "./adapter/postgres/postgres-delete-conversation-graph-store";
import { PostgresFileRepository } from "./adapter/postgres/postgres-file-repository";
import { PostgresMessageRepository } from "./adapter/postgres/postgres-message-repository";
import { AppendMessageToConversationFlow } from "./application/append-message-to-conversation-flow";
import { CreateConversationFlow } from "./application/create-conversation-flow";
import { DeleteConversationFlow } from "./application/delete-conversation-flow";
import { GetConversationFlow } from "./application/get-conversation-flow";
import { GetMessagesOnConversationFlow } from "./application/get-messages-on-conversation-flow";
import { ListConversationsFlow } from "./application/list-conversations-flow";
import { BlobDomainService } from "./domain/services/blob-domain-service";
import { AppendUserMessageDomainService } from "./domain/services/append-user-message-domain-service";
import { ConversationDomainService } from "./domain/services/conversation-domain-service";
import { DeleteConversationGraphDomainService } from "./domain/services/delete-conversation-graph-domain-service";
import { FileDomainService } from "./domain/services/file-domain-service";
import { GenericValidationService } from "./domain/services/generic-validation-service";
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
    const appendUserMessageStore = new PostgresAppendUserMessageStore(database);
    const deleteConversationGraphStore = new PostgresDeleteConversationGraphStore(database);
    const blobRepository = new R2BlobRepository(input.blobStorage, {
      accessKeyId: input.blobStorage.accessKeyId,
      secretAccessKey: input.blobStorage.secretAccessKey,
    });
    const genericValidationService = new GenericValidationService();
    const conversationDomainService = new ConversationDomainService(conversationRepository, genericValidationService);
    const appendUserMessageDomainService = new AppendUserMessageDomainService(appendUserMessageStore);
    const deleteConversationGraphDomainService = new DeleteConversationGraphDomainService(deleteConversationGraphStore);
    const blobDomainService = new BlobDomainService(blobRepository, genericValidationService);
    const fileDomainService = new FileDomainService(fileRepository, blobDomainService, genericValidationService);
    const messageContentDomainService = new MessageContentDomainService(genericValidationService);
    const messageDomainService = new MessageDomainService(messageRepository, messageContentDomainService, genericValidationService);
    const server = Bun.serve({
      port: input.port,
      fetch: createConversationHttpHandler({
        createConversation: new CreateConversationFlow(conversationDomainService),
        getConversation: new GetConversationFlow(conversationDomainService),
        listConversations: new ListConversationsFlow(conversationDomainService, genericValidationService),
        deleteConversation: new DeleteConversationFlow(deleteConversationGraphDomainService, blobDomainService),
        appendMessageToConversation: new AppendMessageToConversationFlow(
          conversationDomainService,
          appendUserMessageDomainService,
          messageDomainService,
          fileDomainService,
        ),
        getMessagesOnConversation: new GetMessagesOnConversationFlow(conversationDomainService, messageDomainService, fileDomainService, genericValidationService),
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
