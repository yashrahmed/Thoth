### Track 1 - Developing the app in a traditional way.

#### Backend
1. Figure out a way to host creds outside of the local env.
2. Switch from S3 compatible API to R2 native API.
3. Examine async usage in the context of worker execution.
4. Understand the Cloudflare security model.
5. Deployment trials on Cloudflare.
   1. Set up a deploy script to configure a worker.
   2. Figure out security and http tunneling.
   3. Dependencies should be set up in the previous step.
   4. Ensure that other forms of deploys do not regress.
6. Integrate an actual LLM and make it useful locally.
7. Trials for Auth + Supporting Oauth and multitenancy.

#### UI
1. Build a basic but chat UI.

### Track 2 - Develop a mechanism to visualize the code structure and plan code changes.
 ```I will move this into a new project. I wish to be able to build a graph where the node describes the code components```.
1. As of April 09, 2026, I am more inclined to focus on track 03 and instead develop LLM powered workflows to accomplish track 2's goals. I will start out with this and pivot back to developing editing and viz tools. I still think editing and viz tools have a place if only to help the engineer understand the LLM's output.
2. As of April 27,2026. I will start with an editor that looks more like a workbench. The design goal must be to enable an engineer to build systems bottom up and ground the design in real word interactions.

### Track 3 - Develop techniques to encode world models and test cases.

1. Start with writing test cases using input, output and state descriptions.
2. Learn and try (Quint Lang)[https://quint-lang.org/docs/getting-started]. Use spec modeling to define temporal behaviors.
3. Extend #1 via temporal logic.
4. Encoding world models (for app behavior and changes) via integration tests.
5. Learn ways to maintain a history of changes.

Open Question -

1. How do I improve LLM planning?
   1. You don't. A human in the loop system is a must at this point in time.
   2. Increase the bandwidth b/w the LLMs plans and the engineer making it easier to navigate the codebase and understand the machine's intent. See #2.
   3. For now, it may be prudent to develop tools to enable "gardening".
