declare module "pg" {
  export interface PoolClient {
    query<Row = unknown>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>>;
    release(): void;
  }

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
    connect(): Promise<PoolClient>;
    query<Row = unknown>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>>;
    end(): Promise<void>;
  }
}
