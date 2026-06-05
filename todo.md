## Next Steps

### Making Thoth into an Omni Assistant

- An RTS-like chat UI that allows conversation branching and building like an evidence board.
  - Complete React tutorial.
  - Complete React Native tutorial.
  - Learn Three.js.
- Add support for branched conversations.
- User management, even though it is personal.
- Document vault and memories.
- Model picker.
- Automatic research and knowledge synthesis plus continual learning.
- Deeplink content support.
- Utility API integration, for example with Groot API reverse engineering.
- Search and MCP integration.
- Add support for overlay mode and video/audio inputs.
- Completion streaming.
- Context compaction support.
- Thoth mobile prototype.
- Timestamps on tool messages?
- [Experimental] In-context RAG for long conversations to improve completion time.
- [Experimental] Talking forms.

## Performance Improvements

- Figure out a way around repeated signing, defaulting to base64?
- Cloudflare-hosted inference, Workers AI / AI Gateway:
  - Explore CF agents as an inference option to reduce completion time.

## DevOps

- GitHub Actions for building and deploying the app.

## Notes to Add Support for Conversation Branching

### Flow Changes

- `add-to-conv` needs `parentMessageId`.
  - Adds the user message as a child of that parent.
  - Completion then runs from the new user message's path.
- `append-direct` needs `parentMessageId`.
  - Adds the message as a child of that parent.
  - Does not trigger completion.
- `get-messages-on-conv` needs a selected message, typically `leafMessageId`.
  - Loads the path from root to that selected or leaf message.
  - If an internal node is passed instead, it can render the partial path to that node.

### Data Model Changes

Before:

```sql
create table thoth.messages (
  id uuid primary key,
  conversation_id uuid not null references thoth.conversations(id),
  type text not null,
  sequence_number integer not null,
  content text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,

  unique (conversation_id, sequence_number)
);

constraint messages_sequence_number_positive
  check (sequence_number > 0);

constraint messages_conversation_sequence_unique
  unique (conversation_id, sequence_number);

create index messages_conversation_sequence_idx
  on thoth.messages (conversation_id, sequence_number asc);
```

After:

```sql
create extension if not exists ltree;

create table thoth.messages (
  id uuid primary key,
  conversation_id uuid not null references thoth.conversations(id),
  parent_message_id uuid null references thoth.messages(id),
  path ltree not null,
  type text not null,
  content text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,

  unique (conversation_id, path)
);

constraint messages_path_unique
  unique (conversation_id, path);

create index messages_parent_idx
  on thoth.messages (conversation_id, parent_message_id);

create index messages_path_gist_idx
  on thoth.messages using gist (path);

create index messages_created_idx
  on thoth.messages (conversation_id, created_at, id);
```

Old sequence-number constraints and indexes are removed.
