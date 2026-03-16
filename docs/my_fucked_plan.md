## Entities

```ts
class Conversation {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

class Message {
  readonly id: string;
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly textContent: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly fileIds: ReadonlyArray<string>;
}

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

```ts
type SortDirection = "asc" | "desc";
type FileContent = { readonly _brand: "FileContent" };
type Attachment = {
  content: FileContent;
  filename: string;
  mimeType: string;
};

type AppendMessageRequest = {
  conversationId: string;
  textContent: string;
  attachments: Attachment[];
};

type CreateMessageRequest = {
  conversationId: string;
  textContent: string;
  fileIds: string[];
};

type UploadFileRequest = {
  content: FileContent;
  filename: string;
  mimeType: string;
};
```

## Result and Error Types

```ts
type Result<T, E> = Success<T> | Failure<E>;
type Success<T> = { readonly ok: true; readonly value: T };
type Failure<E> = { readonly ok: false; readonly error: E };

type DomainError =
  | ValidationError
  | NotFoundError
  | StoreError
  | BlobStoreError
  | ConstructionError;

type ValidationError = {
  readonly kind: "ValidationError";
  readonly fieldName: string;
  readonly message: string;
};

type NotFoundError = {
  readonly kind: "NotFoundError";
  readonly entityType: "Conversation" | "Message" | "File";
  readonly id: string;
};

type StoreError = {
  readonly kind: "StoreError";
  readonly operation: "persist" | "read" | "remove" | "readPage";
  readonly entityType: "Conversation" | "Message" | "File";
  readonly message: string;
};

type BlobStoreError = {
  readonly kind: "BlobStoreError";
  readonly operation: "upload" | "fetch" | "delete";
  readonly message: string;
};

type ConstructionError = {
  readonly kind: "ConstructionError";
  readonly entityType: string;
  readonly message: string;
};
```

## Atomic Operations

- Now(): Date
- Construct<T>(...props): Result<T, ConstructionError>
- RequireNonEmptyString(value: string, fieldName: string): Result<string, ValidationError>
- RequirePositiveInteger(value: number, fieldName: string): Result<number, ValidationError>
- RequirePresent(value: unknown, fieldName: string): Result<void, ValidationError>

## Actions

### DeleteConversation (conversationId: string): Result<void, ValidationError | NotFoundError | StoreError | BlobStoreError>

1. RequireNonEmptyString(conversationId, "conversationId") → if failure, return failure.
2. GetConversation(conversationId) → conversation → if failure, return failure.
3. ReadAllMessagesFromMessageDBStore(conversationId) → messages → if failure, return failure.
4. For each message: Message in messages:
   1. For each fileId: string in message.fileIds:
      1. DeleteFile(fileId) → if failure, return failure.
   2. DeleteMessage(message.id) → if failure, return failure.
5. RemoveFromConversationDBStore(conversationId) → if failure, return failure.
6. Return succeed(void).

### AppendMessageToConversation (request: AppendMessageRequest): Result<Message, ValidationError | NotFoundError | StoreError | BlobStoreError | ConstructionError>

1. RequireNonEmptyString(request.conversationId, "conversationId") → if failure, return failure.
2. RequirePresent(request.textContent, "textContent") → if failure, return failure.
3. For each attachment: Attachment in request.attachments:
   1. RequirePresent(attachment.content, "attachment.content") → if failure, return failure.
   2. RequireNonEmptyString(attachment.filename, "attachment.filename") → if failure, return failure.
   3. RequireNonEmptyString(attachment.mimeType, "attachment.mimeType") → if failure, return failure.
4. GetConversation(request.conversationId) → conversation → if failure, return failure.
5. ReadMessageCountFromMessageDBStore(request.conversationId) → messageCount → if failure, return failure.
6. Derive sequenceNumber from messageCount + 1.
7. For each attachment: Attachment in request.attachments:
   1. UploadFile(request: UploadFileRequest) → file → if failure, return failure.
8. CreateMessage(request: CreateMessageRequest) → message → if failure, return failure.
9. Return succeed(message).

### GetMessagesOnConversation (conversationId: string, pageNum: number, pageSize: number): Result<Message[], ValidationError | NotFoundError | StoreError>

1. RequireNonEmptyString(conversationId, "conversationId") → if failure, return failure.
2. RequirePositiveInteger(pageNum, "pageNum") → if failure, return failure.
3. RequirePositiveInteger(pageSize, "pageSize") → if failure, return failure.
4. GetConversation(conversationId) → conversation → if failure, return failure.
5. Compute fromSequence = (pageNum - 1) * pageSize + 1.
6. ReadPageFromMessageDBStore(conversationId, fromSequence, pageSize) → messages → if failure, return failure.
7. Return succeed(messages).

### ListConversations (pageNum: number, pageSize: number): Result<Conversation[], ValidationError | StoreError>

1. RequirePositiveInteger(pageNum, "pageNum") → if failure, return failure.
2. RequirePositiveInteger(pageSize, "pageSize") → if failure, return failure.
3. Compute offset = (pageNum - 1) * pageSize.
4. ReadPageFromConversationDBStore(offset, pageSize) → conversations → if failure, return failure.
5. Return succeed(conversations).

### CreateConversation (): Result<Conversation, ConstructionError | StoreError>

1. Now() → timestamp.
2. Construct Conversation(createdAt: timestamp, updatedAt: timestamp) → conversation → if failure, return failure.
3. PersistToConversationDBStore(conversation) → conversation → if failure, return failure.
4. Return succeed(conversation).

### GetConversation (conversationId: string): Result<Conversation, NotFoundError | StoreError>

1. ReadFromConversationDBStore(conversationId) → conversation → if failure, return failure.
2. Return succeed(conversation).

### CreateMessage (request: CreateMessageRequest): Result<Message, ValidationError | ConstructionError | StoreError>

1. RequireNonEmptyString(request.conversationId, "conversationId") → if failure, return failure.
2. RequirePresent(request.textContent, "textContent") → if failure, return failure.
3. For each fileId: string in request.fileIds:
   1. RequireNonEmptyString(fileId, "fileId") → if failure, return failure.
4. Now() → timestamp.
5. Construct Message(request.conversationId, request.textContent, createdAt: timestamp, updatedAt: timestamp, request.fileIds) → message → if failure, return failure.
6. PersistToMessageDBStore(message) → message → if failure, return failure.
7. Return succeed(message).

### GetMessage (messageId: string): Result<Message, NotFoundError | StoreError>

1. ReadFromMessageDBStore(messageId) → message → if failure, return failure.
2. Return succeed(message).

### DeleteMessage (messageId: string): Result<void, NotFoundError | StoreError>

1. ReadFromMessageDBStore(messageId) → if failure, return failure.
2. RemoveFromMessageDBStore(messageId) → if failure, return failure.
3. Return succeed(void).

### UploadFile (request: UploadFileRequest): Result<File, ValidationError | ConstructionError | BlobStoreError | StoreError>

1. RequirePresent(request.content, "content") → if failure, return failure.
2. RequireNonEmptyString(request.filename, "filename") → if failure, return failure.
3. RequireNonEmptyString(request.mimeType, "mimeType") → if failure, return failure.
4. UploadToBlobStore(request.content) → canonicalUrl → if failure, return failure.
5. Now() → timestamp.
6. Construct File(canonicalUrl, request.filename, request.mimeType, sizeInBytes, createdAt: timestamp, updatedAt: timestamp) → file → if failure, return failure.
7. PersistToFileDBStore(file) → file → if failure, return failure.
8. Return succeed(file).

### GetFile (fileId: string): Result<FileContent, NotFoundError | StoreError | BlobStoreError>

1. ReadFromFileDBStore(fileId) → file → if failure, return failure.
2. FetchFromBlobStore(file.canonicalUrl) → content → if failure, return failure.
3. Return succeed(content).

### DeleteFile (fileId: string): Result<void, NotFoundError | StoreError | BlobStoreError>

1. ReadFromFileDBStore(fileId) → file → if failure, return failure.
2. DeleteFromBlobStore(file.canonicalUrl) → if failure, return failure.
3. RemoveFromFileDBStore(fileId) → if failure, return failure.
4. Return succeed(void).

### PersistToConversationDBStore (conversation: Conversation): Result<Conversation, StoreError>

1. Infra.UpsertConversationRow(conversation) → conversation → if failure, return failure.

### ReadFromConversationDBStore (id: string): Result<Conversation, NotFoundError | StoreError>

1. Infra.SelectConversationRow(id) → conversation → if failure, return failure.

### ReadPageFromConversationDBStore (offset: number, pageSize: number): Result<Conversation[], StoreError>

1. Infra.SelectConversationPage(offset, pageSize) → conversations → if failure, return failure.

### RemoveFromConversationDBStore (id: string): Result<void, StoreError>

1. Infra.DeleteConversationRow(id) → if failure, return failure.

### PersistToMessageDBStore (message: Message): Result<Message, StoreError>

1. Infra.UpsertMessageRow(message) → message → if failure, return failure.

### ReadFromMessageDBStore (id: string): Result<Message, NotFoundError | StoreError>

1. Infra.SelectMessageRow(id) → message → if failure, return failure.

### ReadPageFromMessageDBStore (conversationId: string, fromSequence: number, pageSize: number): Result<Message[], StoreError>

1. Infra.SelectMessagePage(conversationId, fromSequence, pageSize) → messages → if failure, return failure.

### ReadAllMessagesFromMessageDBStore (conversationId: string): Result<Message[], StoreError>

1. Infra.SelectAllMessagesByConversation(conversationId) → messages → if failure, return failure.

### ReadMessageCountFromMessageDBStore (conversationId: string): Result<number, StoreError>

1. Infra.CountMessagesByConversation(conversationId) → count → if failure, return failure.

### RemoveFromMessageDBStore (id: string): Result<void, StoreError>

1. Infra.DeleteMessageRow(id) → if failure, return failure.

### PersistToFileDBStore (file: File): Result<File, StoreError>

1. Infra.UpsertFileRow(file) → file → if failure, return failure.

### ReadFromFileDBStore (id: string): Result<File, NotFoundError | StoreError>

1. Infra.SelectFileRow(id) → file → if failure, return failure.

### RemoveFromFileDBStore (id: string): Result<void, StoreError>

1. Infra.DeleteFileRow(id) → if failure, return failure.

### UploadToBlobStore (content: FileContent): Result<string, BlobStoreError>

1. Infra.PutBlob(content) → url → if failure, return failure.

### FetchFromBlobStore (url: string): Result<FileContent, BlobStoreError>

1. Infra.GetBlob(url) → content → if failure, return failure.

### DeleteFromBlobStore (url: string): Result<void, BlobStoreError>

1. Infra.RemoveBlob(url) → if failure, return failure.

## Infra Actions

### Infra.UpsertConversationRow (conversation: Conversation): Result<Conversation, StoreError>

1. MapToRow(conversation) → row.
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

### Infra.UpsertMessageRow (message: Message): Result<Message, StoreError>

1. MapToRow(message) → row.
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

1. PostgresClient.query(SelectByFieldQuery("messages", "conversationId", conversationId)) → rows → if error, return StoreError.
2. For each row in rows: MapFromRow(row) → message.
3. Return succeed(messages).

### Infra.CountMessagesByConversation (conversationId: string): Result<number, StoreError>

1. PostgresClient.query(CountByFieldQuery("messages", "conversationId", conversationId)) → count → if error, return StoreError.
2. Return succeed(count).

### Infra.DeleteMessageRow (id: string): Result<void, StoreError>

1. PostgresClient.query(DeleteByIdQuery("messages", id)) → if error, return StoreError.
2. Return succeed(void).

### Infra.UpsertFileRow (file: File): Result<File, StoreError>

1. MapToRow(file) → row.
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

### Infra.GetBlob (url: string): Result<FileContent, BlobStoreError>

1. R2Client.fetch(url) → content → if error, return BlobStoreError.
2. Return succeed(content).

### Infra.RemoveBlob (url: string): Result<void, BlobStoreError>

1. R2Client.delete(url) → if error, return BlobStoreError.
2. Return succeed(void).

## Notes

- Actions use early-return-on-failure: the first `Failure` result short-circuits
  the action. Loops also short-circuit on the first failure.
- `Now()` is infallible — not wrapped in `Result`.
- Entity IDs are auto-generated by the database during insert. The
  `PersistTo*DBStore` operations return the entity with its generated ID.
- `NotFoundError` is separate from `StoreError` so callers can map to different
  HTTP status codes (404 vs 500).
- `FileContent` is opaque in the domain layer — the domain never inspects or
  transforms it. The implementations of `UploadToBlobStore` and
  `FetchFromBlobStore` are responsible for checking and casting to the actual
  runtime representation (e.g. `Buffer`, `ReadableStream`).
- Message ordering and pagination are derived from `sequenceNumber` on `Message`
  combined with `conversationId`. `DeleteConversation` and
  `AppendMessageToConversation` query the message store by `conversationId`
  directly.

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

Each iteration was checked in as a separate commit to preserve the
decision history.
