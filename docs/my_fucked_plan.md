## Entities

```ts
class Conversation {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly messageIds: ReadonlyArray<string>;
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

- GenerateId(): string
- Now(): Date
- Construct<T>(...props): Result<T, ConstructionError>
- RequireNonEmptyString(value: string, fieldName: string): Result<string, ValidationError>
- RequirePositiveInteger(value: number, fieldName: string): Result<number, ValidationError>
- RequirePresent(value: unknown, fieldName: string): Result<void, ValidationError>

- Infra.PersistToConversationDBStore(conversation: Conversation): Result<void, StoreError>
- Infra.ReadFromConversationDBStore(id: string): Result<Conversation, NotFoundError | StoreError>
- Infra.RemoveFromConversationDBStore(id: string): Result<void, StoreError>

- Infra.PersistToMessageDBStore(message: Message): Result<void, StoreError>
- Infra.ReadFromMessageDBStore(id: string): Result<Message, NotFoundError | StoreError>
- Infra.ReadPageFromMessageDBStore(conversationId: string, fromSequence: number, pageSize: number): Result<Message[], StoreError>
- Infra.RemoveFromMessageDBStore(id: string): Result<void, StoreError>

- Infra.PersistToFileDBStore(file: File): Result<void, StoreError>
- Infra.ReadFromFileDBStore(id: string): Result<File, NotFoundError | StoreError>
- Infra.RemoveFromFileDBStore(id: string): Result<void, StoreError>

- Infra.UploadToBlobStore(content: FileContent): Result<string, BlobStoreError>
- Infra.FetchFromBlobStore(url: string): Result<FileContent, BlobStoreError>
- Infra.DeleteFromBlobStore(url: string): Result<void, BlobStoreError>

## Actions

### App.DeleteConversation (conversationId: string): Result<void, ValidationError | NotFoundError | StoreError | BlobStoreError>

1. RequireNonEmptyString(conversationId, "conversationId") → if failure, return failure.
2. GetConversation(conversationId) → conversation → if failure, return failure.
3. For each messageId: string in conversation.messageIds:
   1. GetMessage(messageId) → message → if failure, return failure.
   2. For each fileId: string in message.fileIds:
      1. DeleteFile(fileId) → if failure, return failure.
   3. DeleteMessage(messageId) → if failure, return failure.
4. Infra.RemoveFromConversationDBStore(conversationId) → if failure, return failure.
5. Return succeed(void).

### App.AppendMessageToConversation (request: AppendMessageRequest): Result<Message, ValidationError | NotFoundError | StoreError | BlobStoreError | ConstructionError>

1. RequireNonEmptyString(request.conversationId, "conversationId") → if failure, return failure.
2. RequirePresent(request.textContent, "textContent") → if failure, return failure.
3. For each attachment: Attachment in request.attachments:
   1. RequirePresent(attachment.content, "attachment.content") → if failure, return failure.
   2. RequireNonEmptyString(attachment.filename, "attachment.filename") → if failure, return failure.
   3. RequireNonEmptyString(attachment.mimeType, "attachment.mimeType") → if failure, return failure.
4. GetConversation(request.conversationId) → conversation → if failure, return failure.
5. Derive sequenceNumber from conversation.messageIds.length + 1.
6. For each attachment: Attachment in request.attachments:
   1. UploadFile(request: UploadFileRequest) → file → if failure, return failure.
7. CreateMessage(request: CreateMessageRequest) → message → if failure, return failure.
8. UpdateConversation(conversation: Conversation) → if failure, return failure.
9. Return succeed(message).

### App.CreateConversation (): Result<Conversation, ConstructionError | StoreError>

1. GenerateId() → id.
2. Now() → timestamp.
3. Construct Conversation(id, createdAt: timestamp, updatedAt: timestamp, messageIds: []) → conversation → if failure, return failure.
4. Infra.PersistToConversationDBStore(conversation) → if failure, return failure.
5. Return succeed(conversation).

### App.GetMessagesOnConversation (conversationId: string, pageNum: number, pageSize: number): Result<Message[], ValidationError | NotFoundError | StoreError>

1. RequireNonEmptyString(conversationId, "conversationId") → if failure, return failure.
2. RequirePositiveInteger(pageNum, "pageNum") → if failure, return failure.
3. RequirePositiveInteger(pageSize, "pageSize") → if failure, return failure.
4. GetConversation(conversationId) → conversation → if failure, return failure.
5. Compute fromSequence = (pageNum - 1) * pageSize + 1.
6. Infra.ReadPageFromMessageDBStore(conversationId, fromSequence, pageSize) → messages → if failure, return failure.
7. Return succeed(messages).

### UpdateConversation (conversation: Conversation): Result<Conversation, NotFoundError | StoreError>

1. Infra.ReadFromConversationDBStore(conversation.id) → if failure, return failure.
2. Infra.PersistToConversationDBStore(conversation) → if failure, return failure.
3. Return succeed(conversation).

### GetConversation (conversationId: string): Result<Conversation, NotFoundError | StoreError>

1. Infra.ReadFromConversationDBStore(conversationId) → conversation → if failure, return failure.
2. Return succeed(conversation).

### CreateMessage (request: CreateMessageRequest): Result<Message, ValidationError | ConstructionError | StoreError>

1. RequireNonEmptyString(request.conversationId, "conversationId") → if failure, return failure.
2. RequirePresent(request.textContent, "textContent") → if failure, return failure.
3. For each fileId: string in request.fileIds:
   1. RequireNonEmptyString(fileId, "fileId") → if failure, return failure.
4. GenerateId() → id.
5. Now() → timestamp.
6. Construct Message(id, request.conversationId, request.textContent, createdAt: timestamp, updatedAt: timestamp, request.fileIds) → message → if failure, return failure.
7. Infra.PersistToMessageDBStore(message) → if failure, return failure.
8. Return succeed(message).

### GetMessage (messageId: string): Result<Message, NotFoundError | StoreError>

1. Infra.ReadFromMessageDBStore(messageId) → message → if failure, return failure.
2. Return succeed(message).

### DeleteMessage (messageId: string): Result<void, NotFoundError | StoreError>

1. Infra.ReadFromMessageDBStore(messageId) → if failure, return failure.
2. Infra.RemoveFromMessageDBStore(messageId) → if failure, return failure.
3. Return succeed(void).

### UploadFile (request: UploadFileRequest): Result<File, ValidationError | ConstructionError | BlobStoreError | StoreError>

1. RequirePresent(request.content, "content") → if failure, return failure.
2. RequireNonEmptyString(request.filename, "filename") → if failure, return failure.
3. RequireNonEmptyString(request.mimeType, "mimeType") → if failure, return failure.
4. GenerateId() → id.
5. Infra.UploadToBlobStore(request.content) → canonicalUrl → if failure, return failure.
6. Now() → timestamp.
7. Construct File(id, canonicalUrl, request.filename, request.mimeType, sizeInBytes, createdAt: timestamp, updatedAt: timestamp) → file → if failure, return failure.
8. Infra.PersistToFileDBStore(file) → if failure, return failure.
9. Return succeed(file).

### GetFile (fileId: string): Result<FileContent, NotFoundError | StoreError | BlobStoreError>

1. Infra.ReadFromFileDBStore(fileId) → file → if failure, return failure.
2. Infra.FetchFromBlobStore(file.canonicalUrl) → content → if failure, return failure.
3. Return succeed(content).

### DeleteFile (fileId: string): Result<void, NotFoundError | StoreError | BlobStoreError>

1. Infra.ReadFromFileDBStore(fileId) → file → if failure, return failure.
2. Infra.DeleteFromBlobStore(file.canonicalUrl) → if failure, return failure.
3. Infra.RemoveFromFileDBStore(fileId) → if failure, return failure.
4. Return succeed(void).

## Notes

- Actions use early-return-on-failure: the first `Failure` result short-circuits
  the action. Loops also short-circuit on the first failure.
- `GenerateId()` and `Now()` are infallible — not wrapped in `Result`.
- `NotFoundError` is separate from `StoreError` so callers can map to different
  HTTP status codes (404 vs 500).
- `FileContent` is opaque in the domain layer — the domain never inspects or
  transforms it. The implementations of `Infra.UploadToBlobStore` and
  `Infra.FetchFromBlobStore` are responsible for checking and casting to the actual
  runtime representation (e.g. `Buffer`, `ReadableStream`).
- `messageIds` on `Conversation` is redundant. Message ordering and pagination
  can be derived entirely from `sequenceNumber` on `Message` combined with
  `conversationId`. It is kept for now as a denormalized index so that
  `DeleteConversation` and `AppendMessageToConversation` can resolve related
  messages without querying the message store. This may be removed in a future
  iteration once those actions query by `conversationId` directly.

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
