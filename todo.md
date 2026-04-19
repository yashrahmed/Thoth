### Track 1 - Developing the app in a traditional way.

#### Backend
1. Move to using cloudflare queue and do a local and dev test run. ****
2. Test R2 on dev profile. ****
3. Run local against actual Cloudflare services.
4. Deployment trials on Cloudflare.
5. Examine async usage.
6. Trials for Auth.
7. Integrate an actual LLM and make it useful at least locally.
8. Supporting server side rendering of content.
9.  Supporting Oauth and multitenancy.

#### UI
1. Build a basic but chat UI ****
2. Provide support for attachment thumbnails.

### Track 2 - Develop a mechanism to visualize the code structure and plan code changes.

1. Check out relevant skills [here](https://github.com/mattpocock/skills/blob/main/prd-to-plan/SKILL.md).
2. Tool to generate and visualize call graphs and trace application flows.
3. Tool to generate **vertical** sequence diagrams.
4. Collect these mechanisms into a separate editor project.
5. As of April 09, 2026, I am more inclined to focus on track 03 and instead develop LLM powered workflows to accomplish track 2's goals. I will start out with this and pivot back to developing editing and viz tools. I still think editing and viz tools have a place if only to help the engineer understand the LLM's output.

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
