import { createHash, createHmac } from "node:crypto";
import {
  getObjectStoreConfig,
  getObjectStoreCredentialsConfig,
} from "@thoth/config";
import type {
  BlobStore,
  CopyBlobInput,
  DeleteBlobInput,
  GetBlobInput,
  HeadBlobInput,
  PutBlobInput,
  StoredBlobBody,
  StoredBlobMetadata,
} from "@thoth/entities";

interface SignedRequestInput {
  method: "PUT" | "GET" | "HEAD" | "DELETE";
  objectKey: string;
  body?: ArrayBuffer;
  contentType?: string;
  extraHeaders?: Record<string, string>;
}

export class R2BlobStore implements BlobStore {
  private readonly config = getObjectStoreConfig();
  private readonly credentials = getObjectStoreCredentialsConfig();

  public async putObject(input: PutBlobInput): Promise<StoredBlobMetadata> {
    const response = await this.signedFetch({
      method: "PUT",
      objectKey: input.objectKey,
      body: input.body,
      contentType: input.contentType,
    });

    await this.assertOk(response, "putObject");

    return {
      objectKey: input.objectKey,
      byteSize: input.byteSize,
      contentType: input.contentType,
      etag: response.headers.get("etag"),
      lastModified: this.parseDateHeader(response.headers.get("date")),
    };
  }

  public async headObject(
    input: HeadBlobInput,
  ): Promise<StoredBlobMetadata | null> {
    const response = await this.signedFetch({
      method: "HEAD",
      objectKey: input.objectKey,
    });

    if (response.status === 404) {
      return null;
    }

    await this.assertOk(response, "headObject");

    return this.metadataFromResponse(input.objectKey, response);
  }

  public async getObject(input: GetBlobInput): Promise<StoredBlobBody> {
    const response = await this.signedFetch({
      method: "GET",
      objectKey: input.objectKey,
    });

    await this.assertOk(response, "getObject");

    if (!response.body) {
      throw new Error(`Object "${input.objectKey}" returned an empty body.`);
    }

    return {
      ...this.metadataFromResponse(input.objectKey, response),
      body: response.body,
    };
  }

  public async deleteObject(input: DeleteBlobInput): Promise<void> {
    const response = await this.signedFetch({
      method: "DELETE",
      objectKey: input.objectKey,
    });

    if (response.status === 404) {
      return;
    }

    await this.assertOk(response, "deleteObject");
  }

  public async copyObject(input: CopyBlobInput): Promise<StoredBlobMetadata> {
    const copySource = `/${this.config.bucket}/${this.encodeObjectKey(
      input.sourceObjectKey,
    )}`;
    const response = await this.signedFetch({
      method: "PUT",
      objectKey: input.destinationObjectKey,
      extraHeaders: {
        "x-amz-copy-source": copySource,
      },
    });

    await this.assertOk(response, "copyObject");

    return {
      objectKey: input.destinationObjectKey,
      byteSize: null,
      contentType: null,
      etag: response.headers.get("etag"),
      lastModified: this.parseDateHeader(response.headers.get("date")),
    };
  }

  private async signedFetch(input: SignedRequestInput): Promise<Response> {
    const now = new Date();
    const amzDate = this.toAmzDate(now);
    const dateStamp = this.toDateStamp(now);
    const endpointUrl = new URL(this.config.endpoint);
    const canonicalUri = `/${this.encodePathSegment(this.config.bucket)}/${this.encodeObjectKey(
      input.objectKey,
    )}`;
    const bodyHash = input.body
      ? this.sha256Hex(new Uint8Array(input.body))
      : "UNSIGNED-PAYLOAD";
    const headers = {
      ...(input.contentType ? { "content-type": input.contentType } : {}),
      ...(input.extraHeaders ?? {}),
      host: endpointUrl.host,
      "x-amz-content-sha256": bodyHash,
      "x-amz-date": amzDate,
    };
    const canonicalHeaderKeys = Object.keys(headers).sort();
    const canonicalHeaders = canonicalHeaderKeys
      .map((key) => `${key}:${headers[key as keyof typeof headers]}`)
      .join("\n");
    const signedHeaders = canonicalHeaderKeys.join(";");
    const canonicalRequest = [
      input.method,
      canonicalUri,
      "",
      `${canonicalHeaders}\n`,
      signedHeaders,
      bodyHash,
    ].join("\n");
    const credentialScope = `${dateStamp}/${this.config.region}/${this.config.service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      this.sha256Hex(canonicalRequest),
    ].join("\n");
    const signingKey = this.getSignatureKey(
      this.credentials.secretAccessKey,
      dateStamp,
      this.config.region,
      this.config.service,
    );
    const signature = this.hmacSha256Hex(signingKey, stringToSign);
    const authorization = [
      `AWS4-HMAC-SHA256 Credential=${this.credentials.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(", ");

    return fetch(`${this.config.endpoint}${canonicalUri}`, {
      method: input.method,
      headers: {
        ...headers,
        authorization,
      },
      body: input.body,
    });
  }

  private metadataFromResponse(
    objectKey: string,
    response: Response,
  ): StoredBlobMetadata {
    return {
      objectKey,
      byteSize: this.parseNumberHeader(response.headers.get("content-length")),
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag"),
      lastModified: this.parseDateHeader(
        response.headers.get("last-modified") ?? response.headers.get("date"),
      ),
    };
  }

  private async assertOk(response: Response, operation: string): Promise<void> {
    if (response.ok) {
      return;
    }

    const responseText = await response.text();

    throw new Error(
      `${operation} failed with ${response.status} ${response.statusText}: ${responseText}`,
    );
  }

  private parseDateHeader(value: string | null): Date | null {
    if (!value) {
      return null;
    }

    const date = new Date(value);

    return Number.isNaN(date.valueOf()) ? null : date;
  }

  private parseNumberHeader(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const parsed = Number(value);

    return Number.isNaN(parsed) ? null : parsed;
  }

  private toAmzDate(date: Date): string {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  }

  private toDateStamp(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, "");
  }

  private encodePathSegment(value: string): string {
    return encodeURIComponent(value).replace(/%2F/g, "/");
  }

  private encodeObjectKey(objectKey: string): string {
    return objectKey
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  private sha256Hex(input: string | Uint8Array): string {
    return createHash("sha256").update(input).digest("hex");
  }

  private hmacSha256(
    key: Uint8Array | string,
    data: string,
  ): Uint8Array {
    return createHmac("sha256", key).update(data).digest();
  }

  private hmacSha256Hex(key: Uint8Array | string, data: string): string {
    return createHmac("sha256", key).update(data).digest("hex");
  }

  private getSignatureKey(
    secretAccessKey: string,
    dateStamp: string,
    region: string,
    service: string,
  ): Uint8Array {
    const kDate = this.hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
    const kRegion = this.hmacSha256(kDate, region);
    const kService = this.hmacSha256(kRegion, service);

    return this.hmacSha256(kService, "aws4_request");
  }
}
