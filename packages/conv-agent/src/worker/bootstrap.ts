import { S3Client } from "@aws-sdk/client-s3";
import { createConversationHttpHandler } from "../adapter/inbound/conversation-http-handler";
import { AccessJwtVerificationService } from "../adapter/inbound/services/access-jwt-verification-service";
import { StaticAccessIdentityAuthorizer } from "../adapter/inbound/services/static-access-identity-authorizer";
import { R2BlobRepository } from "../adapter/blob/r2-blob-repository";
import { R2FileSignedUrlGenerator } from "../adapter/blob/r2-file-signed-url-generator";
import { PostgresAppendUserMessageStore } from "../adapter/postgres/postgres-append-user-message-store";
import { PostgresConversationRepository } from "../adapter/postgres/postgres-conversation-repository";
import { createPostgresDatabase } from "../adapter/postgres/postgres-database";
import { PostgresDeleteConversationStore } from "../adapter/postgres/postgres-delete-conversation-store";
import { PostgresFileRepository } from "../adapter/postgres/postgres-file-repository";
import { PostgresMessageRepository } from "../adapter/postgres/postgres-message-repository";
import { GeminiLlmAdapter } from "../adapter/llm/gemini-llm-adapter";
import { OpenAiLlmAdapter } from "../adapter/llm/openai-llm-adapter";
import { AppendMessageToConversationFlow } from "../application/append-message-to-conversation-flow";
import { LlmCompletionDomainService } from "../domain/services/llm-completion-domain-service";
import { CreateConversationFlow } from "../application/create-conversation-flow";
import { RequestCompletionFlow } from "../application/request-completion-flow";
import { DeleteConversationFlow } from "../application/delete-conversation-flow";
import { GetConversationFlow } from "../application/get-conversation-flow";
import { GetMessagesOnConversationFlow } from "../application/get-messages-on-conversation-flow";
import { ListConversationsFlow } from "../application/list-conversations-flow";
import { UpdateConvFlow } from "../application/update-conv-flow";
import type { AccessIdentityVerifier } from "../domain/contracts/access-identity-verifier";
import { AppendUserMessageDomainService } from "../domain/services/append-user-message-domain-service";
import { BlobDomainService } from "../domain/services/blob-domain-service";
import { ConversationDomainService } from "../domain/services/conversation-domain-service";
import { DeleteConversationDomainService } from "../domain/services/delete-conversation-domain-service";
import { FileAccessDomainService } from "../domain/services/file-access-domain-service";
import { FileDomainService } from "../domain/services/file-domain-service";
import { GenericValidationService } from "../domain/services/generic-validation-service";
import { LlmPromptDomainService } from "../domain/services/llm-prompt-domain-service";
import { MessageContentDomainService } from "../domain/services/message-content-domain-service";
import { MessageDomainService } from "../domain/services/message-domain-service";
import { TimingToolsService } from "../domain/services/timing-tools-service";
import type { AccessConfig, AuthConfig, BlobStorageConfig, LlmConfig } from "../config/config";

export interface WorkerEnv {
  HYPERDRIVE: Hyperdrive;
  BLOB_STORAGE_ENDPOINT: string;
  BLOB_STORAGE_BUCKET: string;
  BLOB_STORAGE_REGION: string;
  BLOB_STORAGE_FOLDER: string;
  BLOB_STORAGE_ACCESS_KEY_ID: string;
  BLOB_STORAGE_SECRET_ACCESS_KEY: string;
  OPENAI_LLM_API_KEY: string;
  GOOGLE_LLM_API_KEY: string;
  AUTH_ENABLED?: boolean | string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ALLOWED_USER_EMAILS?: string;
  ALLOWED_SERVICE_TOKEN_CLIENT_IDS?: string;
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
  const openAiLlmConfig: LlmConfig = {
    apiKey: requireString(env.OPENAI_LLM_API_KEY, "OPENAI_LLM_API_KEY"),
  };
  const googleLlmConfig: LlmConfig = {
    apiKey: requireString(env.GOOGLE_LLM_API_KEY, "GOOGLE_LLM_API_KEY"),
  };

  const conversationRepository = new PostgresConversationRepository(database);
  const messageRepository = new PostgresMessageRepository(database);
  const fileRepository = new PostgresFileRepository(database);
  const appendUserMessageStore = new PostgresAppendUserMessageStore(database);
  const deleteConversationStore = new PostgresDeleteConversationStore(database);

  const genericValidationService = new GenericValidationService();
  const conversationDomainService = new ConversationDomainService(conversationRepository, genericValidationService);
  const appendUserMessageDomainService = new AppendUserMessageDomainService(appendUserMessageStore);
  const deleteConversationDomainService = new DeleteConversationDomainService(deleteConversationStore);
  const blobDomainService = new BlobDomainService(blobRepository, genericValidationService);
  const fileDomainService = new FileDomainService(fileRepository, blobDomainService, genericValidationService);
  const messageContentDomainService = new MessageContentDomainService(genericValidationService);
  const messageDomainService = new MessageDomainService(messageRepository, messageContentDomainService, genericValidationService);

  const llmPromptDomainService = new LlmPromptDomainService();
  const timingToolsService = new TimingToolsService();
  const timingToolDefinitions = timingToolsService.get_description();
  const fileAccessDomainService = new FileAccessDomainService(fileSignedUrlGenerator);
  const llmAdapters = {
    openAi: new OpenAiLlmAdapter(openAiLlmConfig, timingToolDefinitions),
    gemini: new GeminiLlmAdapter(googleLlmConfig, timingToolDefinitions),
  };

  const llmCompletionDomainService = new LlmCompletionDomainService(
    messageDomainService,
    fileDomainService,
    fileAccessDomainService,
    llmAdapters.gemini,
    llmPromptDomainService,
    timingToolsService,
  );
  const shutdown = async (): Promise<void> => {
    await database.end({ timeout: 5 });
  };

  const authEnabled = requireBooleanFlag(env.AUTH_ENABLED, "AUTH_ENABLED");
  const authConfig = authEnabled ? buildAuthConfig(env) : null;
  const accessVerification = buildAccessVerification(env, authEnabled);

  const httpHandler = createConversationHttpHandler({
    accessVerification,
    accessIdentityAuthorizer: authConfig ? new StaticAccessIdentityAuthorizer(authConfig) : null,
    accessTeamDomain: env.CF_ACCESS_TEAM_DOMAIN ?? null,
    createConversation: new CreateConversationFlow(conversationDomainService),
    getConversation: new GetConversationFlow(conversationDomainService),
    listConversations: new ListConversationsFlow(conversationDomainService, genericValidationService),
    updateConv: new UpdateConvFlow(conversationDomainService),
    deleteConversation: new DeleteConversationFlow(deleteConversationDomainService, blobDomainService),
    appendMessage: new AppendMessageToConversationFlow(conversationDomainService, appendUserMessageDomainService, messageDomainService, fileDomainService),
    requestCompletion: new RequestCompletionFlow(conversationDomainService, genericValidationService, llmCompletionDomainService),
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

function requireBooleanFlag(value: boolean | string | undefined, name: string): boolean {
  if (value === true || value === "true") {
    return true;
  }

  if (value === false || value === "false") {
    return false;
  }

  throw new Error(`${name} must be set to true or false.`);
}

// Auth must be explicitly enabled or disabled. Deployed profiles should set it
// to true so missing Cloudflare Access config fails closed instead of exposing
// protected endpoints.
function buildAccessVerification(env: WorkerEnv, authEnabled: boolean): AccessIdentityVerifier | null {
  if (!authEnabled) {
    return null;
  }

  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const aud = env.CF_ACCESS_AUD;

  const config: AccessConfig = {
    teamDomain: requireString(teamDomain, "CF_ACCESS_TEAM_DOMAIN"),
    aud: requireString(aud, "CF_ACCESS_AUD"),
  };

  return new AccessJwtVerificationService(config);
}

function buildAuthConfig(env: WorkerEnv): AuthConfig {
  return {
    allowedUserEmails: requireCsvList(env.ALLOWED_USER_EMAILS, "ALLOWED_USER_EMAILS"),
    allowedServiceTokenClientIds: requireCsvList(env.ALLOWED_SERVICE_TOKEN_CLIENT_IDS, "ALLOWED_SERVICE_TOKEN_CLIENT_IDS"),
  };
}

function requireCsvList(value: string | undefined, name: string): ReadonlyArray<string> {
  const rawValue = requireString(value, name);
  const values = rawValue
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (values.length === 0) {
    throw new Error(`${name} must contain at least one value.`);
  }

  return values;
}
