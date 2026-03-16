import type {
  CreateConversationRecord,
  ConversationRepository,
} from "../domain/contracts/conversation-repository";
import type { StoreError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";

export interface CreateConversationResult {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class CreateConversationFlow {
  constructor(
    private readonly repository: ConversationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<Result<CreateConversationResult, StoreError>> {
    const result = await this.repository.create(this.buildRecord());

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        id: result.value.id,
        createdAt: result.value.createdAt,
        updatedAt: result.value.updatedAt,
      },
    };
  }

  private buildRecord(): CreateConversationRecord {
    const timestamp = this.now();

    return {
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}
