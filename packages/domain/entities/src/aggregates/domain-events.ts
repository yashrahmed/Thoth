export interface DomainEvent {
  type: string;
  aggregateId: string;
  occurredAt: Date;
}

export interface ConversationCreated extends DomainEvent {
  type: "conversation.created";
}

export interface MessagePosted extends DomainEvent {
  type: "conversation.message_posted";
  messageId: string;
}

export interface MessageRemoved extends DomainEvent {
  type: "conversation.message_removed";
  messageId: string;
}
