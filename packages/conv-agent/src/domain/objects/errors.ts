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
}

export enum BlobStoreOperation {
  Upload = "upload",
  Fetch = "fetch",
  Delete = "delete",
}

const BLOB_STORE_OPERATION_VALUES = new Set<BlobStoreOperation>([BlobStoreOperation.Upload, BlobStoreOperation.Fetch, BlobStoreOperation.Delete]);

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

export class BlobStoreError {
  readonly kind = "BlobStoreError";

  constructor(
    readonly operation: BlobStoreOperation,
    readonly message: string,
  ) {
    if (!BLOB_STORE_OPERATION_VALUES.has(operation)) {
      throw new Error(`Unsupported blob store operation: ${operation}`);
    }
  }
}

export class ConstructionError {
  readonly kind = "ConstructionError";

  constructor(
    readonly entityType: string,
    readonly message: string,
  ) {}
}

export class LlmError {
  readonly kind = "LlmError";

  constructor(readonly message: string) {}
}
