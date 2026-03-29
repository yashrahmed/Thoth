Immediate -
1. Examine transactions. ****
   1. Transactionally create a user message plus file rows.
   2. Transactionally delete the DB conversation graph before blob cleanup.
   3. When the LLM service is split out, transactionally persist the outbox request with the triggering user turn.
2. Examine async usage.
3. Examine outbox for file uploads. *****
   1. This will require modeling a file independent of a message and a conversation and then each message_ids having a list of file_ids like before.
4. Examine async options for LLM completion.
   1. LLM completion contract must accept a conversation id.
   2. Figure out a good option for a message queue.
   3. Figure out how to lock down the conversation while a message is being processed.
   4. Create a separate LLM server that accepts an 
5. Trials for Google Auth. 
6. Deployment trials on Cloudflare.
7. Integrate an actual LLM and make it useful at least locally.
8. Experiment to visualize the app's structure.

Big picture -
1. Learn and try (Quint Lang)[https://quint-lang.org/docs/getting-started]. Use spec modeling to define temporal behaviors.
2. Extend #1 via temporal logic.
3. Encoding world models (for app behavior and changes) via integration tests.
4. Learn ways to maintain a history of changes.
5. Supporting server side rendering of content.
6. Supporting Oauth and multitenancy.

Open Question -
1. How do I improve LLM planning? 
   1. I do not have an answer as of now. Manual intervention and planning code placement myself is the only way.
   2. Increase the bandwidth b/w the LLMs plans and the engineer making it easier to navigate the codebase and understand the machine's intent.
