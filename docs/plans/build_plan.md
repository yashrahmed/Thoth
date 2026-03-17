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

### Flow Input/Output Types

```ts
type DeleteConversationCommand = {
  readonly conversationId: string;
};

type AppendMessageRequest = {
  readonly conversationId: string;
  readonly textContent: string;
  readonly attachments: ReadonlyArray<Attachment>;
};

type Attachment = {
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;
};

type AppendMessageResult = {
  readonly id: string;
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly textContent: string;
  readonly fileIds: ReadonlyArray<string>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type GetMessagesQuery = {
  readonly conversationId: string;
  readonly pageNum: number;
  readonly pageSize: number;
};

type GetMessagesItem = {
  readonly id: string;
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly textContent: string;
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

type CreateMessageInput = {
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly textContent: string;
  readonly fileIds: ReadonlyArray<string>;
};

type CreateNextMessageInput = {
  readonly conversationId: string;
  readonly textContent: string;
  readonly fileIds: ReadonlyArray<string>;
};

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

type CreateMessageRecord = {
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly textContent: string;
  readonly fileIds: ReadonlyArray<string>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type CreateFileRecord = {
  readonly canonicalUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeInBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
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

### App.DeleteConversation (command: DeleteConversationCommand): Result<void, ValidationError | NotFoundError | StoreError | BlobStoreError>

1. ReadFromConversationDBStore(command.conversationId) → conversation → if failure, return failure.
2. ReadAllMessagesFromMessageDBStore(command.conversationId) → messages → if failure, return failure.
3. For each message: Message in messages:
   1. DeleteMessageWithFiles(message.id) → if failure, return failure.
4. RemoveFromConversationDBStore(command.conversationId) → if failure, return failure.
5. Return succeed(void).

### App.AppendMessageToConversation (request: AppendMessageRequest): Result<AppendMessageResult, ValidationError | NotFoundError | StoreError | BlobStoreError>

1. ReadFromConversationDBStore(request.conversationId) → conversation → if failure, return failure.
2. UploadFiles({ files: request.attachments mapped to UploadFileInput[] }) → files → if failure, return failure.
3. CreateNextMessage({ conversationId, textContent, fileIds from files }) → message → if failure, return failure.
4. Map message to AppendMessageResult({ id, conversationId, sequenceNumber, textContent, fileIds, createdAt, updatedAt }).
5. Return succeed(appendMessageResult).

### App.GetMessagesOnConversation (query: GetMessagesQuery): Result<GetMessagesItem[], ValidationError | NotFoundError | StoreError>

1. ReadFromConversationDBStore(query.conversationId) → conversation → if failure, return failure.
2. ReadPageFromMessageDBStore(query.conversationId, query.pageNum, query.pageSize) → messages → if failure, return failure.
3. For each message: Message in messages:
   1. GetFiles({ fileIds: message.fileIds }) → files → if failure, return failure.
   2. Map message and files to GetMessagesItem({ id, conversationId, sequenceNumber, textContent, files mapped to GetMessagesFile[], createdAt, updatedAt }).
4. Return succeed(items).

### App.ListConversations (query: ListConversationsQuery): Result<ListConversationsItem[], ValidationError | StoreError>

1. ReadPageFromConversationDBStore(query.pageNum, query.pageSize) → conversations → if failure, return failure.
2. Map each conversation to ListConversationsItem({ id, createdAt, updatedAt }).
3. Return succeed(items).

### App.CreateConversation (): Result<CreateConversationResult, StoreError>

1. Now() → timestamp.
2. PersistToConversationDBStore({ createdAt: timestamp, updatedAt: timestamp }) → conversation → if failure, return failure.
3. Map conversation to CreateConversationResult({ id, createdAt, updatedAt }).
4. Return succeed(createConversationResult).

### App.GetConversation (query: GetConversationQuery): Result<GetConversationResult, ValidationError | NotFoundError | StoreError>

1. ReadFromConversationDBStore(query.conversationId) → conversation → if failure, return failure.
2. Map conversation to GetConversationResult({ id, createdAt, updatedAt }).
3. Return succeed(getConversationResult).

### CreateMessage (request: CreateMessageInput): Result<Message, ValidationError | StoreError>

1. Now() → timestamp.
2. PersistToMessageDBStore({ conversationId, sequenceNumber, textContent, fileIds, createdAt: timestamp, updatedAt: timestamp }) → message → if failure, return failure.
3. Return succeed(message).

### CreateNextMessage (request: CreateNextMessageInput): Result<Message, ValidationError | StoreError>

1. ReadMessageCountFromMessageDBStore(request.conversationId) → count → if failure, return failure.
2. CreateMessage({ conversationId, sequenceNumber: count + 1, textContent, fileIds }) → message → if failure, return failure.
3. Return succeed(message).

### DeleteMessage (messageId: string): Result<void, ValidationError | NotFoundError | StoreError>

1. ReadFromMessageDBStore(messageId) → if failure, return failure.
2. RemoveFromMessageDBStore(messageId) → if failure, return failure.
3. Return succeed(void).

### DeleteMessageWithFiles (messageId: string): Result<void, ValidationError | NotFoundError | StoreError | BlobStoreError>

1. ReadFromMessageDBStore(messageId) → message → if failure, return failure.
2. For each fileId: string in message.fileIds:
   1. DeleteFile(fileId) → if failure, return failure.
3. RemoveFromMessageDBStore(messageId) → if failure, return failure.
4. Return succeed(void).

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

### ReadPageFromConversationDBStore (pageNum: number, pageSize: number): Result<Conversation[], ValidationError | StoreError>

1. RequirePositiveInteger(pageNum, "pageNum") → if failure, return failure.
2. RequirePositiveInteger(pageSize, "pageSize") → if failure, return failure.
3. Compute offset = (pageNum - 1) * pageSize.
4. Infra.SelectConversationPage(offset, pageSize) → conversations → if failure, return failure.

### RemoveFromConversationDBStore (id: string): Result<void, ValidationError | StoreError>

1. RequireNonEmptyString(id, "id") → if failure, return failure.
2. Infra.DeleteConversationRow(id) → if failure, return failure.

### PersistToMessageDBStore (record: CreateMessageRecord): Result<Message, ValidationError | StoreError>

1. RequireNonEmptyString(record.conversationId, "conversationId") → if failure, return failure.
2. RequirePositiveInteger(record.sequenceNumber, "sequenceNumber") → if failure, return failure.
3. RequirePresent(record.textContent, "textContent") → if failure, return failure.
4. For each fileId: string in record.fileIds:
   1. RequireNonEmptyString(fileId, "fileId") → if failure, return failure.
5. Infra.UpsertMessageRow(record) → message → if failure, return failure.

### ReadFromMessageDBStore (id: string): Result<Message, ValidationError | NotFoundError | StoreError>

1. RequireNonEmptyString(id, "id") → if failure, return failure.
2. Infra.SelectMessageRow(id) → message → if failure, return failure.

### ReadPageFromMessageDBStore (conversationId: string, pageNum: number, pageSize: number): Result<Message[], ValidationError | StoreError>

1. RequireNonEmptyString(conversationId, "conversationId") → if failure, return failure.
2. RequirePositiveInteger(pageNum, "pageNum") → if failure, return failure.
3. RequirePositiveInteger(pageSize, "pageSize") → if failure, return failure.
4. Compute fromSequence = (pageNum - 1) * pageSize + 1.
5. Infra.SelectMessagePage(conversationId, fromSequence, pageSize) → messages → if failure, return failure.

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

### UploadToBlobStore (request: { conversationId: string, content: FileContent, filename: string, mimeType: string }): Result<string, ValidationError | BlobStoreError>

1. RequirePresent(request.content, "content") → if failure, return failure.
2. RequireNonEmptyString(request.conversationId, "conversationId") → if failure, return failure.
3. RequireNonEmptyString(request.filename, "filename") → if failure, return failure.
4. RequireNonEmptyString(request.mimeType, "mimeType") → if failure, return failure.
5. Infra.PutBlob(request) → url → if failure, return failure.

### DeleteFromBlobStore (canonicalUrl: string): Result<void, ValidationError | BlobStoreError>

1. RequireNonEmptyString(canonicalUrl, "canonicalUrl") → if failure, return failure.
2. Infra.RemoveBlob(canonicalUrl) → if failure, return failure.

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

1. MapToRow(record) → row.
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
