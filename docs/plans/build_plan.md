## Entities

```ts
class Conversation {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// Message — see Domain Types section below

class File {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeInBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
```

## Types

### Flow Input/Output Types

Flow DTOs are type aliases or structurally identical interfaces of
their corresponding domain types. No mapping is needed at the
application boundary because the shapes are identical. Inbound
adapters consume flow DTOs directly — there is no separate
transport-DTO layer.

```ts
type DeleteConversationCommand = {
  readonly conversationId: string;
};

type AppendMessageRequest = {
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly content: ReadonlyArray<MessagePart>;
  readonly attachments: ReadonlyArray<Attachment>;
};

type Attachment = {
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;
};

type GetMessagesQuery = {
  readonly conversationId: string;
  readonly pageNum: number;
  readonly pageSize: number;
};

type GetMessagesItem = {
  readonly id: string;
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<MessagePart>;
  readonly files: ReadonlyArray<GetMessagesFile>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type GetMessagesFile = {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeInBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type ListConversationsQuery = {
  readonly pageNum: number;
  readonly pageSize: number;
};

type ListConversationsItem = {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type CreateConversationResult = {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type GetConversationQuery = {
  readonly conversationId: string;
};

type GetConversationResult = {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
```

### Domain Types

```ts
type FileContent = ArrayBuffer;

enum LLMMessageType {
  System = "system",
  User = "user",
  Assistant = "assistant",
  Tool = "tool",
}

interface TextPart {
  readonly type: "text";
  readonly text: string;
}

interface ImagePart {
  readonly type: "image";
  readonly fileId: string;
  readonly mediaType?: string;
}

interface FilePart {
  readonly type: "file";
  readonly fileId: string;
  readonly mediaType?: string;
  readonly filename?: string;
}

interface AudioPart {
  readonly type: "audio";
  readonly fileId: string;
  readonly mediaType?: string;
}

interface ToolCallPart {
  readonly type: "tool-call";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
}

interface ToolResultPart {
  readonly type: "tool-result";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: unknown;
}

type MessagePart = TextPart | ImagePart | FilePart | AudioPart | ToolCallPart | ToolResultPart;

interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<MessagePart>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

class CreateNextMessageInput {
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly content: ReadonlyArray<MessagePart>;
}

type UploadFileInput = {
  readonly conversationId: string;
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;
};

type UploadFilesInput = {
  readonly files: ReadonlyArray<UploadFileInput>;
};

type GetFilesInput = {
  readonly fileIds: ReadonlyArray<string>;
};

type CreateConversationRecord = {
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

class CreateMessageRecord {
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<MessagePart>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

type CreateFileRecord = {
  readonly canonicalUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeInBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type LlmCompletionResult = {
  readonly content: ReadonlyArray<MessagePart>;
};
```

### Persisted Types

```ts
interface MessageRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly type: LLMMessageType;
  readonly sequence_number: number;
  readonly content: MessagePart[];
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}
```

## Result and Error Types

```ts
type Result<T, E> = Success<T> | Failure<E>;
type Success<T> = { readonly ok: true; readonly value: T };
type Failure<E> = { readonly ok: false; readonly error: E };

type ValidationError = {
  readonly kind: "ValidationError";
  readonly fieldName: string;
  readonly message: string;
};

enum EntityType {
  Conversation = "Conversation",
  Message = "Message",
  File = "File",
}

enum StoreOperation {
  Persist = "persist",
  Read = "read",
  Remove = "remove",
  ReadPage = "readPage",
}

enum BlobStoreOperation {
  Upload = "upload",
  Fetch = "fetch",
  Delete = "delete",
}

type NotFoundError = {
  readonly kind: "NotFoundError";
  readonly entityType: EntityType;
  readonly id: string;
};

type StoreError = {
  readonly kind: "StoreError";
  readonly operation: StoreOperation;
  readonly entityType: EntityType;
  readonly message: string;
};

type BlobStoreError = {
  readonly kind: "BlobStoreError";
  readonly operation: BlobStoreOperation;
  readonly message: string;
};

type ConstructionError = {
  readonly kind: "ConstructionError";
  readonly entityType: string;
  readonly message: string;
};

type LlmError = {
  readonly kind: "LlmError";
  readonly message: string;
};
```

## Domain Contracts (Ports)

### LlmCompletionService

```ts
interface LlmCompletionService {
  complete(messages: ReadonlyArray<Message>): Promise<Result<LlmCompletionResult, LlmError>>;
}
```

### ValidationDomainService

```ts
class ValidationDomainService {
  validateGetMessagesQuery(query: GetMessagesQuery): Result<void, ValidationError>;
  validateListConversationsQuery(query: ListConversationsQuery): Result<void, ValidationError>;
  validateUploadFileInput(input: UploadFileInput): Result<void, ValidationError>;
}
```

`validateGetMessagesQuery` validates:
- RequireNonEmptyString(conversationId)
- RequirePositiveInteger(pageNum)
- RequirePositiveInteger(pageSize)

`validateListConversationsQuery` validates:
- RequirePositiveInteger(pageNum)
- RequirePositiveInteger(pageSize)

`validateUploadFileInput` validates:
- RequireNonEmptyString(conversationId)
- RequirePresent(content)
- RequireNonEmptyString(filename)
- RequireNonEmptyString(mimeType)

### MessageContentDomainService

```ts
class MessageContentDomainService {
  validateMessageInput(request: CreateNextMessageInput): Result<void, ValidationError>;
  validateMessageRecord(record: CreateMessageRecord): Result<void, ValidationError>;
  isBlobPart(part: MessagePart): part is BlobPart;
  collectBlobPartFileIds(parts: ReadonlyArray<MessagePart>): ReadonlyArray<string>;
  replaceBlobPartFileIds(parts: ReadonlyArray<MessagePart>, fileIds: ReadonlyArray<string>): Result<ReadonlyArray<MessagePart>, ValidationError>;
}
```

`validateMessageInput` and `validateMessageRecord` validate:
- RequireNonEmptyString(conversationId)
- RequirePositiveInteger(sequenceNumber) (when present)
- RequirePresent(content), RequirePresent(type)
- Content part type constraints:
  - System/User: all parts must be TextPart, ImagePart, FilePart, or AudioPart
  - Assistant: all parts must be TextPart or ToolCallPart
  - Tool: all parts must be ToolResultPart
- Per-part field validation (fileId, toolCallId, toolName, etc.)

## Atomic Operations

- Now(): Date
- Construct<T>(...props): Result<T, ConstructionError>
- RequireNonEmptyString(value: string, fieldName: string): Result<string, ValidationError>
- RequirePositiveInteger(value: number, fieldName: string): Result<number, ValidationError>
- RequirePresent(value: unknown, fieldName: string): Result<void, ValidationError>

## Application Flow Actions

### DeleteConversationFlow.execute (command: DeleteConversationCommand): Result<void, ValidationError | NotFoundError | StoreError | BlobStoreError>

1. ConversationDomainService.readFromConversationDBStore(command.conversationId) → conversation → if failure, return failure.
2. MessageDomainService.readAllMessagesFromMessageDBStore(command.conversationId) → messages → if failure, return failure.
3. For each message: Message in messages:
   1. MessageDomainService.deleteMessageWithFiles(message.id) → if failure, return failure.
4. ConversationDomainService.removeFromConversationDBStore(command.conversationId) → if failure, return failure.
5. Return succeed(void).

### AppendMessageToConversationFlow.execute (request: AppendMessageRequest): Result<void, ValidationError | NotFoundError | StoreError | BlobStoreError | LlmError>

1. ConversationDomainService.readFromConversationDBStore(request.conversationId) → conversation → if failure, return failure.
2. FileDomainService.uploadFiles({ files: request.attachments mapped to UploadFileInput[] }) → files → if failure, return failure.
3. MessageContentDomainService.replaceBlobPartFileIds(request.content, files.map(f → f.id)) → userContentParts → if failure, return failure.
4. MessageDomainService.createNextMessage({ conversationId, type: request.type, content: userContentParts }) → userMessage → if failure, return failure.
5. MessageDomainService.readAllMessagesFromMessageDBStore(request.conversationId) → allMessages → if failure, return failure.
6. LlmDomainService.sendToLLMChatService(allMessages) → llmResult → if failure, return failure.
7. MessageDomainService.createNextMessage({ conversationId, type: LLMMessageType.Assistant, content: llmResult.content }) → assistantMessage → if failure, return failure.
8. Return succeed(void).

### GetMessagesOnConversationFlow.execute (query: GetMessagesQuery): Result<GetMessagesItem[], ValidationError | NotFoundError | StoreError>

1. ValidationDomainService.validateGetMessagesQuery(query) → if failure, return failure.
2. ConversationDomainService.readFromConversationDBStore(query.conversationId) → conversation → if failure, return failure.
3. MessageDomainService.readPageFromMessageDBStore(query.conversationId, query.pageNum, query.pageSize) → messages → if failure, return failure.
4. Filter messages to only those with type LLMMessageType.User or LLMMessageType.Assistant → visibleMessages.
5. For each message: Message in visibleMessages:
   1. MessageContentDomainService.collectBlobPartFileIds(message.content) → fileIds.
   2. FileDomainService.getFiles({ fileIds }) → files → if failure, return failure.
   3. Map message and files to GetMessagesItem({ id, conversationId, type, sequenceNumber, content: message.content, files mapped to GetMessagesFile[], createdAt, updatedAt }).
6. Return succeed(items).

### ListConversationsFlow.execute (query: ListConversationsQuery): Result<ListConversationsItem[], ValidationError | StoreError>

1. ValidationDomainService.validateListConversationsQuery(query) → if failure, return failure.
2. ConversationDomainService.readPageFromConversationDBStore(query.pageNum, query.pageSize) → conversations → if failure, return failure.
3. Map each conversation to ListConversationsItem({ id, createdAt, updatedAt }).
4. Return succeed(items).

### CreateConversationFlow.execute (): Result<CreateConversationResult, StoreError>

1. ConversationDomainService.createConversation() → conversation → if failure, return failure.
2. Map conversation to CreateConversationResult({ id, createdAt, updatedAt }).
3. Return succeed(createConversationResult).

### GetConversationFlow.execute (query: GetConversationQuery): Result<GetConversationResult, ValidationError | NotFoundError | StoreError>

1. ConversationDomainService.readFromConversationDBStore(query.conversationId) → conversation → if failure, return failure.
2. Map conversation to GetConversationResult({ id, createdAt, updatedAt }).
3. Return succeed(getConversationResult).

## Domain Service Actions

### ConversationDomainService.createConversation (): Result<Conversation, StoreError>

1. Now() → timestamp.
2. ConversationDomainService.persistToConversationDBStore({ createdAt: timestamp, updatedAt: timestamp }) → conversation → if failure, return failure.
3. Return succeed(conversation).

### ConversationDomainService.persistToConversationDBStore (record: CreateConversationRecord): Result<Conversation, StoreError>

1. Infra.UpsertConversationRow(record) → conversation → if failure, return failure.

### ConversationDomainService.readFromConversationDBStore (id: string): Result<Conversation, ValidationError | NotFoundError | StoreError>

1. RequireNonEmptyString(id, "id") → if failure, return failure.
2. Infra.SelectConversationRow(id) → conversation → if failure, return failure.

### ConversationDomainService.readPageFromConversationDBStore (pageNum: number, pageSize: number): Result<Conversation[], StoreError>

1. Compute offset = (pageNum - 1) \* pageSize.
2. Infra.SelectConversationPage(offset, pageSize) → conversations → if failure, return failure.

### ConversationDomainService.removeFromConversationDBStore (id: string): Result<void, ValidationError | StoreError>

1. RequireNonEmptyString(id, "id") → if failure, return failure.
2. Infra.DeleteConversationRow(id) → if failure, return failure.

### MessageDomainService.createNextMessage (request: CreateNextMessageInput): Result<Message, ValidationError | StoreError>

1. MessageContentDomainService.validateMessageInput(request) → if failure, return failure.
2. MessageDomainService.readMessageCountFromMessageDBStore(request.conversationId) → count → if failure, return failure.
3. Now() → timestamp.
4. MessageDomainService.persistToMessageDBStore({ conversationId, type: request.type, sequenceNumber: count + 1, content: request.content, createdAt: timestamp, updatedAt: timestamp }) → message → if failure, return failure.
5. Return succeed(message).

### MessageDomainService.deleteMessage (messageId: string): Result<void, ValidationError | NotFoundError | StoreError>

1. MessageDomainService.readFromMessageDBStore(messageId) → if failure, return failure.
2. MessageDomainService.removeFromMessageDBStore(messageId) → if failure, return failure.
3. Return succeed(void).

### MessageDomainService.deleteMessageWithFiles (messageId: string): Result<void, ValidationError | NotFoundError | StoreError | BlobStoreError>

1. MessageDomainService.readFromMessageDBStore(messageId) → message → if failure, return failure.
2. MessageContentDomainService.collectBlobPartFileIds(message.content) → fileIds.
3. For each fileId: string in fileIds:
   1. FileDomainService.deleteFile(fileId) → if failure, return failure.
4. MessageDomainService.removeFromMessageDBStore(messageId) → if failure, return failure.
5. Return succeed(void).

### MessageDomainService.persistToMessageDBStore (record: CreateMessageRecord): Result<Message, ValidationError | StoreError>

1. MessageContentDomainService.validateMessageRecord(record) → if failure, return failure.
2. Infra.UpsertMessageRow(record) → message → if failure, return failure.

### MessageDomainService.readFromMessageDBStore (id: string): Result<Message, ValidationError | NotFoundError | StoreError>

1. RequireNonEmptyString(id, "id") → if failure, return failure.
2. Infra.SelectMessageRow(id) → message → if failure, return failure.

### MessageDomainService.readPageFromMessageDBStore (conversationId: string, pageNum: number, pageSize: number): Result<Message[], StoreError>

1. Compute fromSequence = (pageNum - 1) \* pageSize + 1.
2. Infra.SelectMessagePage(conversationId, fromSequence, pageSize) → messages → if failure, return failure.

### MessageDomainService.readAllMessagesFromMessageDBStore (conversationId: string): Result<Message[], ValidationError | StoreError>

1. RequireNonEmptyString(conversationId, "conversationId") → if failure, return failure.
2. Infra.SelectAllMessagesByConversation(conversationId) → messages → if failure, return failure.

### MessageDomainService.readMessageCountFromMessageDBStore (conversationId: string): Result<number, ValidationError | StoreError>

1. RequireNonEmptyString(conversationId, "conversationId") → if failure, return failure.
2. Infra.CountMessagesByConversation(conversationId) → count → if failure, return failure.

### MessageDomainService.removeFromMessageDBStore (id: string): Result<void, ValidationError | StoreError>

1. RequireNonEmptyString(id, "id") → if failure, return failure.
2. Infra.DeleteMessageRow(id) → if failure, return failure.

### FileDomainService.uploadFile (request: UploadFileInput): Result<File, ValidationError | BlobStoreError | StoreError>

1. BlobDomainService.uploadToBlobStore({ conversationId, content, filename, mimeType }) → canonicalUrl → if failure, return failure.
2. Now() → timestamp.
3. FileDomainService.persistToFileDBStore({ canonicalUrl, filename, mimeType, sizeInBytes: content.byteLength, createdAt: timestamp, updatedAt: timestamp }) → file → if failure, return failure.
4. Return succeed(file).

### FileDomainService.uploadFiles (request: UploadFilesInput): Result<File[], ValidationError | BlobStoreError | StoreError>

1. For each file: UploadFileInput in request.files:
   1. FileDomainService.uploadFile(file) → uploadedFile → if failure, return failure.
2. Return succeed(uploadedFiles).

### FileDomainService.getFiles (request: GetFilesInput): Result<File[], NotFoundError | StoreError>

1. For each fileId: string in request.fileIds:
   1. FileDomainService.readFromFileDBStore(fileId) → file → if failure, return failure.
2. Return succeed(files).

### FileDomainService.deleteFile (fileId: string): Result<void, ValidationError | NotFoundError | StoreError | BlobStoreError>

1. FileDomainService.readFromFileDBStore(fileId) → file → if failure, return failure.
2. BlobDomainService.deleteFromBlobStore(file.canonicalUrl) → if failure, return failure.
3. FileDomainService.removeFromFileDBStore(fileId) → if failure, return failure.
4. Return succeed(void).

### FileDomainService.persistToFileDBStore (record: CreateFileRecord): Result<File, StoreError>

1. Infra.UpsertFileRow(record) → file → if failure, return failure.

### FileDomainService.readFromFileDBStore (id: string): Result<File, ValidationError | NotFoundError | StoreError>

1. RequireNonEmptyString(id, "id") → if failure, return failure.
2. Infra.SelectFileRow(id) → file → if failure, return failure.

### FileDomainService.removeFromFileDBStore (id: string): Result<void, ValidationError | StoreError>

1. RequireNonEmptyString(id, "id") → if failure, return failure.
2. Infra.DeleteFileRow(id) → if failure, return failure.

### BlobDomainService.uploadToBlobStore (request: UploadFileInput): Result<string, ValidationError | BlobStoreError>

1. ValidationDomainService.validateUploadFileInput(request) → if failure, return failure.
2. Infra.PutBlob(request) → url → if failure, return failure.

### BlobDomainService.deleteFromBlobStore (canonicalUrl: string): Result<void, ValidationError | BlobStoreError>

1. RequireNonEmptyString(canonicalUrl, "canonicalUrl") → if failure, return failure.
2. Infra.RemoveBlob(canonicalUrl) → if failure, return failure.

### LlmDomainService.sendToLLMChatService (messages: ReadonlyArray<Message>): Result<LlmCompletionResult, LlmError>

1. Infra.LlmComplete(messages) → llmResult → if failure, return failure.
2. Return succeed(llmResult).

## Infra Actions

### Infra.UpsertConversationRow (record: CreateConversationRecord): Result<Conversation, StoreError>

1. MapToRow(record) → row.
2. PostgresClient.query(UpsertQuery("conversations", row)) → resultRow → if error, return StoreError.
3. MapFromRow(resultRow) → conversation.
4. Return succeed(conversation).

### Infra.SelectConversationRow (id: string): Result<Conversation, NotFoundError | StoreError>

1. PostgresClient.query(SelectByIdQuery("conversations", id)) → row → if error, return StoreError.
2. If row is null → return NotFoundError("Conversation", id).
3. MapFromRow(row) → conversation.
4. Return succeed(conversation).

### Infra.SelectConversationPage (offset: number, pageSize: number): Result<Conversation[], StoreError>

1. PostgresClient.query(SelectPageQuery("conversations", { offset, pageSize })) → rows → if error, return StoreError.
2. For each row in rows: MapFromRow(row) → conversation.
3. Return succeed(conversations).

### Infra.DeleteConversationRow (id: string): Result<void, StoreError>

1. PostgresClient.query(DeleteByIdQuery("conversations", id)) → if error, return StoreError.
2. Return succeed(void).

### Infra.UpsertMessageRow (record: CreateMessageRecord): Result<Message, StoreError>

1. MapToRow(record) → row (produces MessageRow with conversation_id, type, sequence_number, content as JSONB, created_at, updated_at).
2. PostgresClient.query(UpsertQuery("messages", row)) → resultRow → if error, return StoreError.
3. MapFromRow(resultRow) → message.
4. Return succeed(message).

### Infra.SelectMessageRow (id: string): Result<Message, NotFoundError | StoreError>

1. PostgresClient.query(SelectByIdQuery("messages", id)) → row → if error, return StoreError.
2. If row is null → return NotFoundError("Message", id).
3. MapFromRow(row) → message.
4. Return succeed(message).

### Infra.SelectMessagePage (conversationId: string, fromSequence: number, pageSize: number): Result<Message[], StoreError>

1. PostgresClient.query(SelectPageQuery("messages", { conversationId, fromSequence, pageSize })) → rows → if error, return StoreError.
2. For each row in rows: MapFromRow(row) → message.
3. Return succeed(messages).

### Infra.SelectAllMessagesByConversation (conversationId: string): Result<Message[], StoreError>

1. PostgresClient.query(SelectByFieldQuery("messages", "conversation_id", conversationId)) → rows → if error, return StoreError.
2. For each row in rows: MapFromRow(row) → message.
3. Return succeed(messages).

### Infra.CountMessagesByConversation (conversationId: string): Result<number, StoreError>

1. PostgresClient.query(CountByFieldQuery("messages", "conversation_id", conversationId)) → count → if error, return StoreError.
2. Return succeed(count).

### Infra.DeleteMessageRow (id: string): Result<void, StoreError>

1. PostgresClient.query(DeleteByIdQuery("messages", id)) → if error, return StoreError.
2. Return succeed(void).

### Infra.UpsertFileRow (record: CreateFileRecord): Result<File, StoreError>

1. MapToRow(record) → row.
2. PostgresClient.query(UpsertQuery("files", row)) → resultRow → if error, return StoreError.
3. MapFromRow(resultRow) → file.
4. Return succeed(file).

### Infra.SelectFileRow (id: string): Result<File, NotFoundError | StoreError>

1. PostgresClient.query(SelectByIdQuery("files", id)) → row → if error, return StoreError.
2. If row is null → return NotFoundError("File", id).
3. MapFromRow(row) → file.
4. Return succeed(file).

### Infra.DeleteFileRow (id: string): Result<void, StoreError>

1. PostgresClient.query(DeleteByIdQuery("files", id)) → if error, return StoreError.
2. Return succeed(void).

### Infra.PutBlob (content: FileContent): Result<string, BlobStoreError>

1. R2Client.upload(content) → url → if error, return BlobStoreError.
2. Return succeed(url).

### Infra.RemoveBlob (url: string): Result<void, BlobStoreError>

1. R2Client.delete(url) → if error, return BlobStoreError.
2. Return succeed(void).

### Infra.LlmComplete (messages: ReadonlyArray<Message>): Result<LlmCompletionResult, LlmError>

1. Map domain Message[] to LangChain BaseMessage[] (user → HumanMessage, assistant → AIMessage, system → SystemMessage, tool → ToolMessage). Content parts map as follows:
   - TextPart → string content or text content block.
   - ImagePart/FilePart/AudioPart → media content blocks referencing file URLs resolved from fileIds.
   - ToolCallPart → tool_calls array entries on AIMessage.
   - ToolResultPart → ToolMessage content with toolCallId correlation.
2. BaseChatModel.invoke(baseMessages) → aiMessage → if error, return LlmError.
3. Map aiMessage content to LlmCompletionResult.content (ReadonlyArray\<MessagePart\>):
   - Text content → TextPart.
   - Tool calls → ToolCallPart (with toolCallId, toolName, input).
4. Return succeed(llmCompletionResult).

## Notes

- Actions use early-return-on-failure: the first `Failure` result short-circuits
  the action. Loops also short-circuit on the first failure.
- `Now()` is infallible — not wrapped in `Result`.
- Entity IDs are auto-generated by the database during insert. The
  `PersistTo*DBStore` operations return the entity with its generated ID.
- `NotFoundError` is separate from `StoreError` so callers can map to different
  HTTP status codes (404 vs 500).
- `FileContent` is opaque in the domain layer — the domain never inspects or
  transforms it. The implementation of `UploadToBlobStore` is responsible for
  checking and casting to the actual runtime representation (e.g. `Buffer`,
  `ReadableStream`).
- Message ordering and pagination are derived from `sequenceNumber` on `Message`
  combined with `conversationId`. `DeleteConversation` and
  `AppendMessageToConversation` query the message store by `conversationId`
  directly.
- `*DBStore` and `*BlobStore` actions are domain-level abstractions, not
  repository or infrastructure names. They discriminate between the two kinds
  of store (relational vs object) while remaining in the domain layer. The
  `Infra.*` actions are the repository/adapter layer.
- Inbound adapters consume flow DTOs directly for request parsing and
  response serialization — there is no separate transport-DTO layer.
  Transport validation errors (e.g. malformed multipart fields) should use
  adapter-local error types, not domain `ValidationError`. The adapter maps
  transport errors to HTTP status codes independently of the domain error
  hierarchy.
- The `MessageRow` persisted type stores `content` as a JSONB column
  containing the `MessagePart[]` array. The `type` column stores the
  `LLMMessageType` value. Column names use snake_case per PostgreSQL convention;
  `MapToRow`/`MapFromRow` handle the camelCase ↔ snake_case conversion.

## Description

This plan was generated through an iterative conversation with Claude Code.
The process started by defining high-level actions (CreateConversation,
DeleteConversation, AppendMessage) and progressively decomposed them:

1. Actions were first expressed as sequences of sub-actions.
2. Sub-actions were reframed in terms of Upload/Download/Delete primitives.
3. Those primitives were further decomposed into atomic operations
   (GenerateId, Now, Construct, DB store reads/writes, blob store operations).
4. Naming, typing, and signatures were refined iteratively — positional
   parameters replaced with request objects, entity-specific DB stores
   introduced, immutability assumptions challenged, and multipart upload
   metadata added.
5. Pagination was added using sequence-number-based cursoring derived from
   page number and page size inputs.
6. Message types were refactored to align with the Vercel AI SDK model:
   `LlmMessageType` was renamed to `LLMMessageType`, `Message` was
   simplified to a plain interface with `LLMMessageType` + `MessagePart[]`
   (no generics), and top-level `toolCalls`/`toolCallId`/`fileIds` fields
   were folded into typed content parts (`ToolCallPart`, `ToolResultPart`,
   `ImagePart`, `FilePart`, `AudioPart`).
7. Message content validation and blob-part operations were consolidated
   into `MessageContentDomainService`. Input classes (`CreateNextMessageInput`,
   `CreateMessageRecord`) are plain data classes; callers delegate
   validation and content manipulation to the service.
8. `isValid()` methods were extracted from `GetMessagesQuery`,
   `ListConversationsQuery`, and `UploadFileInput` into a dedicated
   `ValidationDomainService`. Those types are now plain data types with no
   behaviour; callers invoke the domain service for validation.
9. Action headings were qualified with their owning class to mirror code
   placement: application flows use `*Flow.execute`, domain actions use
   `ConversationDomainService.*`, `MessageDomainService.*`,
   `FileDomainService.*`, `BlobDomainService.*`, and
   `LlmDomainService.*`. Internal step references were updated
   accordingly.

Each iteration was checked in as a separate commit to preserve the
decision history.
