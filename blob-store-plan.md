# Blob Store Remaining Work

## Current State

The first blob-backed file flow is already in place:

- `Message.media_content` has been replaced by `Message.files`.
- File metadata is stored in Postgres.
- Blob bytes are uploaded to R2 through a storage adapter.
- `POST /messages` accepts `multipart/form-data` with zero or more files.
- Message and conversation responses now expose file metadata instead of a raw
  media URL.

This document only tracks the remaining blob-store work.

## Remaining Product Gaps

### Client File Retrieval

Clients can upload files and receive file metadata, but they cannot yet fetch
the stored bytes back through the API.

Add a read path for stored files:

- look up file metadata in Postgres
- fetch object bytes through the blob storage port
- return the content to the client with the correct `Content-Type`
- set `Content-Disposition` based on `original_filename`

Recommended first shape:

```text
GET /files/:fileId
```

Keep this as a backend-controlled delivery path for private files.

### Access Control

Once file reads exist, the backend needs a clear access policy for who can
fetch which file.

The first version should:

- authorize access using the owning message/conversation context
- avoid exposing direct environment-specific object-store URLs as the primary
  client contract

### Delivery Strategy Choice

The current system only supports backend-managed upload. File download still
needs a concrete delivery contract.

Choose one of:

- proxy file bytes through the backend
- issue signed URLs for direct object-store reads

Default recommendation:

- start with backend proxy delivery
- add signed URLs later only if bandwidth or latency requires it

## Remaining API Work

### File Read Endpoint

Add an application service for file access:

- resolve file metadata by `fileId`
- fetch the object by `object_key`
- return stream plus response metadata

Add a controller/route for file reads and return:

- `404` if the file does not exist
- `200` with streamed content when it does

### Optional Future File APIs

These are not required for the first download path, but are likely next:

- delete a single file without deleting the whole message
- list files directly if a dedicated file resource becomes useful

## Remaining Validation and Safety Work

Upload now works, but the backend still needs stronger operational guardrails.

Add:

- upload size limits
- allowed MIME type validation
- clearer error handling for storage failures
- defensive checks around malformed filenames and unsupported content types

## Remaining Operational Work

### Orphan Cleanup

The system should eventually detect and clean up mismatches between Postgres
metadata and object-store contents.

Examples:

- metadata row exists but blob is missing
- blob exists but no metadata row exists

### Lifecycle Management

If files become long-lived, add explicit lifecycle policy decisions for:

- retention
- archival
- deletion rules

### Legacy Cleanup

The old `messages.media_content` column is still present as dead storage.

Remove it in a follow-up migration after the new file flow has been stable long
enough and no legacy readers remain.
