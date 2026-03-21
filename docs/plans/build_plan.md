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

class GetMessagesQuery {
  readonly conversationId: string;
  readonly pageNum: number;
  readonly pageSize: number;

  isValid(): Result<void, ValidationError> {
    // RequireNonEmptyString(conversationId)
    // RequirePositiveInteger(pageNum)
    // RequirePositiveInteger(pageSize)
  }
}

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

class ListConversationsQuery {
  readonly pageNum: number;
  readonly pageSize: number;

  isValid(): Result<void, ValidationError> {
    // RequirePositiveInteger(pageNum)
    // RequirePositiveInteger(pageSize)
  }
}

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

class CreateMessageInput {
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<MessagePart>;

  isValid(): Result<void, ValidationError> {
    // RequireNonEmptyString(conversationId)
    // RequirePositiveInteger(sequenceNumber)
    // RequirePresent(content)
    // RequirePresent(type)
    // Validate content parts match type constraints:
    //   System/User: all parts must be TextPart, ImagePart, FilePart, or AudioPart
    //   Assistant: all parts must be TextPart or ToolCallPart
    //   Tool: all parts must be ToolResultPart
    // For each BlobPart: RequireNonEmptyString(fileId)
    // For each ToolCallPart: RequireNonEmptyString(toolCallId, toolName)
    // For each ToolResultPart: RequireNonEmptyString(toolCallId, toolName)
  }
}

class CreateNextMessageInput {
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly content: ReadonlyArray<MessagePart>;

  isValid(): Result<void, ValidationError> {
    // RequireNonEmptyString(conversationId)
    // RequirePresent(content)
    // RequirePresent(type)
    // Validate content parts match type constraints:
    //   System/User: all parts must be TextPart, ImagePart, FilePart, or AudioPart
    //   Assistant: all parts must be TextPart or ToolCallPart
    //   Tool: all parts must be ToolResultPart
    // For each BlobPart: RequireNonEmptyString(fileId)
    // For each ToolCallPart: RequireNonEmptyString(toolCallId, toolName)
    // For each ToolResultPart: RequireNonEmptyString(toolCallId, toolName)
  }
}

class UploadFileInput {
  readonly conversationId: string;
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;

  isValid(): Result<void, ValidationError> {
    // RequireNonEmptyString(conversationId)
    // RequirePresent(content)
    // RequireNonEmptyString(filename)
    // RequireNonEmptyString(mimeType)
  }
}

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

  isValid(): Result<void, ValidationError> {
    // RequireNonEmptyString(conversationId)
    // RequirePositiveInteger(sequenceNumber)
    // RequirePresent(content)
    // RequirePresent(type)
    // Validate content parts match type constraints:
    //   System/User: all parts must be TextPart, ImagePart, FilePart, or AudioPart
    //   Assistant: all parts must be TextPart or ToolCallPart
    //   Tool: all parts must be ToolResultPart
    // For each BlobPart: RequireNonEmptyString(fileId)
    // For each ToolCallPart: RequireNonEmptyString(toolCallId, toolName)
    // For each ToolResultPart: RequireNonEmptyString(toolCallId, toolName)
  }
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

## Atomic Operations

- Now(): Date
- Construct<T>(...props): Result<T, ConstructionError>
- RequireNonEmptyString(value: string, fieldName: string): Result<string, ValidationError>
- RequirePositiveInteger(value: number, fieldName: string): Result<number, ValidationError>
- RequirePresent(value: unknown, fieldName: string): Result<void, ValidationError>

## Actions

### App.DeleteConversation (command: DeleteConversationCommand): Result<void, ValidationError | NotFoundError | StoreError | BlobStoreError>

1. ReadFromConversationDBStore(command.conversationId) → conversation → if failure, return failure.
2. ReadAllMessagesFromMessageDBStore(command.conversationId) → messages → if failure, return failure.
3. For each message: Message in messages:
   1. DeleteMessageWithFiles(message.id) → if failure, return failure.
4. RemoveFromConversationDBStore(command.conversationId) → if failure, return failure.
5. Return succeed(void).

### App.AppendMessageToConversation (request: AppendMessageRequest): Result<void, ValidationError | NotFoundError | StoreError | BlobStoreError | LlmError>

1. ReadFromConversationDBStore(request.conversationId) → conversation → if failure, return failure.
2. UploadFiles({ files: request.attachments mapped to UploadFileInput[] }) → files → if failure, return failure.
3. Build userContentParts: replace each BlobPart in request.content with a part whose fileId is set to the corresponding uploaded file's id. TextParts pass through unchanged.
4. CreateNextMessage({ conversationId, type: request.type, content: userContentParts }) → userMessage → if failure, return failure.
5. ReadAllMessagesFromMessageDBStore(request.conversationId) → allMessages → if failure, return failure.
6. SendToLLMChatService(allMessages) → llmResult → if failure, return failure.
7. CreateNextMessage({ conversationId, type: LLMMessageType.Assistant, content: llmResult.content }) → assistantMessage → if failure, return failure.
8. Return succeed(void).

### App.GetMessagesOnConversation (query: GetMessagesQuery): Result<GetMessagesItem[], ValidationError | NotFoundError | StoreError>

1. query.isValid() → if failure, return failure.
2. ReadFromConversationDBStore(query.conversationId) → conversation → if failure, return failure.
3. ReadPageFromMessageDBStore(query.conversationId, query.pageNum, query.pageSize) → messages → if failure, return failure.
4. Filter messages to only those with type LLMMessageType.User or LLMMessageType.Assistant → visibleMessages.
5. For each message: Message in visibleMessages:
   1. Collect all fileIds from BlobParts (ImagePart, FilePart, AudioPart) in message.content.
   2. GetFiles({ fileIds }) → files → if failure, return failure.
   3. Map message and files to GetMessagesItem({ id, conversationId, type, sequenceNumber, content: message.content, files mapped to GetMessagesFile[], createdAt, updatedAt }).
6. Return succeed(items).

### App.ListConversations (query: ListConversationsQuery): Result<ListConversationsItem[], ValidationError | StoreError>

1. query.isValid() → if failure, return failure.
2. ReadPageFromConversationDBStore(query.pageNum, query.pageSize) → conversations → if failure, return failure.
3. Map each conversation to ListConversationsItem({ id, createdAt, updatedAt }).
4. Return succeed(items).

### App.CreateConversation (): Result<CreateConversationResult, StoreError>

1. CreateConversation() → conversation → if failure, return failure.
2. Map conversation to CreateConversationResult({ id, createdAt, updatedAt }).
3. Return succeed(createConversationResult).

### App.GetConversation (query: GetConversationQuery): Result<GetConversationResult, ValidationError | NotFoundError | StoreError>

1. ReadFromConversationDBStore(query.conversationId) → conversation → if failure, return failure.
2. Map conversation to GetConversationResult({ id, createdAt, updatedAt }).
3. Return succeed(getConversationResult).

### CreateConversation (): Result<Conversation, StoreError>

1. Now() → timestamp.
2. PersistToConversationDBStore({ createdAt: timestamp, updatedAt: timestamp }) → conversation → if failure, return failure.
3. Return succeed(conversation).

### CreateMessage (request: CreateMessageInput): Result<Message, ValidationError | StoreError>

1. request.isValid() → if failure, return failure.
2. Now() → timestamp.
3. PersistToMessageDBStore({ conversationId, type: request.type, sequenceNumber, content: request.content, createdAt: timestamp, updatedAt: timestamp }) → message → if failure, return failure.
4. Return succeed(message).

### CreateNextMessage (request: CreateNextMessageInput): Result<Message, ValidationError | StoreError>

1. request.isValid() → if failure, return failure.
2. ReadMessageCountFromMessageDBStore(request.conversationId) → count → if failure, return failure.
3. CreateMessage({ conversationId, type: request.type, sequenceNumber: count + 1, content: request.content }) → message → if failure, return failure.
4. Return succeed(message).

### DeleteMessage (messageId: string): Result<void, ValidationError | NotFoundError | StoreError>

1. ReadFromMessageDBStore(messageId) → if failure, return failure.
2. RemoveFromMessageDBStore(messageId) → if failure, return failure.
3. Return succeed(void).

### DeleteMessageWithFiles (messageId: string): Result<void, ValidationError | NotFoundError | StoreError | BlobStoreError>

1. ReadFromMessageDBStore(messageId) → message → if failure, return failure.
2. Collect all fileIds from BlobParts (ImagePart, FilePart, AudioPart) in message.content.
3. For each fileId: string in fileIds:
   1. DeleteFile(fileId) → if failure, return failure.
4. RemoveFromMessageDBStore(messageId) → if failure, return failure.
5. Return succeed(void).

### UploadFile (request: UploadFileInput): Result<File, ValidationError | BlobStoreError | StoreError>

1. UploadToBlobStore({ conversationId, content, filename, mimeType }) → canonicalUrl → if failure, return failure.
2. Now() → timestamp.
3. PersistToFileDBStore({ canonicalUrl, filename, mimeType, sizeInBytes: content.byteLength, createdAt: timestamp, updatedAt: timestamp }) → file → if failure, return failure.
4. Return succeed(file).

### UploadFiles (request: UploadFilesInput): Result<File[], ValidationError | BlobStoreError | StoreError>

1. For each file: UploadFileInput in request.files:
   1. UploadFile(file) → uploadedFile → if failure, return failure.
2. Return succeed(uploadedFiles).

### GetFiles (request: GetFilesInput): Result<File[], NotFoundError | StoreError>

1. For each fileId: string in request.fileIds:
   1. ReadFromFileDBStore(fileId) → file → if failure, return failure.
2. Return succeed(files).

### DeleteFile (fileId: string): Result<void, ValidationError | NotFoundError | StoreError | BlobStoreError>

1. ReadFromFileDBStore(fileId) → file → if failure, return failure.
2. DeleteFromBlobStore(file.canonicalUrl) → if failure, return failure.
3. RemoveFromFileDBStore(fileId) → if failure, return failure.
4. Return succeed(void).

### PersistToConversationDBStore (record: CreateConversationRecord): Result<Conversation, StoreError>

1. Infra.UpsertConversationRow(record) → conversation → if failure, return failure.

### ReadFromConversationDBStore (id: string): Result<Conversation, ValidationError | NotFoundError | StoreError>

1. RequireNonEmptyString(id, "id") → if failure, return failure.
2. Infra.SelectConversationRow(id) → conversation → if failure, return failure.

### ReadPageFromConversationDBStore (pageNum: number, pageSize: number): Result<Conversation[], StoreError>

1. Compute offset = (pageNum - 1) \* pageSize.
2. Infra.SelectConversationPage(offset, pageSize) → conversations → if failure, return failure.

### RemoveFromConversationDBStore (id: string): Result<void, ValidationError | StoreError>

1. RequireNonEmptyString(id, "id") → if failure, return failure.
2. Infra.DeleteConversationRow(id) → if failure, return failure.

### PersistToMessageDBStore (record: CreateMessageRecord): Result<Message, ValidationError | StoreError>

1. record.isValid() → if failure, return failure.
2. Infra.UpsertMessageRow(record) → message → if failure, return failure.

### ReadFromMessageDBStore (id: string): Result<Message, ValidationError | NotFoundError | StoreError>

1. RequireNonEmptyString(id, "id") → if failure, return failure.
2. Infra.SelectMessageRow(id) → message → if failure, return failure.

### ReadPageFromMessageDBStore (conversationId: string, pageNum: number, pageSize: number): Result<Message[], StoreError>

1. Compute fromSequence = (pageNum - 1) \* pageSize + 1.
2. Infra.SelectMessagePage(conversationId, fromSequence, pageSize) → messages → if failure, return failure.

### ReadAllMessagesFromMessageDBStore (conversationId: string): Result<Message[], ValidationError | StoreError>

1. RequireNonEmptyString(conversationId, "conversationId") → if failure, return failure.
2. Infra.SelectAllMessagesByConversation(conversationId) → messages → if failure, return failure.

### ReadMessageCountFromMessageDBStore (conversationId: string): Result<number, ValidationError | StoreError>

1. RequireNonEmptyString(conversationId, "conversationId") → if failure, return failure.
2. Infra.CountMessagesByConversation(conversationId) → count → if failure, return failure.

### RemoveFromMessageDBStore (id: string): Result<void, ValidationError | StoreError>

1. RequireNonEmptyString(id, "id") → if failure, return failure.
2. Infra.DeleteMessageRow(id) → if failure, return failure.

### PersistToFileDBStore (record: CreateFileRecord): Result<File, StoreError>

1. Infra.UpsertFileRow(record) → file → if failure, return failure.

### ReadFromFileDBStore (id: string): Result<File, ValidationError | NotFoundError | StoreError>

1. RequireNonEmptyString(id, "id") → if failure, return failure.
2. Infra.SelectFileRow(id) → file → if failure, return failure.

### RemoveFromFileDBStore (id: string): Result<void, ValidationError | StoreError>

1. RequireNonEmptyString(id, "id") → if failure, return failure.
2. Infra.DeleteFileRow(id) → if failure, return failure.

### UploadToBlobStore (request: UploadFileInput): Result<string, ValidationError | BlobStoreError>

1. request.isValid() → if failure, return failure.
2. Infra.PutBlob(request) → url → if failure, return failure.

### DeleteFromBlobStore (canonicalUrl: string): Result<void, ValidationError | BlobStoreError>

1. RequireNonEmptyString(canonicalUrl, "canonicalUrl") → if failure, return failure.
2. Infra.RemoveBlob(canonicalUrl) → if failure, return failure.

### SendToLLMChatService (messages: ReadonlyArray<Message>): Result<LlmCompletionResult, LlmError>

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
   (no generics), type-content constraints are enforced at runtime via
   `isValid()` methods on input classes, and top-level
   `toolCalls`/`toolCallId`/
   `fileIds` fields were folded into typed content parts (`ToolCallPart`,
   `ToolResultPart`, `ImagePart`, `FilePart`, `AudioPart`).

Each iteration was checked in as a separate commit to preserve the
decision history.
