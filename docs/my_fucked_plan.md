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
type FileContent = Buffer | ReadableStream;
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

## Atomic Operations

- GenerateId(): string
- Now(): Date
- Construct<T>(...props): T
  
- PersistToConversationDBStore(conversation: Conversation): void
- ReadFromConversationDBStore(id: string): Conversation
- RemoveFromConversationDBStore(id: string): void

- PersistToMessageDBStore(message: Message): void
- ReadFromMessageDBStore(id: string): Message
- ReadPageFromMessageDBStore(conversationId: string, fromSequence: number, pageSize: number): Message[]
- RemoveFromMessageDBStore(id: string): void

- PersistToFileDBStore(file: File): void
- ReadFromFileDBStore(id: string): File
- RemoveFromFileDBStore(id: string): void

- UploadToBlobStore(content: FileContent): string
- FetchFromBlobStore(url: string): FileContent
- DeleteFromBlobStore(url: string): void

## Actions

### DeleteConversation (conversationId: string): void

1. GetConversation(conversationId: string) -> conversation: Conversation.
2. For each messageId: string in conversation.messageIds:
   1. GetMessage(messageId: string) -> message: Message.
   2. For each fileId: string in message.fileIds:
      1. DeleteFile(fileId: string) -> void.
   3. DeleteMessage(messageId: string) -> void.
3. DeleteConversation(conversationId: string) -> void.

### AppendMessageToConversation (request: AppendMessageRequest): Message

1. GetConversation(request.conversationId: string) -> conversation: Conversation.
2. Derive sequenceNumber from conversation.messageIds.length + 1.
3. For each attachment: Attachment in request.attachments:
   1. UploadFile(request: UploadFileRequest) -> file: File.
4. CreateMessage(request: CreateMessageRequest) -> message: Message.
5. UpdateConversation(conversation: Conversation) -> Conversation.

### CreateConversation (): Conversation

1. GenerateId() → id.
2. Now() → timestamp.
3. Construct Conversation(id, createdAt: timestamp, updatedAt: timestamp, messageIds: []).
4. PersistToConversationDBStore(conversation).

### UpdateConversation (conversation: Conversation): Conversation

1. ReadFromConversationDBStore(conversation.id) → fail if not found.
2. PersistToConversationDBStore(conversation).

### GetConversation (conversationId: string): Conversation

1. ReadFromConversationDBStore(conversationId) → fail if not found.

### GetMessagesOnConversation (conversationId: string, pageNum: number, pageSize: number): Message[]

1. GetConversation(conversationId: string) -> conversation: Conversation.
2. Compute fromSequence = (pageNum - 1) * pageSize + 1.
3. ReadPageFromMessageDBStore(conversationId, fromSequence, pageSize) -> messages: Message[].

### CreateMessage (request: CreateMessageRequest): Message

1. GenerateId() → id.
2. Now() → timestamp.
3. Construct Message(id, request.conversationId, request.sequenceNumber, request.textContent, createdAt: timestamp, updatedAt: timestamp, request.fileIds).
4. PersistToMessageDBStore(message).

### GetMessage (messageId: string): Message

1. ReadFromMessageDBStore(messageId) → fail if not found.

### DeleteMessage (messageId: string): void

1. ReadFromMessageDBStore(messageId) → fail if not found.
2. RemoveFromMessageDBStore(messageId).

### UploadFile (content: FileContent): File

1. GenerateId() → id.
2. UploadToBlobStore(content) → canonicalUrl.
3. Now() → timestamp.
4. Construct File(id, canonicalUrl, createdAt: timestamp, updatedAt: timestamp).
5. PersistToFileDBStore(file).

### GetFile (fileId: string): FileContent

1. ReadFromFileDBStore(fileId) → file.
2. FetchFromBlobStore(file.canonicalUrl) → content.

### DeleteFile (fileId: string): void

1. ReadFromFileDBStore(fileId) → file.
2. DeleteFromBlobStore(file.canonicalUrl).
3. RemoveFromFileDBStore(fileId).

## Notes

- `messageIds` on `Conversation` is redundant. Message ordering and pagination
  can be derived entirely from `sequenceNumber` on `Message` combined with
  `conversationId`. It is kept for now as a denormalized index so that
  `DeleteConversation` and `AppendMessageToConversation` can resolve related
  messages without querying the message store. This may be removed in a future
  iteration once those actions query by `conversationId` directly.
