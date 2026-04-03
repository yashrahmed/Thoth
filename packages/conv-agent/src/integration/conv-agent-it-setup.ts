import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { createPostgresDatabase, type PostgresDatabase } from "../adapter/postgres/postgres-database";
import { convSetup, type ConvSetupResult } from "../conv-setup";

const DATABASE_NAME = "thoth_test";
const DATABASE_USERNAME = "thoth";
const DATABASE_PASSWORD = "thoth";
const DATABASE_HOST = "127.0.0.1";
const DATABASE_PORT = 55432;
const BLOB_BUCKET = "thoth-test";
const BLOB_FOLDER = "integration";
const BLOB_REGION = "auto";
const BLOB_ENDPOINT = "http://127.0.0.1:59090";
const SQS_REGION = "us-east-1";
const SQS_QUEUE_NAME = "thoth-llm-completions-queue";
const LOCALSTACK_ENDPOINT = "http://127.0.0.1:54566";

export interface ConvIntegrationSetup {
  readonly blobBucket: string;
  readonly blobClient: S3Client;
  readonly database: PostgresDatabase;
  readonly server: Bun.Server<undefined>;
  stop(): Promise<void>;
}

export async function convIntegrationSetup(): Promise<ConvIntegrationSetup> {
  let appSetup: ConvSetupResult | undefined;
  let database: PostgresDatabase | undefined;
  let s3Client: S3Client | undefined;

  try {
    s3Client = new S3Client({
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test",
      },
      endpoint: BLOB_ENDPOINT,
      forcePathStyle: true,
      region: BLOB_REGION,
    });

    try {
      await s3Client.send(
        new CreateBucketCommand({
          Bucket: BLOB_BUCKET,
        }),
      );
    } catch (error) {
      s3Client.destroy();
      throw error;
    }

    const queueUrl = await createLocalstackSqsQueue(LOCALSTACK_ENDPOINT, SQS_QUEUE_NAME);
    const databaseUrl = buildDatabaseUrl(DATABASE_HOST, DATABASE_PORT);

    appSetup = await convSetup({
      port: 0,
      databaseUrl,
      blobStorage: {
        accessKeyId: "test",
        bucket: BLOB_BUCKET,
        endpoint: BLOB_ENDPOINT,
        folder: BLOB_FOLDER,
        region: BLOB_REGION,
        secretAccessKey: "test",
      },
      llmDispatchQueue: {
        endpoint: LOCALSTACK_ENDPOINT,
        region: SQS_REGION,
        queueUrl,
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    });
    database = createPostgresDatabase(databaseUrl);
    let stopped = false;

    return {
      blobBucket: BLOB_BUCKET,
      blobClient: s3Client,
      database,
      server: appSetup.server,
      async stop() {
        if (stopped) {
          return;
        }

        stopped = true;

        try {
          await appSetup?.stop();
        } finally {
          await database?.end();
          s3Client?.destroy();
        }
      },
    };
  } catch (error) {
    await appSetup?.stop();
    await database?.end();
    s3Client?.destroy();
    throw error;
  }
}

function buildDatabaseUrl(host: string, port: number): string {
  return `postgres://${DATABASE_USERNAME}:${DATABASE_PASSWORD}@${host}:${port}/${DATABASE_NAME}`;
}

async function createLocalstackSqsQueue(endpoint: string, queueName: string): Promise<string> {
  // Bun + Testcontainers can hang when LocalStack SQS bootstrap goes through child
  // process / SDK setup during integration startup. A direct SQS Query API call keeps
  // the queue creation step deterministic while still exercising the LocalStack container.
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      Action: "CreateQueue",
      QueueName: queueName,
      Version: "2012-11-05",
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`LocalStack SQS queue creation failed with status ${response.status}.`);
  }

  const responseText = await response.text();
  const queueUrlMatch = responseText.match(/<QueueUrl>([^<]+)<\/QueueUrl>/);

  if (!queueUrlMatch?.[1]) {
    throw new Error("LocalStack SQS queue URL was not returned.");
  }

  return queueUrlMatch[1];
}
