export interface PutObjectInput {
  objectKey: string;
  body: ArrayBuffer;
  contentType: string;
  byteSize: number;
}

export interface HeadObjectInput {
  objectKey: string;
}

export interface GetObjectInput {
  objectKey: string;
}

export interface DeleteObjectInput {
  objectKey: string;
}

export interface CopyObjectInput {
  sourceObjectKey: string;
  destinationObjectKey: string;
}

export interface StoredObjectMetadata {
  objectKey: string;
  byteSize: number | null;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
}

export interface StoredObjectBody extends StoredObjectMetadata {
  body: ReadableStream<Uint8Array>;
}

export interface BlobStoragePort {
  putObject(input: PutObjectInput): Promise<StoredObjectMetadata>;
  headObject(input: HeadObjectInput): Promise<StoredObjectMetadata | null>;
  getObject(input: GetObjectInput): Promise<StoredObjectBody>;
  deleteObject(input: DeleteObjectInput): Promise<void>;
  copyObject(input: CopyObjectInput): Promise<StoredObjectMetadata>;
}
