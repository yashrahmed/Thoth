# Blob Store Plan

## Context

`docs/infra.md` currently recommends `Cloudflare R2` for blob storage in both
preferred infrastructure stacks. The practical portability target is the
`Amazon S3` API because R2 exposes an S3-compatible interface and the backend
should remain adapter-driven under the existing hexagonal architecture.

The current message model stores media as a single URL. That is too thin for
direct uploads, validation, private delivery, derived assets, or lifecycle
management. Blob metadata should live in Postgres, while object bytes live in
R2 behind a storage adapter.

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

- Keep blob storage behind ports and adapters.
- Treat Postgres as the source of truth for blob metadata and relationships.
- Keep the domain independent from S3 SDK request/response shapes.
- Support private uploads/downloads with presigned URLs.
- Support future derived assets such as previews, thumbnails, and transcripts.
- Avoid domain features that are not portable across R2 and S3.

## Domain Model

Introduce explicit blob concepts instead of a raw media URL.

### BlobAsset

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

### Attachment

- `id`
- `blob_asset_id`
- `owner_type`
- `owner_id`
- `role`
- `filename`
- `last_create_ts`
- `last_update_ts`

Suggested enums/value objects:

- `AttachmentOwnerType`: start with `message`
- `AttachmentRole`: `original` | `thumbnail` | `preview` | `transcript`

### Grants

Use value objects for short-lived access instead of leaking provider-specific
responses.

- `UploadGrant`: `blob_asset_id`, `object_key`, `upload_url`, `headers`,
  `expires_at`
- `AccessGrant`: `blob_asset_id`, `download_url`, `expires_at`

## Repository Contracts

Add metadata repositories in `packages/domain/contracts`.

```ts
export interface BlobAssetRepository {
  create(asset: BlobAsset): Promise<BlobAsset>;
  getById(blobAssetId: BlobAssetId): Promise<BlobAsset | null>;
  getByObjectKey(
    bucket: BucketName,
    objectKey: ObjectKey,
  ): Promise<BlobAsset | null>;
  markUploaded(input: MarkUploadedInput): Promise<BlobAsset>;
  markDeleted(blobAssetId: BlobAssetId, deletedAt: Date): Promise<void>;
  listPendingUploadsOlderThan(cutoff: Date): Promise<BlobAsset[]>;
}

export interface AttachmentRepository {
  attachToMessage(input: AttachBlobToMessageInput): Promise<Attachment>;
  listByMessageId(messageId: MessageId): Promise<Attachment[]>;
  deleteByBlobAssetId(blobAssetId: BlobAssetId): Promise<void>;
}
```

Keep these repository ports focused on Postgres-backed metadata and ownership.

## Storage Port

Add a dedicated object-storage port for byte operations.

```ts
export interface BlobStoragePort {
  createPresignedUpload(
    input: CreatePresignedUploadInput,
  ): Promise<UploadGrant>;
  createPresignedDownload(
    input: CreatePresignedDownloadInput,
  ): Promise<AccessGrant>;
  headObject(input: HeadObjectInput): Promise<StoredObjectMetadata | null>;
  deleteObject(input: DeleteObjectInput): Promise<void>;
  copyObject(input: CopyObjectInput): Promise<StoredObjectMetadata>;
}
```

Keep this contract intentionally narrow:

- include upload/download/head/delete/copy
- add multipart support later if the product needs large uploads
- do not include ACLs, tagging, version IDs, or provider-specific encryption
  fields in the core port

## Application Services

Add application-layer orchestration services rather than pushing workflow into
controllers or repositories.

### BlobUploadService

- `requestUpload(input)`
- allocate `BlobAsset`
- build an immutable object key
- return a presigned `PUT` upload grant

### BlobUploadConfirmationService

- `confirmUpload(input)`
- call `headObject`
- validate size, content type, and checksum if present
- transition the asset from `pending_upload` to `ready`

### MessageAttachmentService

- `attachUploadedBlobToMessage(input)`
- only attach blobs in `ready` state
- create `Attachment` records for the message

### BlobAccessService

- `issueDownloadUrl(input)`
- issue short-lived presigned `GET` URLs for private assets

### BlobLifecycleService

- `deleteBlob(input)`
- detach metadata, delete the object, and mark the asset deleted
- `reapExpiredPendingUploads(cutoff)`
- clean up abandoned uploads and stale metadata

## Persistence Shape

Use SQL migrations as the source of truth.

### `blob_assets`

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

### `message_attachments`

- `id`
- `message_id`
- `blob_asset_id`
- `role`
- `filename`
- `last_create_ts`
- `last_update_ts`

Constraints/indexes:

- foreign key to `messages`
- foreign key to `blob_assets`
- unique `(message_id, blob_asset_id, role)` if appropriate

## Object Key Strategy

Use immutable, prefix-based keys so cleanup and lifecycle rules are simple.

Suggested format:

```text
messages/{conversationId}/{messageId}/{blobAssetId}/original
```

Benefits:

- deterministic ownership path
- easy bulk lifecycle rules by prefix
- easy placement of derived assets next to originals

## Delivery Strategy

- Default to private blobs and presigned downloads.
- If public delivery is required later, use a separate public bucket or a
  clearly separated public prefix behind a custom domain.
- Do not use `r2.dev` as the production delivery contract.

## Recommended First Implementation

1. Add new blob and attachment domain entities plus value objects.
2. Add repository contracts for `BlobAssetRepository` and
   `AttachmentRepository`.
3. Add `BlobStoragePort` for presigned upload/download and metadata checks.
4. Add SQL migrations for `blob_assets` and `message_attachments`.
5. Implement a Postgres adapter for the new repositories.
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
