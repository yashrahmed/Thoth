export class GetConversationRequest {
  readonly conversationId: string;

  constructor(conversationId: string) {
    this.conversationId = conversationId;
  }
}
