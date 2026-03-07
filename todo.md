1. Set up the repository layer for object storage.
2. Try out the servers with a test frontend.
3. Figure out auth and whether it is easier to make the system inherently multi-tenant. Even though it is a personal assistant, it runs remotely, so it still needs some form of auth.
4. Add a foreign key constraint from `messages.conversation_id` to the conversations table once the conversations table exists.
