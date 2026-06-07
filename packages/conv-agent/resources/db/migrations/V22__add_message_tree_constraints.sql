-- Add a temporary not-valid check so new writes must have a path while
-- existing rows can be validated separately.
alter table thoth.messages
  add constraint messages_path_not_null
    check (path is not null) not valid;

-- Validate existing rows against the temporary check. This confirms the
-- backfill completed before we convert the column to a real not-null column.
alter table thoth.messages
  validate constraint messages_path_not_null;

-- Make path non-null at the column level. Postgres can use the validated
-- check constraint as proof, avoiding a second full validation pass.
alter table thoth.messages
  alter column path set not null;

-- Drop the temporary check because the column-level not-null constraint now
-- enforces the same rule.
alter table thoth.messages
  drop constraint messages_path_not_null;

-- Attach the concurrently-created unique index as the final table constraint.
-- Postgres will rename messages_path_unique_idx to messages_path_unique.
alter table thoth.messages
  add constraint messages_path_unique
    unique using index messages_path_unique_idx;
