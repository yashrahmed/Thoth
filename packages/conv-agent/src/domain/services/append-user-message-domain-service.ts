import type { AppendUserMessageStore, PersistMessagesInput, PersistUserMessageWithFilesInput } from "../contracts/append-user-message-store";
import type { StoreError, ValidationError } from "../objects/errors";
import type { Message, MessageWithFiles } from "../objects/message-types";
import type { Result } from "../objects/result";

export class AppendUserMessageDomainService {
  constructor(private readonly appendUserMessageStore: AppendUserMessageStore) {}

  persistUserMessageWithFiles(input: PersistUserMessageWithFilesInput): Promise<Result<MessageWithFiles, ValidationError | StoreError>> {
    return this.appendUserMessageStore.persistUserMessageWithFiles(input);
  }

  persistMessages(input: PersistMessagesInput): Promise<Result<Message[], ValidationError | StoreError>> {
    return this.appendUserMessageStore.persistMessages(input);
  }
}
