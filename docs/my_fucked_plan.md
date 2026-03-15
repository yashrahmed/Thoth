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
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
```

## Types

```ts
type SortDirection = "asc" | "desc";
type FileContent = Buffer | ReadableStream;
type Attachment = { content: FileContent };
```

## Leaf Operations

```
{Upload, Download, Delete} x {Conversation, Message, File}
```

- CreateConversation(): Conversation
- UpdateConversation(conversation: Conversation): Conversation
- GetConversation(conversationId: string): Conversation
- DeleteConversation(conversationId: string): void
- UploadMessage(id: string, conversationId: string, sequenceNumber: number, textContent: string, createdAt: Date, updatedAt: Date, fileIds: string[]): Message
- GetMessage(messageId: string): Message
- DeleteMessage(messageId: string): void
- UploadFile(content: FileContent): File
- GetFile(fileId: string): FileContent
- DeleteFile(fileId: string): void

## Actions

### CreateConversation (): Conversation

1. CreateConversation().

### DeleteConversation (conversationId: string): void

1. GetConversation(conversationId: string) -> conversation: Conversation.
2. For each messageId: string in conversation.messageIds:
   1. GetMessage(messageId: string) -> message: Message.
   2. For each fileId: string in message.fileIds:
      1. DeleteFile(fileId: string) -> void.
   3. DeleteMessage(messageId: string) -> void.
3. DeleteConversation(conversationId: string) -> void.

### AppendMessage (conversationId: string, textContent: string, attachments: Attachment[]): Message

1. GetConversation(conversationId: string) -> conversation: Conversation.
2. For each attachment: Attachment in attachments:
   1. UploadFile(attachment.content: FileContent) -> file: File.
3. UploadMessage(id: string, conversationId: string, sequenceNumber: number, textContent: string, createdAt: Date, updatedAt: Date, fileIds: string[]) -> message: Message.
4. UpdateConversation(conversation: Conversation) -> Conversation.
