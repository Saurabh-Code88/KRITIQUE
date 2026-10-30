# Kritique

AI-powered code review platform with real-time streaming results.

Kritique lets a user submit code, queues the review in Redis/Bull, processes it in a separate worker with Groq, streams tokens back to the browser with Server-Sent Events, and stores the final result in PostgreSQL.

## Architecture

```text
React/Vite frontend
  -> POST /api/reviews
  -> Express backend creates Review row and Bull job
  -> Redis queue
  -> Node worker calls Groq streaming API
  -> Worker publishes token chunks to Redis pub/sub
  -> Backend SSE endpoint streams chunks to browser
  -> Completed review is saved in PostgreSQL
```

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite, Tailwind CSS, Monaco Editor |
| Backend | Node.js, Express, JWT auth, Zod validation, Winston logging |
| Worker | Node.js, Bull, Groq SDK |
| Streaming | Server-Sent Events plus Redis Pub/Sub |
| Database | PostgreSQL with Prisma |
| Queue | Redis plus Bull |
| Deployment | Docker Compose for local development, Render Blueprint for production |

## Requirements

- Node.js `>=20 <25`
- npm `>=10`
- Docker Desktop for local full-stack development
- Groq API key from `https://console.groq.com/keys`

## Environment

Copy the sample env file and set secrets:

```bash
cp .env.example .env
```

Important variables:

| Variable | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Backend, worker, Prisma | Use `postgres:5432` inside Docker, Render-managed URL in production |
| `REDIS_URL` | Backend, worker | Use `redis:6379` inside Docker, Render-managed URL in production |
| `JWT_SECRET` | Backend | Use a long random value; rotating it logs users out |
| `GROQ_API_KEY` | Worker | Required for AI reviews |
| `GROQ_MODEL` | Worker | Defaults to `llama-3.3-70b-versatile` |
| `FRONTEND_URL` | Backend | CORS allowlist, for example `http://localhost:5173` locally |
| `VITE_API_URL` | Frontend production build | Render value should be `https://<backend-service>.onrender.com/api` |
| `BACKEND_HOST_PORT` | Docker Compose | Host port for backend container; use `4001` if local nodemon uses `4000` |

## Local Development

### Option A: Run Everything With Docker

Use this when you want the least host-machine setup.

```bash
docker compose up --build
```

Then apply the database migrations once:

```bash
docker compose exec backend npm run db:deploy
```

Local URLs:

| Service | URL |
| --- | --- |
| Frontend | `http://localhost:5173` |
| Backend API | `http://localhost:${BACKEND_HOST_PORT:-4000}` |
| PostgreSQL host port | `localhost:5435` |
| Redis host port | `localhost:6381` |

Inside Docker, services talk to each other with internal names:

- PostgreSQL: `postgres:5432`
- Redis: `redis:6379`
- Backend: `backend:4000`

### Option B: Run Infra in Docker, Apps Locally

Start only Postgres and Redis:

```bash
docker compose up -d postgres redis
```

When running backend or worker directly on your machine, use host ports:

```bash
DATABASE_URL="postgresql://kritique:kritique_secret@localhost:5435/kritique_db"
REDIS_URL="redis://localhost:6381"
```

For Windows PowerShell:

```powershell
$env:DATABASE_URL="postgresql://kritique:kritique_secret@localhost:5435/kritique_db"
$env:REDIS_URL="redis://localhost:6381"
```

Backend:

```bash
cd backend
npm install
npm run db:generate
npm run db:deploy
npm run dev
```

Worker:

```bash
cd worker
npm install
npm run db:generate
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Production Deployment on Render

The repo includes `render.yaml` for a Blueprint deployment:

- `kritique-backend`: Node web service
- `kritique-worker`: background worker
- `kritique-frontend`: static site
- `kritique-db`: managed PostgreSQL
- `kritique-redis`: managed Key Value instance

Render variables to provide during Blueprint setup:

| Service | Variable | Value |
| --- | --- | --- |
| Backend | `FRONTEND_URL` | Your deployed frontend URL |
| Worker | `GROQ_API_KEY` | Your Groq API key |
| Worker | `GROQ_MODEL` | Optional override, default is `llama-3.3-70b-versatile` |
| Frontend | `VITE_API_URL` | `https://<backend-service>.onrender.com/api` |

The backend service runs:

```bash
npm run db:generate
npm run db:deploy
npm start
```

`db:deploy` uses Prisma migrations from `backend/src/prisma/migrations`. Keep those migrations committed before every production deploy.

The worker is a background worker. Do not create it as a web service; it intentionally does not bind to an HTTP port.

GitHub Actions runs tests and Docker build checks; it does not deploy. To deploy, connect the repository to Render as a Blueprint and configure the unsynced variables above. Configure Render's automatic-deploy behavior separately from the CI workflow.

## Deployment Smoke Test

After every deploy:

```bash
curl https://<backend-service>.onrender.com/health
curl https://<backend-service>.onrender.com/health/ready
```

Then test the full user flow:

1. Open the frontend URL.
2. Register or log in.
3. Submit a small code review.
4. Confirm the review status moves from `PENDING` to `PROCESSING` to `COMPLETED`.
5. Confirm streaming output appears live.
6. Refresh the review page and confirm the saved result still appears.
7. Check backend logs for API and SSE activity.
8. Check worker logs for Groq streaming and completion.

If a review finishes before its browser stream connects, the stream endpoint replays the saved result.

## Verification Commands

Run these before deploying:

```bash
cd backend
npm test
npm run db:generate

cd ../worker
npm test
npm run db:generate

cd ../frontend
npm run build

cd ..
docker compose config --services
```

## API Summary

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Login |
| `GET` | `/api/auth/me` | Current user |
| `POST` | `/api/reviews` | Queue a review |
| `GET` | `/api/reviews` | List current user's reviews |
| `GET` | `/api/reviews/:id` | Fetch one review |
| `GET` | `/api/stream/:reviewId?token=<jwt>` | Stream review tokens with SSE |
| `GET` | `/health` | Liveness |
| `GET` | `/health/ready` | Dependency readiness |
| `GET` | `/health/metrics` | App metrics |

## Supported Languages

The backend currently accepts:

```text
javascript, typescript, python, java, go, rust, cpp, c, csharp, ruby, php, swift
```

The frontend language picker is kept in sync with this list.

## Project Structure

```text
kritique/
  backend/
    src/
      index.js
      routes/
      middleware/
      lib/
      logger/
      circuit-breaker/
      prisma/
        schema.prisma
        migrations/
    tests/
  worker/
    src/
      index.js
      prompt.js
    prisma/
      schema.prisma
    tests/
  frontend/
    src/
      App.jsx
      hooks/
      lib/
      pages/
  docker-compose.yml
  render.yaml
  .env.example
```

## Production Notes

- Backend and worker must share the same `DATABASE_URL`, `REDIS_URL`, and Prisma schema.
- Frontend production builds must use the deployed backend URL via `VITE_API_URL`.
- Docker Compose uses `BACKEND_HOST_PORT` only for the host mapping; the backend container always listens on `4000`.
- Redis and Postgres hostnames differ by environment: Docker uses service names, local host apps use mapped localhost ports, and Render injects managed connection strings.
- Worker concurrency is currently `1` to keep AI provider usage predictable.
- Rate limiting is enabled globally and more strictly on review creation.

## License

MIT
