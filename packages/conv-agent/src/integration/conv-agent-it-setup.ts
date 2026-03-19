import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { S3MockContainer } from "@testcontainers/s3mock";
import { GenericContainer, Network, Wait } from "testcontainers";
import { createPostgresDatabase, type PostgresDatabase } from "../adapter/postgres/postgres-database";
import { convSetup, type ConvSetupResult } from "../conv-setup";

const POSTGRES_IMAGE = "pgvector/pgvector:pg17";
const FLYWAY_IMAGE = "redgate/flyway:11-alpine";
const S3MOCK_IMAGE = "adobe/s3mock:latest";
const DATABASE_NAME = "thoth_test";
const DATABASE_USERNAME = "thoth";
const DATABASE_PASSWORD = "thoth";
const DATABASE_NETWORK_ALIAS = "conv-agent-postgres";
const BLOB_BUCKET = "thoth-test";
const BLOB_FOLDER = "integration";
const BLOB_REGION = "auto";
const POSTGRES_PORT = 5432;
const POSTGRES_COMMAND = [
  "postgres",
  "-c",
  "shared_buffers=256MB",
  "-c",
  "effective_cache_size=1GB",
  "-c",
  "maintenance_work_mem=128MB",
  "-c",
  "work_mem=8MB",
  "-c",
  "wal_compression=on",
  "-c",
  "max_connections=100",
] as const;

interface StoppableContainer {
  stop(): Promise<unknown>;
}

interface StartedPostgresContainer extends StoppableContainer {
  getHost(): string;
  getMappedPort(port: number): number;
}

export interface ConvIntegrationSetup {
  readonly blobBucket: string;
  readonly blobClient: S3Client;
  readonly database: PostgresDatabase;
  readonly server: Bun.Server<undefined>;
  stop(): Promise<void>;
}

export async function convIntegrationSetup(): Promise<ConvIntegrationSetup> {
  const network = await new Network().start();
  let appSetup: ConvSetupResult | undefined;
  let database: PostgresDatabase | undefined;
  let postgresContainer: StartedPostgresContainer | undefined;
  let flywayContainer: StoppableContainer | undefined;
  let s3MockContainer:
    | Awaited<ReturnType<InstanceType<typeof S3MockContainer>["start"]>>
    | undefined;
  let s3Client: S3Client | undefined;

  try {
    postgresContainer = await new GenericContainer(POSTGRES_IMAGE)
      .withEnvironment({
        PGDATA: "/var/lib/postgresql/data/pgdata",
        POSTGRES_DB: DATABASE_NAME,
        POSTGRES_PASSWORD: DATABASE_PASSWORD,
        POSTGRES_USER: DATABASE_USERNAME,
      })
      .withCommand([...POSTGRES_COMMAND])
      .withExposedPorts(POSTGRES_PORT)
      .withNetwork(network)
      .withNetworkAliases(DATABASE_NETWORK_ALIAS)
      .withWaitStrategy(
        Wait.forLogMessage("database system is ready to accept connections"),
      )
      .start();

    flywayContainer = await new GenericContainer(FLYWAY_IMAGE)
      .withNetwork(network)
      .withPlatform("linux/amd64")
      .withBindMounts([
        {
          source: getMigrationsDirectory(),
          target: "/flyway/sql",
          mode: "ro",
        },
      ])
      .withCommand([
        "-defaultSchema=flyway",
        "-locations=filesystem:/flyway/sql",
        `-password=${DATABASE_PASSWORD}`,
        "-schemas=flyway,thoth",
        `-url=jdbc:postgresql://${DATABASE_NETWORK_ALIAS}:${POSTGRES_PORT}/${DATABASE_NAME}`,
        `-user=${DATABASE_USERNAME}`,
        "migrate",
      ])
      .withWaitStrategy(Wait.forOneShotStartup())
      .withStartupTimeout(180_000)
      .start();

    s3MockContainer = await new S3MockContainer(S3MOCK_IMAGE).start();

    s3Client = new S3Client({
      credentials: {
        accessKeyId: s3MockContainer.getAccessKeyId(),
        secretAccessKey: s3MockContainer.getSecretAccessKey(),
      },
      endpoint: s3MockContainer.getHttpConnectionUrl(),
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

    const databaseUrl = buildDatabaseUrl(
      postgresContainer.getHost(),
      postgresContainer.getMappedPort(POSTGRES_PORT),
    );

    appSetup = await convSetup({
      port: 0,
      databaseUrl,
      blobStorage: {
        accessKeyId: s3MockContainer.getAccessKeyId(),
        bucket: BLOB_BUCKET,
        endpoint: s3MockContainer.getHttpConnectionUrl(),
        folder: BLOB_FOLDER,
        region: BLOB_REGION,
        secretAccessKey: s3MockContainer.getSecretAccessKey(),
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
          await stopContainer(s3MockContainer);
          await stopContainer(flywayContainer);
          await stopContainer(postgresContainer);
          await network.stop();
        }
      },
    };
  } catch (error) {
    await appSetup?.stop();
    await database?.end();
    s3Client?.destroy();
    await stopContainer(s3MockContainer);
    await stopContainer(flywayContainer);
    await stopContainer(postgresContainer);
    await network.stop();
    throw error;
  }
}

function getMigrationsDirectory(): string {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));

  return resolve(currentDirectory, "../../../../db/migrations");
}

function buildDatabaseUrl(host: string, port: number): string {
  return `postgres://${DATABASE_USERNAME}:${DATABASE_PASSWORD}@${host}:${port}/${DATABASE_NAME}`;
}

async function stopContainer(container: StoppableContainer | undefined) {
  if (!container) {
    return;
  }

  await container.stop();
}
