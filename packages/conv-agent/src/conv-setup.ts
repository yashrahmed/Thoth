import { R2BlobRepository } from "./adapter/blob/r2-blob-repository";
import { createConversationHttpHandler } from "./adapter/inbound/conversation-http-handler";
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
import { MessageDomainService } from "./domain/services/message-domain-service";

export interface ConvSetupBlobStorage {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly folder: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface ConvSetupInput {
  readonly port: number;
  readonly databaseUrl: string;
  readonly blobStorage: ConvSetupBlobStorage;
}

export interface ConvSetupResult {
  readonly server: Bun.Server<undefined>;
  stop(): Promise<void>;
}

export async function convSetup(
  input: ConvSetupInput,
): Promise<ConvSetupResult> {
  const database = createPostgresDatabase(input.databaseUrl);

  try {
    const conversationRepository = new PostgresConversationRepository(database);
    const messageRepository = new PostgresMessageRepository(database);
    const fileRepository = new PostgresFileRepository(database);
    const blobRepository = new R2BlobRepository(input.blobStorage, {
      accessKeyId: input.blobStorage.accessKeyId,
      secretAccessKey: input.blobStorage.secretAccessKey,
    });
    const conversationDomainService = new ConversationDomainService(
      conversationRepository,
    );
    const blobDomainService = new BlobDomainService(blobRepository);
    const fileDomainService = new FileDomainService(
      fileRepository,
      blobDomainService,
    );
    const messageDomainService = new MessageDomainService(messageRepository);
    const server = Bun.serve({
      port: input.port,
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
