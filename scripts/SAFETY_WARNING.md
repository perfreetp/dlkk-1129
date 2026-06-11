# DATA SAFETY WARNINGS

## Critical: Do Not Delete the Data Directory

The `./data` directory contains the SQLite database file (`macos_community.db`) with all user data, software records, discussion posts, audit logs, and more.

**NEVER run these commands:**
- `Remove-Item -Recurse -Force data` (PowerShell)
- `rm -rf data` (Unix/Linux/Mac)
- `rimraf data`
- Any command that recursively deletes the `data` folder

## Destructive Operations Safety

All destructive API operations are protected by:
1. Authentication (JWT token required)
2. Role-based access control (admin/editor only for most destructive actions)
3. Database transactions to ensure atomicity
4. Audit logging for all destructive actions

## Database Backup Recommendations

Before any maintenance or migration:
1. Stop the server
2. Copy `./data/macos_community.db` to a backup location
3. Verify the backup is valid
4. Proceed with maintenance

## Test Scripts

If you create test scripts that need to reset the database:
- Add clear warnings at the top of the script
- Require explicit confirmation before deletion
- Only delete test database files, never the production database
- Use a separate test database file (e.g., `test.db`)
