# DevSentry

AI-assisted software bug-risk prediction and code analysis platform. Sign in with Google, point it at a public GitHub repository (or paste a snippet), and get a per-file defect-risk score, explained findings, and a dashboard of trends across scans.

> **Status:** In development (Capstone Project). Features marked ✅ are implemented; the rest are planned.

---

## Table of Contents
- [Features](#features)
- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Overview](#api-overview)
- [Testing](#testing)
- [DevOps Roadmap](#devops-roadmap)
- [Limitations](#limitations)
- [Team](#team)

---

## Features
- Google OAuth sign-in (single-user accounts, no roles)
- Scan a **public GitHub repository** or **paste a code snippet** (Quick Scan)
- Supported languages: **JavaScript/TypeScript, Python, Java**
- Per-file **defect-risk score** with the contributing factors shown
- Findings with severity, line numbers, explanation, and suggested fix
- Monaco code viewer with inline findings
- Dashboard with scan history and risk trends
- Light/dark theme, loading skeletons, empty states, error toasts
- Swagger API documentation

## How It Works

Each scan runs asynchronously through this pipeline:

1. **Clone**: shallow clone into a temp directory (size, depth, and time limits enforced). Repository code is only read, never executed.
2. **Analyze**
   - [Semgrep](https://semgrep.dev/) for bug, smell, and security findings
   - [Lizard](https://github.com/terryyin/lizard) for cyclomatic complexity, function length, parameter count
   - Git history (`simple-git`) for churn, author count, and bug-fix commit count per file
3. **Score**: compute a weighted, normalized risk score per file.
4. **Explain**: the top findings are sent to an LLM (Gemini or Groq) for plain-language explanations and fix suggestions.
5. **Store**: results are saved to MongoDB and the scan is marked `done`.

### Risk score

A weighted, normalized combination of:

| Factor | Signal |
|---|---|
| Complexity | Max and average cyclomatic complexity |
| Churn | Commits touching the file in the last 90 days |
| Authors | Number of distinct contributors |
| Bug-fix history | Commits whose message matches `fix`, `bug`, or `patch` |
| Size | Lines of code |
| Static findings | Severity-weighted Semgrep results |

The score is explainable: the UI shows which factors drove it.

> **Note:** this is a heuristic, metrics-based defect-risk model built on signals commonly used in defect-prediction research. It is **not** a trained machine-learning model. The LLM is used only to explain findings, not to compute scores.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS, shadcn/ui, React Router, TanStack Query, Axios, Recharts, Monaco Editor |
| Backend | Node.js, Express, TypeScript, Mongoose, Zod, helmet, cors, express-rate-limit |
| Auth | Google OAuth 2.0, JWT in an httpOnly cookie |
| Database | MongoDB Atlas |
| Analysis | Semgrep, Lizard, simple-git |
| LLM | Google Gemini (free tier) or Groq, behind a swappable `aiService` |
| Docs | swagger-jsdoc, swagger-ui-express |
| Testing | Jest, Supertest |

## Architecture

```
Browser (React SPA)
   │  HTTPS / JSON (cookie auth)
   ▼
Express API ── routes → controllers → services → models
   │                                   │
   │                                   ├── repoService     (clone, limits)
   │                                   ├── metricsService  (Lizard, git history)
   │                                   ├── scanService     (pipeline, scoring)
   │                                   └── aiService       (Gemini / Groq)
   ▼
MongoDB Atlas  (User, Project, Scan, Finding)
```

**Auth flow:** Google consent → callback → upsert user → sign JWT → set httpOnly cookie → redirect to `/dashboard`. Every `/api` route except auth requires login, and every query is scoped to the signed-in user.

### Data models
- **User**: `googleId, email, name, avatar, createdAt`
- **Project**: `owner, name, source {type, url}, createdAt`
- **Scan**: `project, status (queued|running|done|failed), summary {riskScore, counts by severity}, startedAt, finishedAt`
- **Finding**: `scan, filePath, line, severity, category, message, suggestion, riskScore`

### Frontend routes

| Route | Purpose |
|---|---|
| `/` | Landing page and Google sign-in |
| `/dashboard` | Summary cards, recent scans, risk trend |
| `/projects` | List, create, delete projects |
| `/projects/:id` | Scan history and file-risk table |
| `/scans/:id` | Scan status, severity breakdown, findings with filters |
| `/scans/:id/files/*` | Code viewer with inline findings and AI explanation |
| `/quick-scan` | Paste a snippet for instant analysis |
| `/settings` | Profile and logout |

## Project Structure

```
.
├── client/
│   └── src/
│       ├── api/          # axios instance + per-resource calls
│       ├── components/   # ui/, layout/, charts/, findings/
│       ├── features/     # auth/, projects/, scans/
│       ├── hooks/        # useAuth, useScan (polling)
│       ├── pages/
│       ├── routes/       # ProtectedRoute
│       └── lib/
├── server/
│   └── src/
│       ├── config/       # env, db, passport
│       ├── middleware/   # auth, error, validate, rateLimit
│       ├── models/
│       ├── routes/
│       ├── controllers/
│       ├── services/
│       ├── utils/
│       ├── app.ts
│       └── server.ts
├── docs/
└── README.md
```

## Getting Started

### Prerequisites
- Node.js 20+
- Python 3.10+ (for Semgrep and Lizard)
- Git
- A MongoDB Atlas cluster (free tier is fine)
- A Google Cloud OAuth client (see below)
- A free Gemini or Groq API key

### 1. Clone
```bash
git clone https://github.com/<your-org>/bugsight.git
cd bugsight
```

### 2. Install analysis tools
```bash
pip install semgrep lizard
semgrep --version && lizard --version
```

### 3. Google OAuth setup
1. Open Google Cloud Console → APIs & Services → Credentials.
2. Create an **OAuth client ID** (Web application).
3. Add authorized redirect URI: `http://localhost:5000/api/auth/google/callback`
4. Copy the client ID and secret into `server/.env`.

### 4. LLM key
- Gemini: create a key in [Google AI Studio](https://aistudio.google.com/)
- Groq: create a key at [console.groq.com](https://console.groq.com/)

### 5. Configure environment
```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```
Fill in the values (see below).

### 6. Install and run
```bash
# backend
cd server && npm install && npm run dev

# frontend (new terminal)
cd client && npm install && npm run dev
```
Frontend: http://localhost:5173 · API: http://localhost:5000 · Swagger: http://localhost:5000/api/docs

### 7. Run with Docker Compose (optional)
```bash
docker compose up --build -d
```
This starts `mongo`, `server` (with Git, Python, Semgrep `1.185.0`, and Lizard), and `client` (Nginx serving the SPA and proxying `/api`).

To run the Selenium E2E suite inside Docker against the running stack:
```bash
docker compose --profile test run --rm selenium
```

## Environment Variables

**server/.env**
```
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173
MONGODB_URI=
JWT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback
AI_PROVIDER=gemini          # gemini | groq
GEMINI_API_KEY=
GROQ_API_KEY=
MAX_REPO_SIZE_MB=100
CLONE_DEPTH=500
SCAN_TIMEOUT_MS=180000
```

**client/.env**
```
VITE_API_URL=http://localhost:5000/api
```

Never commit `.env` files.

## API Overview

Full interactive docs are available at `/api/docs` (Swagger).

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/auth/google` | Start Google sign-in |
| GET | `/api/auth/google/callback` | OAuth callback, sets cookie |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/logout` | Clear session |
| GET/POST/PATCH/DELETE | `/api/projects` | Project CRUD |
| POST | `/api/projects/:id/scans` | Start a scan (202, runs async) |
| GET | `/api/scans/:id` | Scan status and summary |
| GET | `/api/scans/:id/findings` | Findings (`?severity=&file=&page=`) |
| POST | `/api/quick-scan` | Analyze a pasted snippet |

## Testing

### 1. Backend Unit Tests (Jest)
Run unit tests for risk scoring algorithms, AI prompt integration, metric extraction, and static analysis parsing:
```bash
cd server
npm test
```

### 2. Frontend Component & Unit Tests (Vitest)
Run React component tests for routing, forms, scan polling, and the Quick Scan playground:
```bash
cd client
npm test
```

### 3. End-to-End Browser Tests (Selenium + Pytest)
Automated UI testing against Google Chrome and Microsoft Edge:
```bash
# Ensure client is built and running (or use automated runner)
cd client && npm run build
python tests/selenium/run_selenium.py

# Alternatively, run directly with pytest:
pytest tests/selenium -v
pytest tests/selenium -v --headed    # Run with visible browser window
pytest tests/selenium -v --browser edge # Run using Edge
```

## DevOps Roadmap

- [ ] Jira board with sprints and linked issues
- [ ] Git/GitHub workflow (feature branches, pull requests, reviews)
- [x] Unit tests (Jest) and Selenium end-to-end tests
- [ ] Jenkins CI pipeline (install, lint, test, build, Docker image)
- [x] Dockerfiles and docker-compose
- [ ] Kubernetes manifests
- [ ] GitHub webhooks (trigger Jenkins on push)
- [ ] Postman collection
- [ ] Nginx reverse proxy with HTTPS
- [ ] Cloud deployment

## Limitations
- Supports public GitHub repositories only.
- Analysis quality varies by language; JS/TS, Python, and Java are the only supported ones.
- Risk scoring is heuristic, and a backtest (precision@top-10 on repository history) is planned to measure it.
- Free-tier LLM rate limits apply; only the top findings are explained.
- Scans run in an in-process queue, with no distributed workers.

## Team
| Name | Role |
|---|---|
| _Name_ | _Role_ |
| _Name_ | _Role_ |
| _Name_ | _Role_ |

## License
MIT (or as required by your university)

## Phase 1 status

Phase 1 provides Google OAuth cookie-auth scaffolding, owner-scoped project CRUD, health and analysis stub routes, Swagger UI, MongoDB models, a React dashboard and project workspace, form validation, and automated API/UI tests. Repository scanning, static analysis, git metrics, and LLM explanations are deferred to Phase 2. Configure `server/.env` and `client/.env` from their `.env.example` files and ensure MongoDB is running.

Run the API in one terminal with `cd server && npm install && npm run dev`; run the UI in another with `cd client && npm install && npm run dev`. Validate with `cd server && npm run typecheck && npm run lint && npm test -- --coverage`, then `cd client && npm run typecheck && npm run lint && npm test && npm run build`. The API listens on port 5000 and the Vite client on port 5173 by default.
