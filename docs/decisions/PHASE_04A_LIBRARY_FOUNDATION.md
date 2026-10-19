# Phase 04A — Public Library foundation

Date: 19 October 2026.

This gate adds the public Library without seeding the ten official SDKs, community review, fees, or an NPM client.

`/library` lists published SDKs only. Before the migration, the page says the Library is unavailable. After the migration and before any publication, it says no SDKs are published. A saved private draft is not a listing.

`library_versions.blueprint` and its content hash cannot be updated or deleted. A new definition inserts the next version number. The same hash reuses the existing version. Phase 05 attribution reads `originator_account_id` and `originator_label` from the listing, and a remix copies those onto the private draft as `sdk_drafts.originator_account_id`, `originator_label`, `source_sdk_id`, and `source_version_id`.

Library tests use `runBlueprint` and the signed-in website-run quota. There is no anonymous execution. Remix creates an unsaved workspace owned by the remixer and does not change the published source. Save still requires a successful test of that workspace hash.

`supabase/migrations/20261019160000_phase_04a_library.sql` has been applied. Do not reapply it or earlier migrations.

The ten official names live in `OFFICIAL_SDK_NAMES`. Gate 04A does not insert them.
