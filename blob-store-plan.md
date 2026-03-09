# Blob Store Plan

## Context

`docs/infra.md` currently recommends `Cloudflare R2` for blob storage in both
preferred infrastructure stacks. The practical portability target is the
`Amazon S3` API because R2 exposes an S3-compatible interface and the backend
should remain adapter-driven under the existing hexagonal architecture.

The current message model stores media as a single URL. That is too thin for
server-managed uploads, validation, private delivery, derived assets, or
lifecycle management. File metadata should live in Postgres, while object
bytes live in R2 behind a storage adapter.

## Storage Research Summary

### Cloudflare R2

- Uses an S3-compatible API with the R2 account endpoint and compatibility
  region handling.
- Supports the core object flow needed here: object upload/download, head,
  delete, copy, and multipart upload operations.
- Supports presigned `GET`, `HEAD`, `PUT`, and `DELETE` URLs.
- Does not support presigned `POST` HTML form uploads.
- Presigned URLs work on the S3 API endpoint, not custom domains.
- Provides strong consistency for reads, writes, metadata updates, deletes,
  and listings.
- Supports public delivery through `r2.dev` or a custom domain.
- Supports lifecycle rules and storage classes such as `STANDARD` and
  `STANDARD_IA`.
- Has important gaps versus full S3: avoid depending on object tagging, ACLs,
  versioning, or KMS-specific encryption controls in the domain contract.

### Amazon S3

- Defines the portability baseline for the storage adapter contract.
- Supports rich object metadata, multipart uploads, and presigned URL flows.
- Presigned URLs are bearer tokens scoped by the signer permissions.
- User-defined metadata is written with the object and updates usually require
  a copy operation.

## Design Goals

- Keep file storage behind ports and adapters.
- Treat Postgres as the source of truth for file metadata and relationships.
- Keep the domain independent from S3 SDK request/response shapes.
- Support private uploads/downloads with presigned URLs.
- Support future derived assets such as previews, thumbnails, and transcripts.
- Avoid domain features that are not portable across R2 and S3.

## Domain Model

Introduce explicit file concepts instead of a raw media URL.

### File

- `id`
- `provider`
- `bucket`
- `object_key`
- `content_type`
- `byte_size`
- `checksum`
- `etag`
- `storage_class`
- `visibility`
- `status`
- `last_create_ts`
- `last_update_ts`
- `deleted_at`

Suggested enums/value objects:

- `BlobProvider`: `r2`
- `BlobVisibility`: `private` | `public`
- `BlobStatus`: `pending_upload` | `ready` | `deleting` | `deleted`
- `ObjectKey`, `BucketName`, `ChecksumSha256`

### FileUpload

- `id`
- `file_id`
- `status`
- `expected_content_type`
- `expected_byte_size`
- `last_create_ts`
- `last_update_ts`
- `expires_at`

Suggested enums/value objects:

- `FileUploadStatus`: `open` | `completed` | `expired`

### Attachment

- `id`
- `file_id`
- `owner_type`
- `owner_id`
- `role`
- `filename`
- `last_create_ts`
- `last_update_ts`

Suggested enums/value objects:

- `AttachmentOwnerType`: start with `message`
- `AttachmentRole`: `original` | `thumbnail` | `preview` | `transcript`

## Repository Contracts

Add metadata repositories in `packages/domain/contracts`.

```ts
export interface FileRepository {
  create(file: File): Promise<File>;
  getById(fileId: FileId): Promise<File | null>;
  getByObjectKey(
    bucket: BucketName,
    objectKey: ObjectKey,
  ): Promise<File | null>;
  markReady(input: MarkFileReadyInput): Promise<File>;
  markDeleted(fileId: FileId, deletedAt: Date): Promise<void>;
}

export interface FileUploadRepository {
  create(upload: FileUpload): Promise<FileUpload>;
  getById(fileUploadId: FileUploadId): Promise<FileUpload | null>;
  markCompleted(input: CompleteFileUploadInput): Promise<FileUpload>;
  listExpiredOpenUploads(cutoff: Date): Promise<FileUpload[]>;
}

export interface AttachmentRepository {
  attachToMessage(input: AttachFileToMessageInput): Promise<Attachment>;
  listByMessageId(messageId: MessageId): Promise<Attachment[]>;
  deleteByFileId(fileId: FileId): Promise<void>;
}
```

Keep these repository ports focused on Postgres-backed metadata and ownership.

## Storage Port

Add a dedicated object-storage port for byte operations.

```ts
export interface BlobStoragePort {
  putObject(input: PutObjectInput): Promise<StoredObjectMetadata>;
  headObject(input: HeadObjectInput): Promise<StoredObjectMetadata | null>;
  getObject(input: GetObjectInput): Promise<StoredObjectBody>;
  deleteObject(input: DeleteObjectInput): Promise<void>;
  copyObject(input: CopyObjectInput): Promise<StoredObjectMetadata>;
}
```

Keep this contract intentionally narrow:

- include put/get/head/delete/copy
- add multipart support later if the product needs large uploads
- do not include ACLs, tagging, version IDs, or provider-specific encryption
  fields in the core port

## Application Services

Add application-layer orchestration services rather than pushing workflow into
controllers or repositories.

### CreateFileUploadService

- `createUpload(input)`
- allocate `File`
- allocate `FileUpload`
- build an immutable object key
- return a Thoth-managed upload resource

### ReceiveFileUploadService

- `receiveBytes(input)`
- accept bytes through the proxy
- stream or buffer to R2 through `BlobStoragePort`
- validate size, content type, and checksum if present

### CompleteFileUploadService

- `completeUpload(input)`
- call `headObject`
- mark the `FileUpload` completed
- transition the `File` from `pending_upload` to `ready`

### MessageAttachmentService

- `attachUploadedFileToMessage(input)`
- only attach files in `ready` state
- create `Attachment` records for the message

### FileAccessService

- `fetchFile(input)`
- return a stream or proxy response for private files

### FileLifecycleService

- `deleteFile(input)`
- detach metadata, delete the object, and mark the file deleted
- `expireStaleUploads(cutoff)`
- clean up abandoned uploads and stale metadata

## Persistence Shape

Use SQL migrations as the source of truth.

### `files`

- `id`
- `provider`
- `bucket`
- `object_key`
- `content_type`
- `byte_size`
- `checksum_sha256`
- `etag`
- `storage_class`
- `visibility`
- `status`
- `last_create_ts`
- `last_update_ts`
- `deleted_at`

Constraints/indexes:

- unique `(bucket, object_key)`
- index on `status`
- index on `last_update_ts`

### `file_uploads`

- `id`
- `file_id`
- `status`
- `expected_content_type`
- `expected_byte_size`
- `expires_at`
- `last_create_ts`
- `last_update_ts`

Constraints/indexes:

- foreign key to `files`
- index on `status`
- index on `expires_at`

### `message_attachments`

- `id`
- `message_id`
- `file_id`
- `role`
- `filename`
- `last_create_ts`
- `last_update_ts`

Constraints/indexes:

- foreign key to `messages`
- foreign key to `files`
- unique `(message_id, file_id, role)` if appropriate

## Object Key Strategy

Use immutable, prefix-based keys so cleanup and lifecycle rules are simple.

Suggested format:

```text
messages/{conversationId}/{messageId}/{fileId}/original
```

Benefits:

- deterministic ownership path
- easy bulk lifecycle rules by prefix
- easy placement of derived assets next to originals

## Delivery Strategy

- Default to private files delivered through the proxy.
- If public delivery is required later, use a separate public bucket or a
  clearly separated public prefix behind a custom domain.
- Do not use `r2.dev` as the production delivery contract.

## Recommended First Implementation

1. Add new file, file-upload, and attachment domain entities plus value
   objects.
2. Add repository contracts for `FileRepository`, `FileUploadRepository`, and
   `AttachmentRepository`.
3. Add `BlobStoragePort` for object put/get/head/delete/copy.
4. Add SQL migrations for `files`, `file_uploads`, and `message_attachments`.
5. Implement Postgres adapters for the new repositories.
6. Implement an R2 adapter using the S3-compatible API.
7. Update the message domain to reference attachments rather than a single
   `media_content` URL.
8. Add integration tests covering repository contracts against local Postgres.

## Notes For Current Code

- The current `Message.media_content: URL | null` field should be treated as a
  transitional shape, not the long-term domain model.
- The object store should not become the metadata source of truth.
- The backend should avoid provider-specific assumptions that R2 does not
  support, especially tagging, ACLs, and versioning.
- The public API should expose Thoth-managed `File` and `FileUpload`
  resources, not presigned storage grants.
