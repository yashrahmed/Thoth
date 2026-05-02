import { randomUUID } from "node:crypto";
import type { BlobStorageConfig } from "../../config/config";
import type { BlobRepository } from "../../domain/contracts/blob-repository";
import { EntityType, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, type Result, success } from "../../domain/objects/result";

const FILES_CANONICAL_PATH_PREFIX = "/files/";

export class R2BlobRepository implements BlobRepository {
  constructor(
    private readonly config: BlobStorageConfig,
    private readonly bucket: R2Bucket,
  ) {}

  async putBlob(request: { readonly content: ArrayBuffer; readonly filename: string; readonly mimeType: string }): Promise<Result<string, StoreError>> {
    const canonicalPath = this.getCanonicalPath(request.filename);
    const objectKey = this.getObjectKey(canonicalPath);

    try {
      await this.bucket.put(objectKey, request.content, {
        httpMetadata: {
          contentType: request.mimeType,
        },
      });

      return success(canonicalPath);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Persist, getErrorMessage(error)));
    }
  }

  async removeBlob(url: string): Promise<Result<void, StoreError>> {
    const objectKey = this.getObjectKey(url);

    try {
      await this.bucket.delete(objectKey);

      return success(undefined);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Remove, getErrorMessage(error)));
    }
  }

  private getCanonicalPath(filename: string): string {
    return `${FILES_CANONICAL_PATH_PREFIX}${randomUUID()}-${sanitizeFilename(filename)}`;
  }

  private getObjectKey(canonicalPath: string): string {
    if (!canonicalPath.startsWith(FILES_CANONICAL_PATH_PREFIX)) {
      throw new Error("Blob canonical path must start with /files/.");
    }

    const trimmedFolder = trimSlashes(this.config.folder);
    const trimmedPath = canonicalPath.replace(/^\/+/, "");

    if (trimmedFolder.length === 0) {
      return trimmedPath;
    }

    return `${trimmedFolder}/${trimmedPath}`;
  }
}

function sanitizeFilename(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "_");

  if (sanitized.length > 0) {
    return sanitized;
  }

  return "file";
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected blob storage error.";
}
