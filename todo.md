### Track 1 - Developing the app in a traditional way.

#### Backend
1. Set credentials from env variables i.e. setup class must set the creds from env variables. The launch scripts must set the creds in an env file. ****
2. Migrate file storage from `R2` to `S3` and do a live test run. ****
3. Deployment trials on AWS.
   1. Figure out DNS, app runner deployment.
4. Examine async usage.
5. Examine async options for LLM completion.
   1. Use `SQS Standard` as the queue option for LLM dispatch (Issues with integration tests).
6. Trials for Google Auth.
7. Integrate an actual LLM and make it useful at least locally.
8. Supporting server side rendering of content.
9.  Supporting Oauth and multitenancy.

#### UI
1. Build a basic by classy UI ****
2. Provide support for attachment thumbnails.

### Track 2 - Develop a mechanism to visualize the code structure and plan code changes.

1. Check out relevant skills [here](https://github.com/mattpocock/skills/blob/main/prd-to-plan/SKILL.md). ****
2. Tool to generate and visualize call graphs and trace application flows.
3. Tool to generate **vertical** sequence diagrams.
4. Collect these mechanisms into a separate editor project.

### Track 3 - Develop techniques to encode world models and test cases.

1. Learn and try (Quint Lang)[https://quint-lang.org/docs/getting-started]. Use spec modeling to define temporal behaviors.
2. Extend #1 via temporal logic.
3. Encoding world models (for app behavior and changes) via integration tests.
4. Learn ways to maintain a history of changes.

Open Question -

1. How do I improve LLM planning?
   1. You don't. A human in the loop system is a must at this point in time.
   2. Increase the bandwidth b/w the LLMs plans and the engineer making it easier to navigate the codebase and understand the machine's intent. See #2.
   3. For now, it may be prudent to develop tools to enable "gardening".
