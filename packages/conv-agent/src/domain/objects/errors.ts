export class ValidationError {
  readonly kind = "ValidationError";

  constructor(
    readonly fieldName: string,
    readonly message: string,
  ) {}
}

export class NotFoundError {
  readonly kind = "NotFoundError";
  readonly entityType = "Conversation";

  constructor(readonly id: string) {}
}

export class StoreError {
  readonly kind = "StoreError";
  readonly entityType = "Conversation";

  constructor(
    readonly operation: "persist" | "read" | "remove" | "readPage",
    readonly message: string,
  ) {}
}

export class ConstructionError {
  readonly kind = "ConstructionError";
  readonly entityType = "Conversation";

  constructor(readonly message: string) {}
}

export type ConversationError =
  | ValidationError
  | NotFoundError
  | StoreError
  | ConstructionError;
