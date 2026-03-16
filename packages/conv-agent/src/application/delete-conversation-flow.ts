import type { ConversationRepository } from "../domain/contracts/conversation-repository";
import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import { type Result, success } from "../domain/objects/result";
import { requireNonEmptyString } from "./validators";

export interface DeleteConversationCommand {
  readonly conversationId: string;
}

export class DeleteConversationFlow {
  constructor(private readonly repository: ConversationRepository) {}

  async execute(
    command: DeleteConversationCommand,
  ): Promise<Result<void, NotFoundError | StoreError | ValidationError>> {
    const conversationIdResult = requireNonEmptyString(
      command.conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const getResult = await this.repository.getById(conversationIdResult.value);

    if (!getResult.ok) {
      return getResult;
    }

    const deleteResult = await this.repository.deleteById(conversationIdResult.value);

    if (!deleteResult.ok) {
      return deleteResult;
    }

    return success(undefined);
  }
}
