# DevSentry API contract

The interactive OpenAPI contract is served at `/api/docs`. All routes except health, the OAuth routes, and Swagger UI require the `token` httpOnly cookie. Authenticated project and scan lookups are scoped to the current user's owner ID. Missing or foreign-owned project IDs return 404.

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/health` | Public health response |
| GET | `/api/auth/google` | Start Google OAuth |
| GET | `/api/auth/google/callback` | Upsert user, issue JWT cookie, redirect |
| GET | `/api/auth/me` | Return the signed-in user |
| POST | `/api/auth/logout` | Clear the cookie |
| GET / POST | `/api/projects` | List or create owned GitHub projects |
| GET / PATCH / DELETE | `/api/projects/{id}` | Read, update, or delete an owned project |
| POST | `/api/projects/{id}/scans` | Queue an owned project scan (202); 409 if the user already has an active scan |
| GET | `/api/scans/{id}` | Implemented: owner scoped scan status, stage, summary, warnings, timing |
| GET | `/api/scans/{id}/findings` | Implemented: owner scoped, severity/category/file filters, pagination |
| GET | `/api/scans/{id}/files` | Implemented: owner scoped file risk scores, pagination |
| POST | `/api/quick-scan` | 501 stub; intentionally unchanged |

Project URLs must use `https://github.com/<owner>/<repo>`. Validation rejects other hosts. API errors use `{ "error": { "code": "...", "message": "..." } }`; the reserved quick scan stub returns `{ "error": "Not implemented" }`.

Scan processing uses Docker Semgrep by default, with local mode available through `SEMGREP_MODE=local`. OpenAPI documentation is served at `/api/docs`.
