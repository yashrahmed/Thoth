export class DeleteConversationRequest {
  readonly conversationId: string;

  constructor(conversationId: string) {
    this.conversationId = conversationId;
  }
}
