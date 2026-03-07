1. Set up the repository layer for object storage.
2. Try out the servers with a test frontend.
3. Figure out auth and whether it is easier to make the system inherently multi-tenant. Even though it is a personal assistant, it runs remotely, so it still needs some form of auth.
4. Add repository integration tests that verify conversation and message persistence stays aligned with the Flyway schema.
5. Define the first public planning-agent inputs and outputs.
6. Connect planning-agent to conv-agent via tool invocation.
