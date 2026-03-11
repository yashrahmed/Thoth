import type {
  ConversationCreated,
  DomainEvent,
  MessagePosted,
  MessageRemoved,
} from "./domain-events";
import { Message } from "../entities/message";
import {
  ConversationId,
  MessageId,
  MessageRole,
  MessageText,
} from "../value-objects";
import { Attachment } from "../entities/attachment";

export interface PostMessageProps {
  id: MessageId;
  role: MessageRole;
  textContent: string | null;
  attachments: Attachment[];
  occurredAt: Date;
}

export interface ConversationRehydrateProps {
  id: ConversationId;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

export class Conversation {
  public readonly id: ConversationId;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  private readonly messageList: Message[];
  private readonly pendingEvents: DomainEvent[];

  private constructor(
    id: ConversationId,
    messages: Message[],
    createdAt: Date,
    updatedAt: Date,
    pendingEvents: DomainEvent[],
  ) {
    this.id = id;
    this.messageList = messages;
    this.createdAt = new Date(createdAt);
    this.updatedAt = new Date(updatedAt);
    this.pendingEvents = pendingEvents;
  }

  public static createNew(input: {
    id: ConversationId;
    createdAt: Date;
  }): Conversation {
    const event: ConversationCreated = {
      type: "conversation.created",
      aggregateId: input.id.value,
      occurredAt: new Date(input.createdAt),
    };

    return new Conversation(
      input.id,
      [],
      input.createdAt,
      input.createdAt,
      [event],
    );
  }

  public static rehydrate(input: ConversationRehydrateProps): Conversation {
    return new Conversation(
      input.id,
      [...input.messages],
      input.createdAt,
      input.updatedAt,
      [],
    );
  }

  public get messages(): readonly Message[] {
    return [...this.messageList];
  }

  public postMessage(input: PostMessageProps): Message {
    if (this.messageList.some((message) => message.id.value === input.id.value)) {
      throw new Error(
        `Conversation "${this.id.value}" already has a message with id "${input.id.value}".`,
      );
    }

    const text =
      input.textContent === null ? null : new MessageText(input.textContent);
    const message = new Message({
      id: input.id,
      role: input.role,
      text,
      attachments: input.attachments,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    });

    this.messageList.push(message);
    const event: MessagePosted = {
      type: "conversation.message_posted",
      aggregateId: this.id.value,
      messageId: message.id.value,
      occurredAt: new Date(input.occurredAt),
    };
    this.pendingEvents.push(event);

    return message;
  }

  public removeMessage(messageId: MessageId, removedAt: Date): Message | null {
    const messageIndex = this.messageList.findIndex(
      (message) => message.id.value === messageId.value,
    );

    if (messageIndex < 0) {
      return null;
    }

    const [removedMessage] = this.messageList.splice(messageIndex, 1);

    const event: MessageRemoved = {
      type: "conversation.message_removed",
      aggregateId: this.id.value,
      messageId: messageId.value,
      occurredAt: new Date(removedAt),
    };
    this.pendingEvents.push(event);

    return removedMessage ?? null;
  }

  public pullDomainEvents(): DomainEvent[] {
    const events = [...this.pendingEvents];
    this.pendingEvents.length = 0;

    return events;
  }

  public withUpdatedTimestamp(updatedAt: Date): Conversation {
    return new Conversation(
      this.id,
      [...this.messageList],
      this.createdAt,
      updatedAt,
      [...this.pendingEvents],
    );
  }
}
