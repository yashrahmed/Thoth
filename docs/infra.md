# Infrastructure Options

Current direction: use an all-AWS stack for the app, queue, and object
storage.

| Stack      | Components                                                       | Good For                                                           | Rough Monthly Cost | Tradeoffs                                                          |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ | -----------------: | ------------------------------------------------------------------ |
| `All AWS`  | `ECS Express Mode` + `RDS PostgreSQL` + `S3` + `SQS Standard`    | Closest App Runner replacement with low-ops AWS container hosting  |          `$25-$80` | Newer service model and still more AWS setup than hosted platforms |
| `All AWS+` | `ECS on Fargate` + `Aurora PostgreSQL` + `S3` + `SQS Standard`   | More control over tasks, networking, and scaling on AWS           |         `$50-$150` | More operational surface area than ECS Express Mode                |
| `All AWS++`| `Elastic Beanstalk` + `RDS PostgreSQL` + `S3` + `SQS Standard`   | Higher-level AWS web app deployment without managing ECS directly |          `$30-$90` | Less container-native and less flexible than the ECS options       |

Notes:

- `SQS Standard` is the default queue choice because it is the cheapest AWS
  managed queue option and is sufficient for asynchronous LLM completion.
- `S3` is the target long-term object store. Existing `R2` usage can be
  migrated later.
