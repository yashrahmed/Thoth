-- Phase 15: legacy UUID message identifiers are no longer part of the API
-- contract. This migration must follow deployment and verification of the
-- bigint-only Worker.
drop table thoth.message_id_aliases;
