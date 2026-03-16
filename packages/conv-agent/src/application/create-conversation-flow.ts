import type {
  CreateConversationRecord,
  ConversationRepository,
} from "../domain/contracts/conversation-repository";
import type { Conversation } from "../domain/objects/conversation";
import type { StoreError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";

export class CreateConversationFlow {
  constructor(
    private readonly repository: ConversationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<Result<Conversation, StoreError>> {
    return this.repository.create(this.buildRecord());
  }

  private buildRecord(): CreateConversationRecord {
    const timestamp = this.now();

    return {
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}
