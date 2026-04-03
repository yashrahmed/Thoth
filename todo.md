### Track 1 - Developing the app in a traditional way.

1. Examine async usage.
2. Examine async options for LLM completion.
   1. Use `SQS Standard` as the queue option for LLM dispatch (Issues with integration tests).
3. Migrate file storage from `R2` to `S3` and do a live test run.
4. Trials for Google Auth.
5. Deployment trials on AWS.
6. Integrate an actual LLM and make it useful at least locally.
7. Supporting server side rendering of content.
8. Supporting Oauth and multitenancy.

### Track 2 - Develop a mechanism to visualize the code structure and plan code changes.

1. Experiment to visualize the app's structure.
2. Develop a visualizer/editor.

### Track 3 - Develop techniques to encode world models and test cases.

1. Learn and try (Quint Lang)[https://quint-lang.org/docs/getting-started]. Use spec modeling to define temporal behaviors.
2. Extend #1 via temporal logic.
3. Encoding world models (for app behavior and changes) via integration tests.
4. Learn ways to maintain a history of changes.

Open Question -

1. How do I improve LLM planning?
   1. You don't. A human in the loop system is a must at this point in time.
   2. Increase the bandwidth b/w the LLMs plans and the engineer making it easier to navigate the codebase and understand the machine's intent. See #2.
