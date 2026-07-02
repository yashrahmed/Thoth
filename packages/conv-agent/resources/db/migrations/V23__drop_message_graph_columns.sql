-- Messages no longer track conversation graph structure. The only remaining
-- relation is the link from a message to its conversation; reads order by
-- created_at (messages_created_idx from V13 stays for that).
drop index if exists thoth.messages_parent_idx;
drop index if exists thoth.messages_path_gist_idx;

alter table thoth.messages
  drop constraint if exists messages_path_unique,
  drop constraint if exists messages_child_count_non_negative;

alter table thoth.messages
  drop column if exists parent_message_id,
  drop column if exists path,
  drop column if exists child_count;

drop extension if exists ltree;
