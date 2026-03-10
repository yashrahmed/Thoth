# Blob Store Plan

## Context

`docs/infra.md` currently recommends `Cloudflare R2` for blob storage in both
preferred infrastructure stacks. The practical portability target is the
`Amazon S3` API because R2 exposes an S3-compatible interface and the backend
should remain adapter-driven under the existing hexagonal architecture.

The current message model stores media as a single URL. That is too thin for
server-managed uploads, validation, private delivery, derived assets, or
lifecycle management. File metadata should live in Postgres, while object
bytes live in R2 behind a storage adapter. The canonical reference should be
an object key, not a full R2 URL.

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
- Treat Postgres as the source of truth for file metadata.
- Keep the first version close to the OpenAI `File` object shape.
- Keep environment-specific endpoint, bucket, and credential details in config.
- Start with the smallest useful domain model and extend it later if needed.

## Domain Model

Introduce an explicit `File` entity instead of a raw media URL.

### File

- `id`
- `object_key`
- `original_filename`
- `byte_size`
- `last_create_ts`

Notes:

- `object_key` is the canonical storage reference in the domain.
- Full URLs should be derived by adapters from environment config.
- `original_filename` is metadata for display and download behavior, not the
  stored object identity.
- `Message` owns a list of `File` entities directly in the first version.
- This intentionally stays smaller than the previous `FileUpload` /
  `Attachment` model.

## Repository Contracts

The first pass only needs a file repository tied to messages.

```ts
export interface FileRepository {
  create(file: File, messageId: MessageId): Promise<File>;
  getById(fileId: FileId): Promise<File | null>;
  listByMessageId(messageId: MessageId): Promise<File[]>;
  getByObjectKey(objectKey: ObjectKey): Promise<File | null>;
  delete(fileId: FileId): Promise<void>;
}
```

Keep this repository focused on Postgres-backed metadata.
It should not persist provider-specific absolute URLs as canonical identity.

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

### FileService

- `storeFile(input)`
- generate an object key
- upload bytes through `BlobStoragePort`
- persist a `File` row tied to the message

### FileAccessService

- `fetchFile(input)`
- return a stream or proxy response for private files

### FileLifecycleService

- `deleteFile(input)`
- delete the object and remove the `File` row

## Persistence Shape

Use SQL migrations as the source of truth.

### `files`

- `id`
- `message_id`
- `object_key`
- `original_filename`
- `byte_size`
- `last_create_ts`

Constraints/indexes:

- foreign key to `messages`
- unique `object_key`
- index on `message_id`

## Object Key Strategy

Use immutable, prefix-based keys so cleanup and lifecycle rules are simple.
The key should be server-generated rather than derived from a client filename.

Suggested format:

```text
conversations/{fileId}.{ext}
```

Benefits:

- canonical identifier is independent of environment-specific endpoint details
- avoids collisions from client-provided names
- stored name can be generated while preserving `original_filename` separately
- keeps the initial schema and domain model small

## Delivery Strategy

- Default to private files delivered through the proxy.
- If public delivery is required later, use a separate public bucket or a
  clearly separated public prefix behind a custom domain.
- Do not use `r2.dev` as the production delivery contract.

## Recommended First Implementation

1. Add a `File` entity to the domain.
2. Update `Message` to hold a list of `File`.
3. Add a `files` table with a foreign key to `messages`.
4. Add a `FileRepository`.
5. Add `BlobStoragePort` for object put/get/head/delete/copy.
6. Implement the Postgres repository and R2 adapter.
7. Add integration tests covering the repository contract against local
   Postgres.

## Notes For Current Code

- The current `Message.media_content: URL | null` field should be treated as a
  transitional shape, not the long-term domain model.
- The object store should not become the metadata source of truth.
- The backend should avoid provider-specific assumptions that R2 does not
  support, especially tagging, ACLs, and versioning.
- The public API should expose Thoth-managed `File` resources.
- The domain should reference files by `object_key` and metadata, not by a
  full environment-specific R2 URL.
- If upload-session or attachment abstractions become necessary later, they can
  be added after the first simple `File` model is working.
