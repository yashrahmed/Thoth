export type EntityType = "Conversation" | "Message" | "File";

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
    readonly operation: "persist" | "read" | "remove" | "readPage",
    readonly message: string,
  ) {}
}

export class BlobStoreError {
  readonly kind = "BlobStoreError";

  constructor(
    readonly operation: "upload" | "fetch" | "delete",
    readonly message: string,
  ) {}
}

export class ConstructionError {
  readonly kind = "ConstructionError";

  constructor(
    readonly entityType: EntityType,
    readonly message: string,
  ) {}
}

export type DomainError =
  | ValidationError
  | NotFoundError
  | StoreError
  | BlobStoreError
  | ConstructionError;

export type ConversationError = DomainError;
