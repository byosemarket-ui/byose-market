# SQLite Foundation

This directory is reserved for the SQLite migration phase.

Structure:
- connection and provider wiring live under server/database and server/database/providers
- migration files belong in server/database/sqlite/migrations
- repository implementations belong in server/repositories/sqlite

Current status:
- path and directory preparation is complete
- runtime schema and query implementation are intentionally deferred to the next migration phase
