declare module "pg" {
  export interface QueryResult<Row> {
    rows: Row[];
  }

  export interface PoolConfig {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    ssl?: boolean;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    query<Row = unknown>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>>;
  }
}
