-- Phase 01 foundation.
-- This migration establishes the versioned directory only.
-- It does not create blueprint, identity, launch, feed, or financial tables.

comment on schema public is
  'SDK application database. Phase 01 records the migration boundary only.';
