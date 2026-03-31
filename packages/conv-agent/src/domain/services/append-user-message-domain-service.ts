import type { AppendUserMessageStore, PersistUserMessageWithFilesInput } from "../contracts/append-user-message-store";
import type { StoreError } from "../objects/errors";
import type { Message } from "../objects/message";
import type { Result } from "../objects/result";

export class AppendUserMessageDomainService {
  constructor(private readonly appendUserMessageStore: AppendUserMessageStore) {}

  async persistUserMessageWithFiles(input: PersistUserMessageWithFilesInput): Promise<Result<Message, StoreError>> {
    return this.appendUserMessageStore.persistUserMessageWithFiles(input);
  }
}
