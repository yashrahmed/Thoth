import { Pool } from "pg";
export {
  getConvStoreDatabaseConfig,
  type ConvStoreDatabaseConfig,
} from "@thoth/config";
import {
  getConvStoreDatabaseConfig,
  type ConvStoreDatabaseConfig,
} from "@thoth/config";

export function createConvStorePool(
  databaseConfig = getConvStoreDatabaseConfig(),
): Pool {
  if (Number.isNaN(databaseConfig.port)) {
    throw new Error("CONV_STORE_DB_PORT must be a valid number.");
  }

  return new Pool({
    host: databaseConfig.host,
    port: databaseConfig.port,
    database: databaseConfig.database,
    user: databaseConfig.user,
    password: databaseConfig.password,
    ssl: databaseConfig.ssl,
  });
}
