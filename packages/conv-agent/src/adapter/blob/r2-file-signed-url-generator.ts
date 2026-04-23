import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { BlobStorageConfig } from "../../config";
import type { CreateSignedUrlOptions, FileSignedUrlGenerator } from "../../domain/contracts/file-signed-url-generator";
import { EntityType, StoreError, StoreOperation } from "../../domain/objects/errors";
import type { File as DomainFile } from "../../domain/objects/message-types";
import { failure, type Result, success } from "../../domain/objects/result";

const DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS = 120;
const MAX_SIGNED_URL_EXPIRES_IN_SECONDS = 604_800;
const FILES_CANONICAL_PATH_PREFIX = "/files/";

export class R2FileSignedUrlGenerator implements FileSignedUrlGenerator {
  constructor(
    private readonly config: BlobStorageConfig,
    private readonly client: S3Client,
  ) {}

  async createSignedUrl(file: DomainFile, options: CreateSignedUrlOptions = {}): Promise<Result<string, StoreError>> {
    try {
      const objectKey = this.getObjectKey(file.canonicalUrl);
      const signedUrl = await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
        }),
        { expiresIn: getExpiresInSeconds(options.expiry_time_sec) },
      );

      return success(signedUrl);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Read, getErrorMessage(error)));
    }
  }

  private getObjectKey(canonicalPath: string): string {
    if (!canonicalPath.startsWith(FILES_CANONICAL_PATH_PREFIX)) {
      throw new Error("File canonical URL must start with /files/.");
    }

    const trimmedFolder = trimSlashes(this.config.folder);
    const trimmedPath = canonicalPath.replace(/^\/+/, "");

    if (trimmedFolder.length === 0) {
      return trimmedPath;
    }

    return `${trimmedFolder}/${trimmedPath}`;
  }
}

function getExpiresInSeconds(expiry_time_sec: number | undefined): number {
  const expiresInSeconds = expiry_time_sec ?? DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS;

  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > MAX_SIGNED_URL_EXPIRES_IN_SECONDS) {
    throw new Error(`Signed URL expiration must be an integer from 1 to ${MAX_SIGNED_URL_EXPIRES_IN_SECONDS} seconds.`);
  }

  return expiresInSeconds;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected signed URL generation error.";
}
