# Phase 1 API contract

The interactive OpenAPI contract is served at `/api/docs`. All routes except health, the OAuth routes, and Swagger UI require the `token` httpOnly cookie. Authenticated project and scan lookups are scoped to the current user's owner ID. Missing or foreign-owned project IDs return 404.

| Method | Path | Phase 1 behavior |
|---|---|---|
| GET | `/api/health` | Public health response |
| GET | `/api/auth/google` | Start Google OAuth |
| GET | `/api/auth/google/callback` | Upsert user, issue JWT cookie, redirect |
| GET | `/api/auth/me` | Return the signed-in user |
| POST | `/api/auth/logout` | Clear the cookie |
| GET / POST | `/api/projects` | List or create owned GitHub projects |
| GET / PATCH / DELETE | `/api/projects/{id}` | Read, update, or delete an owned project |
| POST | `/api/projects/{id}/scans` | 501 stub for Phase 2 |
| GET | `/api/scans/{id}` | 501 stub for Phase 2 |
| GET | `/api/scans/{id}/findings` | 501 stub for Phase 2 |
| POST | `/api/quick-scan` | 501 stub for Phase 2 |

Project URLs must use `https://github.com/<owner>/<repo>`. Validation rejects other hosts. API errors use `{ "error": { "code": "...", "message": "..." } }`; the reserved Phase 2 stubs return `{ "error": "Not implemented" }`.
