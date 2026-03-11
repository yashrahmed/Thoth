import { Pool } from "pg";
import {
  getConvStoreDatabaseConfig,
} from "@thoth/config";

export function createConvStorePool(
  databaseConfig = getConvStoreDatabaseConfig(),
): Pool {

  return new Pool({
    host: databaseConfig.host,
    port: databaseConfig.port,
    database: databaseConfig.database,
    user: databaseConfig.user,
    password: databaseConfig.password,
    ssl: databaseConfig.ssl,
  });
}
