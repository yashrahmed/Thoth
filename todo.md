### Track 1 - Developing the app in a traditional way.

#### Backend
1. Move to using cloudflare queue / worker and do a local test run. ***
2. Launch app locally in dev mode (i.e actual Cloudflare services).
3. Integrate an actual LLM and make it useful locally.
4. Deployment trials on Cloudflare.
5. Examine async usage.
6. Trials for Auth + Supporting Oauth and multitenancy.

#### UI
1. Build a basic but chat UI.

### Track 2 - Develop a mechanism to visualize the code structure and plan code changes.
 ```I will move this into a new project. I wish to be able to build a graph where the node describes the code components```.
1. As of April 09, 2026, I am more inclined to focus on track 03 and instead develop LLM powered workflows to accomplish track 2's goals. I will start out with this and pivot back to developing editing and viz tools. I still think editing and viz tools have a place if only to help the engineer understand the LLM's output.

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
