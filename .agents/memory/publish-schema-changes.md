---
name: Publish schema changes
description: Avoid running development schema pushes as part of deployment builds.
---

Keep `npm run db:push` out of the deployment build command. Replit Publish applies the development-to-production schema diff; pushing schema from the build step can apply DDL before that migration runs and leave the deployment diff inconsistent.

**Why:** The failed deployment ran `db:push --force`, then Replit's publish migration attempted additional destructive statements against production-only records.

**How to apply:** Use `db:push` only when intentionally updating the development schema. Before publishing, inspect the production diff and preserve populated production-only fields and tables unless the user explicitly authorizes their removal.