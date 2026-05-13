export enum EntityType {
  Conversation = "Conversation",
  Message = "Message",
  File = "File",
}

export enum StoreOperation {
  Persist = "persist",
  Read = "read",
  Remove = "remove",
  ReadPage = "readPage",
  Update = "update",
}

export class ValidationError {
  readonly kind = "ValidationError";

  constructor(
    readonly fieldName: string,
    readonly message: string,
  ) {}
}

export class NotFoundError {
  readonly kind = "NotFoundError";

  constructor(
    readonly entityType: EntityType,
    readonly id: string,
  ) {}
}

export class StoreError {
  readonly kind = "StoreError";

  constructor(
    readonly entityType: EntityType,
    readonly operation: StoreOperation,
    readonly message: string,
  ) {}
}

export type LlmErrorCode = "timeout" | "other";

export class LlmError {
  readonly kind = "LlmError";

  constructor(
    readonly message: string,
    readonly code: LlmErrorCode = "other",
  ) {}
}
