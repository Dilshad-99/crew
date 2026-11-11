# Crew

Race-proof team-formation tool for hackathons (Hack4Hack PS1).

MERN stack, JavaScript only:

- **Backend** (`server/`): Node.js + Express + MongoDB (Mongoose). Deployed on Render (free tier).
- **Frontend** (`client/`): React (Vite). Deployed on Vercel.

## Deployed URLs

- Frontend: <https://crew-beta-one.vercel.app> (Vercel)
- Backend API: <https://crew-api-3zom.onrender.com/api/health> (Render)

## Features (night 1 scope)

- Register / login with bcrypt-hashed passwords and JWT access tokens
  (`Authorization: Bearer <token>`, role in the token payload) — auth shape reused
  from the [Pawn Shop Management System](https://github.com/Dilshad-99/Vintage_Teasure).
- Create a team (caller becomes leader + first member) and list teams per hackathon.
- **One team per person per hackathon is enforced by the database**: `Team` has a
  unique multikey compound index on `{ hackathonId, members }`, so MongoDB rejects
  the same user in two teams of one hackathon even under concurrent requests
  (the route returns `409`). Application code does not have to be trusted for this.
- Audit log entry written on team creation.

Out of scope tonight (tomorrow): join flow with idempotency keys, invite codes,
realtime board, skill suggestions, tests.

## API

| Method | Path                  | Auth | Description                                    |
| ------ | --------------------- | ---- | ---------------------------------------------- |
| GET    | `/api/health`         | –    | Service + DB health                            |
| POST   | `/api/auth/register`  | –    | `{ name, email, password, skills?, timezone? }` |
| POST   | `/api/auth/login`     | –    | `{ email, password }` → `{ token, userDetails }` |
| POST   | `/api/teams`          | JWT  | `{ hackathonId, name }` → creates team (caller = leader + first member) |
| GET    | `/api/teams?hackathonId=...` | – | Lists teams for a hackathon |
| GET    | `/api/hackathons`     | –    | Lists hackathons (a default one is seeded at boot) |

All inputs are validated; invalid input returns `400` with a clear message.

## Run locally

Prerequisites: Node.js 18+, MongoDB running on `localhost:27017`.

### 1. Backend

```bash
cd server
npm install
cp .env.example .env    # then edit values
npm run dev
```

Server runs on `http://localhost:3001` (set by `PORT`).

`server/.env`:

| Variable         | Meaning                                    |
| ---------------- | ------------------------------------------ |
| `PORT`           | Listen port (default 3001)                 |
| `MONGODB_URI`    | Mongo connection string                    |
| `JWT_SECRET_KEY` | Secret used to sign/verify JWTs            |
| `CORS_ORIGIN`    | Comma-separated allowed origins (dev: empty → `http://localhost:5173`) |

### 2. Frontend

```bash
cd client
npm install
cp .env.example .env
npm run dev
```

App runs on `http://localhost:5173`.

`client/.env`:

| Variable        | Meaning                       |
| --------------- | ----------------------------- |
| `VITE_API_URL`  | Backend base URL (default `http://localhost:3001`) |

## Deployment (from this same GitHub repo)

- **Render (backend)** — Web Service, root directory `server`,
  build `npm install`, start `npm start`, env vars: `MONGODB_URI`
  (MongoDB Atlas free tier), `JWT_SECRET_KEY`, `CORS_ORIGIN` = Vercel URL.
- **Vercel (frontend)** — project root `client` (Vite preset),
  env var `VITE_API_URL` = Render URL.

## Repo layout

```
server/
  src/
    app.js                 Express app + CORS + routes
    server.js              Entry: DB connect, seed, listen
    config/db.js           Mongoose connection from MONGODB_URI
    middleware/auth.js     requireAuth (Bearer JWT) + requireRole
    models/                User, Hackathon, Team, JoinRequest, AuditLog
    controllers/           auth (pawn-shop JWT shape), teams, hackathons
    routes/                auth, teams, hackathons
    utils/validate.js     Input validation → clear 400 errors
client/
  src/
    api.js                Axios instance + Bearer/401 interceptors
    context/AuthContext   Session in localStorage
    pages/                Login, Register, TeamList, CreateTeam
```
