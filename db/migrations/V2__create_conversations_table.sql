CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY,
  last_create_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_update_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.conversations (
  id,
  last_create_ts,
  last_update_ts
)
SELECT
  messages.conversation_id,
  MIN(messages.last_create_ts) AS last_create_ts,
  MAX(messages.last_update_ts) AS last_update_ts
FROM public.messages AS messages
GROUP BY messages.conversation_id
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_conversation_id_fkey
  FOREIGN KEY (conversation_id)
  REFERENCES public.conversations(id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS conversations_last_update_ts_idx
  ON public.conversations (last_update_ts DESC);
