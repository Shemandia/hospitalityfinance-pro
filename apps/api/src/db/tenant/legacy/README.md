# Pre-WP-2 access migrations

Tenant databases built before WP-2 have no migration history. These two WP-A
scripts brought such a database's role tables up to date:

1. `20261111000000_role_assignments.sql` creates `role_assignments` and copies
   the old grants into it, once.
2. `20261114000000_drop_legacy_role_tables.sql` then drops `user_roles`,
   `entity_users` and the `EntityRole` enum.

They are **not** part of the tenant migration history; the baseline
(`../migrations/0_baseline`) already contains their result. They are kept for
adopting an older database that has not run them yet (`db:adopt-tenant`), and
the access-control integration test exercises the copy.
