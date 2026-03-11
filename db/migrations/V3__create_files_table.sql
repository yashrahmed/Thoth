CREATE TABLE IF NOT EXISTS public.files (
  id UUID PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  last_create_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS files_message_id_idx
  ON public.files (message_id);
