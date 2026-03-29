# Thoth Data Modeling

## Entity to DB Table Mapping

| Entity       | DB Table            |
| ------------ | ------------------- |
| Conversation | thoth.conversations |
| Message      | thoth.messages      |
| File         | thoth.files         |

## Core Business Model

```typescript
enum LLMMessageType {
  User = "user",
  Assistant = "assistant",
  System = "system",
  Tool = "tool",
}

class Conversation {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

class Message {
  id: string;
  conversationId: string;
  type: LLMMessageType;
  sequenceNumber: number;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

class File {
  id: string;
  messageId: string;
  canonicalUrl: string;
  filename: string;
  mimeType: string;
  sizeInBytes: number;
  createdAt: Date;
  updatedAt: Date;
}
```

## Use-Case Inputs/Outputs

```typescript
class Attachment {
  content: ArrayBuffer;
  filename: string;
  mimeType: string;
}

type CreateMessageInput = Pick<Message, "conversationId" | "type" | "content">;

type InsertNextMessageRecord = Omit<Message, "id" | "sequenceNumber">;

type GetMessagesResponse = Message & { files: File[] };

class GetMessageOnConversationRequest {
  conversation_id: string;
  pageNum: number;
  pageSize: number;
}

class DeleteConversationRequest {
  conversation_id: string;
}

class GetConversationsRequest {
  conversation_id: string;
}

class ListConversationRequest {
  pageNum: number;
  pageSize: number;
}

class AppendMsgToConversationRequest {
  content: string;
  conversation_id: string;
  attachments: Attachment[];
  type: LLMMessageType;
}
```

## Errors

```typescript
class ValidationError {
  kind: string;
  fieldName: string;
  message: string;
}

class NotFoundError {
  kind: string;
  entityType: EntityType;
  id: string;
}

class StoreError {
  kind: string;
  entityType: EntityType;
  operation: StoreOperation;
  message: string;
}

class LlmError {
  kind: string;
  message: string;
}

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
```

## Notes

- File ownership is modeled explicitly through `thoth.files.message_id`.
- Message attachments are resolved by querying files on a message through `thoth.files.message_id`.
- `Attachment` is the request-side upload shape. `File` is the persisted attachment shape.
- `CreateMessageInput` is the application-facing message creation shape.
- `InsertNextMessageRecord` is the repository write shape used for atomic message insertion.
