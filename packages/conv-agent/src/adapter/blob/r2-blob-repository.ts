import { Buffer } from "node:buffer";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { BlobRepository } from "../../domain/contracts/blob-repository";
import { EntityType, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, type Result, success } from "../../domain/objects/result";

interface R2BlobConfig {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly folder: string;
}

interface R2BlobCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

const CONVERSATIONS_CANONICAL_PATH_PREFIX = "/conversations/";

enum BlobRequestMethod {
  Put = "PUT",
  Delete = "DELETE",
}

export class R2BlobRepository implements BlobRepository {
  constructor(
    private readonly config: R2BlobConfig,
    private readonly credentials: R2BlobCredentials,
  ) {}

  async putBlob(request: {
    readonly conversationId: string;
    readonly content: ArrayBuffer;
    readonly filename: string;
    readonly mimeType: string;
  }): Promise<Result<string, StoreError>> {
    const canonicalPath = this.getCanonicalPath(request.conversationId, request.filename);
    const objectKey = this.getObjectKey(canonicalPath);

    try {
      const response = await this.signedFetch({
        method: BlobRequestMethod.Put,
        objectKey,
        body: request.content,
        contentType: request.mimeType,
      });

      if (!response.ok) {
        return failure(new StoreError(EntityType.File, StoreOperation.Persist, await getResponseMessage(response)));
      }

      return success(canonicalPath);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Persist, getErrorMessage(error)));
    }
  }

  async removeBlob(url: string): Promise<Result<void, StoreError>> {
    const objectKey = this.getObjectKey(url);

    try {
      const response = await this.signedFetch({
        method: BlobRequestMethod.Delete,
        objectKey,
      });

      if (!response.ok) {
        return failure(new StoreError(EntityType.File, StoreOperation.Remove, await getResponseMessage(response)));
      }

      return success(undefined);
    } catch (error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Remove, getErrorMessage(error)));
    }
  }

  private async signedFetch(input: {
    readonly method: BlobRequestMethod;
    readonly objectKey: string;
    readonly body?: ArrayBuffer;
    readonly contentType?: string;
  }): Promise<Response> {
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = toDateStamp(now);
    const endpointUrl = new URL(this.config.endpoint);
    const canonicalUri = `/${encodePathSegment(this.config.bucket)}/${encodeObjectKey(input.objectKey)}`;
    const bodyHash = input.body ? sha256Hex(Buffer.from(input.body)) : "UNSIGNED-PAYLOAD";
    const canonicalHeaders = [
      input.contentType ? `content-type:${input.contentType}` : null,
      `host:${endpointUrl.host}`,
      `x-amz-content-sha256:${bodyHash}`,
      `x-amz-date:${amzDate}`,
    ]
      .filter((value): value is string => value !== null)
      .join("\n");
    const signedHeaders = [input.contentType ? "content-type" : null, "host", "x-amz-content-sha256", "x-amz-date"].filter((value): value is string => value !== null).join(";");
    const canonicalRequest = [input.method, canonicalUri, "", `${canonicalHeaders}\n`, signedHeaders, bodyHash].join("\n");
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
    const signingKey = getSignatureKey(this.credentials.secretAccessKey, dateStamp, this.config.region, "s3");
    const signature = hmacSha256Hex(signingKey, stringToSign);
    const authorization = [`AWS4-HMAC-SHA256 Credential=${this.credentials.accessKeyId}/${credentialScope}`, `SignedHeaders=${signedHeaders}`, `Signature=${signature}`].join(", ");

    return fetch(`${this.config.endpoint}${canonicalUri}`, {
      method: input.method,
      headers: {
        ...(input.contentType ? { "content-type": input.contentType } : {}),
        authorization,
        host: endpointUrl.host,
        "x-amz-content-sha256": bodyHash,
        "x-amz-date": amzDate,
      },
      body: input.body,
    });
  }

  private getCanonicalPath(conversationId: string, filename: string): string {
    return `${CONVERSATIONS_CANONICAL_PATH_PREFIX}${encodePathSegment(conversationId)}/${randomUUID()}-${sanitizeFilename(filename)}`;
  }

  private getObjectKey(canonicalPath: string): string {
    if (!canonicalPath.startsWith(CONVERSATIONS_CANONICAL_PATH_PREFIX)) {
      throw new Error("Blob canonical path must start with /conversations/.");
    }

    const trimmedFolder = trimSlashes(this.config.folder);
    const trimmedPath = canonicalPath.replace(/^\/+/, "");

    if (trimmedFolder.length === 0) {
      return trimmedPath;
    }

    return `${trimmedFolder}/${trimmedPath}`;
  }
}

async function getResponseMessage(response: Response): Promise<string> {
  const text = await response.text();

  if (text.length > 0) {
    return text;
  }

  return `Blob storage request failed with status ${response.status}.`;
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

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function toDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, "/");
}

function encodeObjectKey(objectKey: string): string {
  return objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function hmacSha256(key: Uint8Array | string, data: string): Uint8Array {
  return createHmac("sha256", key).update(data).digest();
}

function hmacSha256Hex(key: Uint8Array | string, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

function getSignatureKey(secretAccessKey: string, dateStamp: string, regionName: string, serviceName: string): Uint8Array {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, regionName);
  const kService = hmacSha256(kRegion, serviceName);

  return hmacSha256(kService, "aws4_request");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected blob storage error.";
}
