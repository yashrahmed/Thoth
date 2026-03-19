import { afterAll, beforeAll, expect, test } from "bun:test";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import {
  convIntegrationSetup,
  type ConvIntegrationSetup,
} from "./conv-agent-it-setup";

let setup: ConvIntegrationSetup | undefined;

beforeAll(async () => {
  setup = await convIntegrationSetup();
});

afterAll(async () => {
  await setup?.stop();
  setup = undefined;
});

test("starts postgres, runs flyway, starts s3mock, and prints hello world", async () => {
  expect(setup).toBeDefined();

  if (!setup) {
    throw new Error("Integration setup was not started.");
  }

  expect(setup.server.port).toBeDefined();

  const healthResponse = await fetch(new URL("/health", setup.server.url));

  expect(healthResponse.status).toBe(200);
  expect(await healthResponse.json()).toEqual({
    status: "ok",
    service: "conv-agent",
  });

  const databaseResult = await setup.database<{ value: number }[]>`
    select 1 as value
  `;
  const schemaResult = await setup.database<{ schema_name: string }[]>`
    select schema_name
    from information_schema.schemata
    where schema_name = 'thoth'
  `;
  const tableResult = await setup.database<{ table_name: string }[]>`
    select table_name
    from information_schema.tables
    where table_schema = 'thoth'
      and table_name = 'messages'
  `;

  expect(databaseResult).toHaveLength(1);
  expect(databaseResult[0]?.value).toBe(1);
  expect(schemaResult).toHaveLength(1);
  expect(schemaResult[0]?.schema_name).toBe("thoth");
  expect(tableResult).toHaveLength(1);
  expect(tableResult[0]?.table_name).toBe("messages");

  const bucketResult = await setup.blobClient.send(
    new HeadBucketCommand({
      Bucket: setup.blobBucket,
    }),
  );

  expect(bucketResult.$metadata.httpStatusCode).toBe(200);

  console.log("hello world");
});
