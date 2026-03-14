import { Buffer } from "node:buffer";
import { createHash, createHmac } from "node:crypto";

const R2_ENDPOINT =
  "https://61caa9d56c5a0143bfda0f07fd01088a.r2.cloudflarestorage.com";
const R2_BUCKET = "thoth-obj-store-dev";
const R2_REGION = "auto";
const R2_SERVICE = "s3";
const R2_FOLDER = "conversations";

type Command = "upload" | "download";

async function main() {
  const command = Bun.argv[2] as Command | undefined;
  const filePath = Bun.argv[3];

  if (!command || !isCommand(command) || !filePath) {
    printJsonError(
      "Usage: bun scripts/r2-ops.ts <upload|download> <file-path>",
    );
  }

  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    printJsonError(
      "Missing R2 credentials. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.",
    );
  }

  if (command === "upload") {
    await uploadFile(filePath, accessKeyId, secretAccessKey);
    return;
  }

  await downloadFile(filePath, accessKeyId, secretAccessKey);
}

async function uploadFile(
  filePath: string,
  accessKeyId: string,
  secretAccessKey: string,
) {
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    printJsonError(`File does not exist: ${filePath}`);
  }

  const fileName = getFileName(filePath);
  const objectKey = `${R2_FOLDER}/${fileName}`;
  const contentType = file.type || "application/octet-stream";
  const body = await file.arrayBuffer();
  const response = await signedFetch({
    accessKeyId,
    secretAccessKey,
    method: "PUT",
    objectKey,
    body,
    contentType,
  });
  const responseText = await response.text();

  console.log(
    JSON.stringify(
      {
        ok: response.ok,
        operation: "upload",
        status: response.status,
        statusText: response.statusText,
        bucket: R2_BUCKET,
        key: objectKey,
        inputPath: filePath,
        url: getRequestUrl(objectKey),
        etag: response.headers.get("etag"),
        requestId: response.headers.get("x-amz-request-id"),
        body: responseText.length > 0 ? responseText : null,
      },
      null,
      2,
    ),
  );

  if (!response.ok) {
    process.exit(1);
  }
}

async function downloadFile(
  outputPath: string,
  accessKeyId: string,
  secretAccessKey: string,
) {
  const fileName = getFileName(outputPath);
  const objectKey = `${R2_FOLDER}/${fileName}`;
  const response = await signedFetch({
    accessKeyId,
    secretAccessKey,
    method: "GET",
    objectKey,
  });

  if (response.ok) {
    await Bun.write(outputPath, response);
  }

  const responseText = response.ok ? null : await response.text();

  console.log(
    JSON.stringify(
      {
        ok: response.ok,
        operation: "download",
        status: response.status,
        statusText: response.statusText,
        bucket: R2_BUCKET,
        key: objectKey,
        outputPath,
        url: getRequestUrl(objectKey),
        etag: response.headers.get("etag"),
        requestId: response.headers.get("x-amz-request-id"),
        contentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
        body: responseText,
      },
      null,
      2,
    ),
  );

  if (!response.ok) {
    process.exit(1);
  }
}

async function signedFetch(input: {
  accessKeyId: string;
  secretAccessKey: string;
  method: "GET" | "PUT";
  objectKey: string;
  body?: ArrayBuffer;
  contentType?: string;
}) {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const endpointUrl = new URL(R2_ENDPOINT);
  const canonicalUri = `/${encodePathSegment(R2_BUCKET)}/${encodeObjectKey(
    input.objectKey,
  )}`;
  const bodyHash = input.body
    ? sha256Hex(Buffer.from(input.body))
    : "UNSIGNED-PAYLOAD";
  const canonicalHeaders = [
    input.contentType ? `content-type:${input.contentType}` : null,
    `host:${endpointUrl.host}`,
    `x-amz-content-sha256:${bodyHash}`,
    `x-amz-date:${amzDate}`,
  ]
    .filter((value): value is string => value !== null)
    .join("\n");
  const signedHeaders = [
    input.contentType ? "content-type" : null,
    "host",
    "x-amz-content-sha256",
    "x-amz-date",
  ]
    .filter((value): value is string => value !== null)
    .join(";");
  const canonicalRequest = [
    input.method,
    canonicalUri,
    "",
    `${canonicalHeaders}\n`,
    signedHeaders,
    bodyHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getSignatureKey(
    input.secretAccessKey,
    dateStamp,
    R2_REGION,
    R2_SERVICE,
  );
  const signature = hmacSha256Hex(signingKey, stringToSign);
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return fetch(`${R2_ENDPOINT}${canonicalUri}`, {
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

function getRequestUrl(objectKey: string): string {
  return `${R2_ENDPOINT}/${encodePathSegment(R2_BUCKET)}/${encodeObjectKey(
    objectKey,
  )}`;
}

function getFileName(filePath: string): string {
  const normalizedPath = filePath.replace(/\/+$/, "");
  const fileName = normalizedPath.split("/").pop();

  if (!fileName) {
    printJsonError(`Could not derive file name from path: ${filePath}`);
  }

  return fileName;
}

function isCommand(value: string): value is Command {
  return value === "upload" || value === "download";
}

function printJsonError(error: string): never {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error,
      },
      null,
      2,
    ),
  );
  process.exit(1);
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

function getSignatureKey(
  secretAccessKey: string,
  dateStamp: string,
  regionName: string,
  serviceName: string,
): Uint8Array {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, regionName);
  const kService = hmacSha256(kRegion, serviceName);

  return hmacSha256(kService, "aws4_request");
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unexpected R2 operation failure.";

  printJsonError(message);
});
