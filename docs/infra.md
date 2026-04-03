# Infrastructure Options

Current direction: use an all-AWS stack for the app, queue, and object
storage.

| Stack     | Components                                                     | Good For                                      | Rough Monthly Cost | Tradeoffs                                                |
| --------- | -------------------------------------------------------------- | --------------------------------------------- | -----------------: | -------------------------------------------------------- |
| `All AWS` | `App Runner` + `RDS PostgreSQL` + `S3` + `SQS Standard`        | Single-vendor deployment with the cheapest AWS queue option |         `$25-$80` | Higher base database cost than Neon and more AWS setup   |
| `All AWS+`| `App Runner` + `Aurora PostgreSQL` + `S3` + `SQS Standard`     | AWS-native scaling with managed Postgres      |         `$50-$150` | Higher cost floor than plain RDS                         |

Notes:

- `SQS Standard` is the default queue choice because it is the cheapest AWS
  managed queue option and is sufficient for asynchronous LLM completion.
- `S3` is the target long-term object store. Existing `R2` usage can be
  migrated later.
