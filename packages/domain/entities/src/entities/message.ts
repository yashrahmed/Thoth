import { Attachment } from "./attachment";
import { MessageId, MessageRole, MessageText } from "../value-objects";

export interface MessageProps {
  id: MessageId;
  role: MessageRole;
  text: MessageText | null;
  attachments: Attachment[];
  createdAt: Date;
  updatedAt: Date;
}

export class Message {
  public readonly id: MessageId;
  public readonly role: MessageRole;
  public readonly text: MessageText | null;
  public readonly attachments: readonly Attachment[];
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  public constructor(props: MessageProps) {
    if (props.attachments.length === 0 && props.text === null) {
      throw new Error("Message must include text or at least one attachment.");
    }

    this.id = props.id;
    this.role = props.role;
    this.text = props.text;
    this.attachments = [...props.attachments];
    this.createdAt = new Date(props.createdAt);
    this.updatedAt = new Date(props.updatedAt);
  }

  public get textContent(): string | null {
    return this.text?.value ?? null;
  }
}
