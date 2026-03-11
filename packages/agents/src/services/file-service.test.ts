import { describe, expect, mock, test } from "bun:test";
import { FileService } from "./file-service";

describe("FileService", () => {
  test("stores files with immutable object keys under the conversations prefix", async () => {
    const putObject = mock(async (input: { objectKey: string }) => ({
      objectKey: input.objectKey,
      byteSize: 5,
      contentType: "image/png",
      etag: "etag",
      lastModified: new Date("2026-03-10T12:00:00.000Z"),
    }));
    const fileRepository = {
      create: mock(async (file) => file),
      getById: mock(async () => null),
      listByMessageId: mock(async () => []),
      getByObjectKey: mock(async () => null),
      delete: mock(async () => undefined),
    };
    const service = new FileService(fileRepository as never, {
      putObject,
      headObject: mock(async () => null),
      getObject: mock(async () => {
        throw new Error("not implemented");
      }),
      deleteObject: mock(async () => undefined),
      copyObject: mock(async () => ({
        objectKey: "copy",
        byteSize: null,
        contentType: null,
        etag: null,
        lastModified: null,
      })),
    });

    const result = await service.storeFilesForMessage({
      messageId: "message-1",
      files: [
        {
          original_filename: "photo.png",
          content_type: "image/png",
          byte_size: 5,
          body: new TextEncoder().encode("hello").buffer,
        },
      ],
    });

    expect(putObject).toHaveBeenCalledTimes(1);
    expect(putObject.mock.calls[0]?.[0].objectKey).toMatch(
      /^conversations\/.+\.png$/,
    );
    expect(result[0]?.object_key).toMatch(/^conversations\/.+\.png$/);
  });

  test("cleans up uploaded blobs when metadata persistence fails", async () => {
    const deleteObject = mock(async () => undefined);
    const fileRepository = {
      create: mock(async () => {
        throw new Error("insert failed");
      }),
      getById: mock(async () => null),
      listByMessageId: mock(async () => []),
      getByObjectKey: mock(async () => null),
      delete: mock(async () => undefined),
    };
    const service = new FileService(fileRepository as never, {
      putObject: mock(async (input: { objectKey: string }) => ({
        objectKey: input.objectKey,
        byteSize: 5,
        contentType: "image/png",
        etag: "etag",
        lastModified: new Date("2026-03-10T12:00:00.000Z"),
      })),
      headObject: mock(async () => null),
      getObject: mock(async () => {
        throw new Error("not implemented");
      }),
      deleteObject,
      copyObject: mock(async () => ({
        objectKey: "copy",
        byteSize: null,
        contentType: null,
        etag: null,
        lastModified: null,
      })),
    });

    await expect(
      service.storeFilesForMessage({
        messageId: "message-1",
        files: [
          {
            original_filename: "photo.png",
            content_type: "image/png",
            byte_size: 5,
            body: new TextEncoder().encode("hello").buffer,
          },
        ],
      }),
    ).rejects.toThrow("insert failed");

    expect(deleteObject).toHaveBeenCalledTimes(1);
  });
});
