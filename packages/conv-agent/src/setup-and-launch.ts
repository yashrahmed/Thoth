import { SQSClient } from "@aws-sdk/client-sqs";
import type { ConvAgentBlobStorageConfig, ConvAgentConfig, ConvAgentDatabaseConfig, ConvAgentLlmDispatchQueueConfig } from "./config/config";
import { SqsLlmCompletionListener } from "./adapter/inbound/sqs-llm-completion-listener";
import { createConversationHttpHandler } from "./adapter/inbound/conversation-http-handler";
import { PlaceholderLlmRepository } from "./adapter/llm/placeholder-llm-repository";
import { createPostgresDatabase, type PostgresDatabase } from "./adapter/postgres/postgres-database";
import { PostgresConversationRepository } from "./adapter/postgres/postgres-conversation-repository";
import { PostgresAppendUserMessageStore } from "./adapter/postgres/postgres-append-user-message-store";
import { PostgresDeleteConversationGraphStore } from "./adapter/postgres/postgres-delete-conversation-graph-store";
import { PostgresFileRepository } from "./adapter/postgres/postgres-file-repository";
import { PostgresMessageRepository } from "./adapter/postgres/postgres-message-repository";
import { R2BlobRepository } from "./adapter/blob/r2-blob-repository";
import { SqsLlmCompletionDispatcher } from "./adapter/sqs/sqs-llm-completion-dispatcher";
import { AppendMessageToConversationFlow } from "./application/append-message-to-conversation-flow";
import { CreateConversationFlow } from "./application/create-conversation-flow";
import { DeleteConversationFlow } from "./application/delete-conversation-flow";
import { GetConversationFlow } from "./application/get-conversation-flow";
import { GetMessagesOnConversationFlow } from "./application/get-messages-on-conversation-flow";
import { ListConversationsFlow } from "./application/list-conversations-flow";
import { LlmCompletionFlow } from "./application/llm-completion-flow";
import { BlobDomainService } from "./domain/services/blob-domain-service";
import { AppendUserMessageDomainService } from "./domain/services/append-user-message-domain-service";
import { ConversationDomainService } from "./domain/services/conversation-domain-service";
import { DeleteConversationGraphDomainService } from "./domain/services/delete-conversation-graph-domain-service";
import { FileDomainService } from "./domain/services/file-domain-service";
import { GenericValidationService } from "./domain/services/generic-validation-service";
import { LlmCompletionDispatchDomainService } from "./domain/services/llm-completion-dispatch-domain-service";
import { LlmDomainService } from "./domain/services/llm-domain-service";
import { MessageContentDomainService } from "./domain/services/message-content-domain-service";
import { MessageDomainService } from "./domain/services/message-domain-service";

export interface SetupAndLaunchResult {
  readonly database: PostgresDatabase;
  readonly server: Bun.Server<undefined>;
  stop(): Promise<void>;
}

export async function setupAndLaunch(config: ConvAgentConfig): Promise<SetupAndLaunchResult> {
  const databaseCredentials = requireDatabaseCredentials(config.database);
  const llmDispatchQueueCredentials = requireAccessKeyCredentials(config.llmDispatchQueue, "llmDispatchQueue");
  const blobStorageCredentials = requireAccessKeyCredentials(config.blobStorage, "blobStorage");
  const database = createPostgresDatabase(config.database.url, databaseCredentials);
  let sqsClient: SQSClient | undefined;

  try {
    sqsClient = new SQSClient({
      credentials: {
        accessKeyId: llmDispatchQueueCredentials.accessKeyId,
        secretAccessKey: llmDispatchQueueCredentials.secretAccessKey,
      },
      endpoint: config.llmDispatchQueue.endpoint,
      region: config.llmDispatchQueue.region,
    });

    const blobRepository = new R2BlobRepository(config.blobStorage, {
      accessKeyId: blobStorageCredentials.accessKeyId,
      secretAccessKey: blobStorageCredentials.secretAccessKey,
    });

    const queueUrl = await resolveQueueUrl(config.llmDispatchQueue);
    const conversationRepository = new PostgresConversationRepository(database);
    const messageRepository = new PostgresMessageRepository(database);
    const fileRepository = new PostgresFileRepository(database);
    const appendUserMessageStore = new PostgresAppendUserMessageStore(database);
    const deleteConversationGraphStore = new PostgresDeleteConversationGraphStore(database);
    const genericValidationService = new GenericValidationService();
    const conversationDomainService = new ConversationDomainService(conversationRepository, genericValidationService);
    const appendUserMessageDomainService = new AppendUserMessageDomainService(appendUserMessageStore);
    const deleteConversationGraphDomainService = new DeleteConversationGraphDomainService(deleteConversationGraphStore);
    const blobDomainService = new BlobDomainService(blobRepository, genericValidationService);
    const fileDomainService = new FileDomainService(fileRepository, blobDomainService, genericValidationService);
    const messageContentDomainService = new MessageContentDomainService(genericValidationService);
    const messageDomainService = new MessageDomainService(messageRepository, messageContentDomainService, genericValidationService);
    const llmCompletionDispatcher = new SqsLlmCompletionDispatcher(sqsClient, queueUrl);
    const llmCompletionDispatchDomainService = new LlmCompletionDispatchDomainService(llmCompletionDispatcher);
    const llmCompletionFlow = new LlmCompletionFlow(messageDomainService, new LlmDomainService(new PlaceholderLlmRepository()), appendUserMessageDomainService);
    const sqsLlmCompletionListener = new SqsLlmCompletionListener(sqsClient, queueUrl, llmCompletionFlow);

    sqsLlmCompletionListener.start();

    const server = Bun.serve({
      port: config.port,
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
          llmCompletionDispatchDomainService,
        ),
        getMessagesOnConversation: new GetMessagesOnConversationFlow(conversationDomainService, messageDomainService, fileDomainService, genericValidationService),
      }),
    });
    let stopped = false;

    return {
      database,
      server,
      async stop() {
        if (stopped) {
          return;
        }

        stopped = true;

        try {
          sqsClient?.destroy();
          await sqsLlmCompletionListener.stop();
          await server.stop(true);
        } finally {
          await database.end();
        }
      },
    };
  } catch (error) {
    sqsClient?.destroy();
    await database.end();
    throw error;
  }
}

function requireDatabaseCredentials(config: ConvAgentDatabaseConfig): { readonly username: string; readonly password: string } {
  if (config.credentials === null) {
    throw new Error("database credentials must be populated before launch.");
  }

  return config.credentials;
}

function requireAccessKeyCredentials(
  config: ConvAgentBlobStorageConfig | ConvAgentLlmDispatchQueueConfig,
  configName: string,
): { readonly accessKeyId: string; readonly secretAccessKey: string } {
  if (config.credentials === null) {
    throw new Error(`${configName} credentials must be populated before launch.`);
  }

  return config.credentials;
}

async function resolveQueueUrl(config: ConvAgentLlmDispatchQueueConfig): Promise<string> {
  if (config.queueUrl) {
    return config.queueUrl;
  }

  if (config.bootstrap?.createQueue && config.endpoint && config.bootstrap.queueName) {
    return createQueueViaQueryApi(config.endpoint, config.bootstrap.queueName);
  }

  throw new Error("llmDispatchQueue.queueUrl is required when queue bootstrap is not enabled.");
}

async function createQueueViaQueryApi(endpoint: string, queueName: string): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      Action: "CreateQueue",
      QueueName: queueName,
      Version: "2012-11-05",
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`SQS queue creation failed with status ${response.status}.`);
  }

  const responseText = await response.text();
  const queueUrlMatch = responseText.match(/<QueueUrl>([^<]+)<\/QueueUrl>/);

  if (!queueUrlMatch?.[1]) {
    throw new Error("SQS queue URL was not returned.");
  }

  return queueUrlMatch[1];
}
