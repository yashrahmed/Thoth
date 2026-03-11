DROP TABLE IF EXISTS public.attachments CASCADE;
DROP TABLE IF EXISTS public.files CASCADE;
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.conversations CASCADE;

CREATE TABLE public.conversations (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE public.messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('assistant', 'developer', 'system', 'user')),
  text_content TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE public.attachments (
  id UUID PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX conversations_updated_at_idx
  ON public.conversations (updated_at DESC, id ASC);

CREATE INDEX messages_conversation_id_idx
  ON public.messages (conversation_id, created_at ASC, id ASC);

CREATE INDEX attachments_message_id_idx
  ON public.attachments (message_id, created_at ASC, id ASC);
