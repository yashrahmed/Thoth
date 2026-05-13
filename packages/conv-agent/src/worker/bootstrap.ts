import { S3Client } from "@aws-sdk/client-s3";
import { createConversationHttpHandler } from "../adapter/inbound/conversation-http-handler";
import { R2BlobRepository } from "../adapter/blob/r2-blob-repository";
import { R2FileSignedUrlGenerator } from "../adapter/blob/r2-file-signed-url-generator";
import { PostgresAppendUserMessageStore } from "../adapter/postgres/postgres-append-user-message-store";
import { PostgresConversationRepository } from "../adapter/postgres/postgres-conversation-repository";
import { createPostgresDatabase, type PostgresDatabase } from "../adapter/postgres/postgres-database";
import { PostgresDeleteConversationGraphStore } from "../adapter/postgres/postgres-delete-conversation-graph-store";
import { PostgresFileRepository } from "../adapter/postgres/postgres-file-repository";
import { PostgresMessageRepository } from "../adapter/postgres/postgres-message-repository";
import { OpenAiLlmAdapter } from "../adapter/llm/openai-llm-adapter";
import { AppendMessageToConversationFlow } from "../application/append-message-to-conversation-flow";
import { BackgroundLLMCompletionRunService } from "../domain/services/background-llm-completion-run-service";
import { NoOpLLMCompletionRunService } from "../domain/services/noop-llm-completion-run-service";
import { CreateConversationFlow } from "../application/create-conversation-flow";
import { DeleteConversationFlow } from "../application/delete-conversation-flow";
import { GetConversationFlow } from "../application/get-conversation-flow";
import { GetMessagesOnConversationFlow } from "../application/get-messages-on-conversation-flow";
import { ListConversationsFlow } from "../application/list-conversations-flow";
import { UpdateConvFlow } from "../application/update-conv-flow";
import { AppendUserMessageDomainService } from "../domain/services/append-user-message-domain-service";
import { BlobDomainService } from "../domain/services/blob-domain-service";
import { ConversationDomainService } from "../domain/services/conversation-domain-service";
import { DeleteConversationGraphDomainService } from "../domain/services/delete-conversation-graph-domain-service";
import { FileAccessDomainService } from "../domain/services/file-access-domain-service";
import { FileDomainService } from "../domain/services/file-domain-service";
import { GenericValidationService } from "../domain/services/generic-validation-service";
import { LlmPromptDomainService } from "../domain/services/llm-prompt-domain-service";
import { MessageContentDomainService } from "../domain/services/message-content-domain-service";
import { MessageDomainService } from "../domain/services/message-domain-service";
import type { BlobStorageConfig, LlmConfig } from "../config/config";

export interface WorkerEnv {
  HYPERDRIVE: Hyperdrive;
  BLOB_STORAGE_ENDPOINT: string;
  BLOB_STORAGE_BUCKET: string;
  BLOB_STORAGE_REGION: string;
  BLOB_STORAGE_FOLDER: string;
  BLOB_STORAGE_ACCESS_KEY_ID: string;
  BLOB_STORAGE_SECRET_ACCESS_KEY: string;
  LLM_API_KEY: string;
  TEMP_BEARER_TOKEN: string;
}

interface WorkerDeps {
  readonly httpHandler: (request: Request) => Response | Promise<Response>;
  readonly shutdown: () => Promise<void>;
}

// Cloudflare Workers forbids reusing I/O objects (TCP sockets, streams, etc.) across requests.
// Build the dependency graph (which holds a postgres.js connection) per request.
export function buildWorkerDeps(env: WorkerEnv): WorkerDeps {
  const database = createPostgresDatabase(env.HYPERDRIVE.connectionString);
  const blobStorageConfig: BlobStorageConfig = {
    endpoint: requireString(env.BLOB_STORAGE_ENDPOINT, "BLOB_STORAGE_ENDPOINT"),
    bucket: requireString(env.BLOB_STORAGE_BUCKET, "BLOB_STORAGE_BUCKET"),
    region: requireString(env.BLOB_STORAGE_REGION, "BLOB_STORAGE_REGION"),
    folder: requireString(env.BLOB_STORAGE_FOLDER, "BLOB_STORAGE_FOLDER"),
  };
  const blobStorageCredentials = {
    accessKeyId: requireString(env.BLOB_STORAGE_ACCESS_KEY_ID, "BLOB_STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: requireString(env.BLOB_STORAGE_SECRET_ACCESS_KEY, "BLOB_STORAGE_SECRET_ACCESS_KEY"),
  };

  const blobRepository = new R2BlobRepository(blobStorageConfig, blobStorageCredentials);
  const fileSignedUrlGenerator = new R2FileSignedUrlGenerator(
    {
      ...blobStorageConfig,
    },
    new S3Client({
      endpoint: blobStorageConfig.endpoint,
      region: blobStorageConfig.region,
      credentials: blobStorageCredentials,
      forcePathStyle: true,
    }),
  );
  const llmConfig: LlmConfig = {
    apiKey: requireString(env.LLM_API_KEY, "LLM_API_KEY"),
  };

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

  const llmPromptDomainService = new LlmPromptDomainService();
  const fileAccessDomainService = new FileAccessDomainService(fileSignedUrlGenerator);
  const openAiLlmAdapter = new OpenAiLlmAdapter(llmConfig);

  // Collect background tasks (e.g. LLM completion) here. The worker registers a
  // single ctx.waitUntil(shutdown()) so all background work finishes before the
  // shared postgres connection is closed. Tradeoff vs the prior queue: no retry,
  // no DLQ. Completions can be lost if the isolate is evicted before shutdown.
  const pendingBackgroundTasks: Promise<unknown>[] = [];
  const scheduleBackgroundTask = (task: Promise<unknown>): void => {
    pendingBackgroundTasks.push(
      task.catch((error: unknown) => {
        console.error("[conv-agent] unhandled background task rejection", error);
      }),
    );
  };

  const backgroundCompletionRunService = new BackgroundLLMCompletionRunService(
    messageDomainService,
    fileDomainService,
    fileAccessDomainService,
    openAiLlmAdapter,
    appendUserMessageDomainService,
    llmPromptDomainService,
    scheduleBackgroundTask,
  );
  const noopCompletionRunService = new NoOpLLMCompletionRunService();

  const shutdown = async (): Promise<void> => {
    if (pendingBackgroundTasks.length > 0) {
      await Promise.allSettled(pendingBackgroundTasks);
    }
    await database.end({ timeout: 5 });
  };

  const httpHandler = createConversationHttpHandler({
    tempBearerToken: requireString(env.TEMP_BEARER_TOKEN, "TEMP_BEARER_TOKEN"),
    createConversation: new CreateConversationFlow(conversationDomainService),
    getConversation: new GetConversationFlow(conversationDomainService),
    listConversations: new ListConversationsFlow(conversationDomainService, genericValidationService),
    updateConv: new UpdateConvFlow(conversationDomainService),
    deleteConversation: new DeleteConversationFlow(deleteConversationGraphDomainService, blobDomainService),
    appendMessageToConversation: new AppendMessageToConversationFlow(
      conversationDomainService,
      appendUserMessageDomainService,
      messageDomainService,
      fileDomainService,
      backgroundCompletionRunService,
    ),
    // The /append-direct route persists user messages without triggering an LLM completion,
    // so it shares the append flow but uses a no-op runner.
    appendMessageDirect: new AppendMessageToConversationFlow(
      conversationDomainService,
      appendUserMessageDomainService,
      messageDomainService,
      fileDomainService,
      noopCompletionRunService,
    ),
    getMessagesOnConversation: new GetMessagesOnConversationFlow(conversationDomainService, messageDomainService, fileDomainService, genericValidationService),
  });

  return { httpHandler, shutdown };
}

function requireString(value: string | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}
