import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { map } from "../domain/objects/result";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";

interface GetConversationQuery {
  readonly conversationId: string;
}

export interface GetConversationResult {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class GetConversationFlow {
  constructor(private readonly conversationDomainService: ConversationDomainService) {}

  async execute(query: GetConversationQuery): Promise<Result<GetConversationResult, NotFoundError | StoreError | ValidationError>> {
    return map(await this.conversationDomainService.findById(query.conversationId), (conv) => ({
      id: conv.id,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }));
  }
}
