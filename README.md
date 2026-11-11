# Crew

Race-proof team-formation tool for hackathons (Hack4Hack PS1).

MERN stack, JavaScript only:

- **Backend** (`server/`): Node.js + Express + MongoDB (Mongoose). Deployed on Render (free tier).
- **Frontend** (`client/`): React (Vite). Deployed on Vercel.

## Deployed URLs

- Frontend: <https://crew-beta-one.vercel.app> (Vercel)
- Backend API: <https://crew-api-3zom.onrender.com/api/health> (Render)

## Features (nights 1–2 scope)

- Register / login with bcrypt-hashed passwords and JWT access tokens
  (`Authorization: Bearer <token>`, role in the token payload) — auth shape reused
  from the [Pawn Shop Management System](https://github.com/Dilshad-99/Vintage_Teasure).
- Create a team (caller becomes leader + first member) and list teams per hackathon.
- **One team per person per hackathon is enforced by the database**: `Team` has a
  unique multikey compound index on `{ hackathonId, members }`, so MongoDB rejects
  the same user in two teams of one hackathon even under concurrent requests
  (the route returns `409`). Application code does not have to be trusted for this.
- **Race-proof joins by invite code**: joining is ONE atomic
  `findOneAndUpdate` — the filter checks `memberCount < maxTeamSize` (capacity is
  denormalized on the team), code validity, expiry and not-already-member, while
  the same operation does `$inc: { memberCount: 1 }` + `$addToSet: { members }`.
  If the update matches nothing, the seat is gone and the join returns `409`.
  There is no read-the-count-then-write window anywhere.
- **Idempotency keys on every join/create**: the client sends a UUID; a unique
  index on the `Idempotency` collection makes the first request the only one that
  executes — retries (double-click, flaky network) replay the original response,
  parallel duplicates get `409`, and failed attempts free the key for a real retry.
- Join requests the leader approves; only the leader can accept/decline/remove
  (second pending request per user per team is blocked by a partial unique index).
- Leader leaving passes leadership to the oldest remaining member (computed at
  write time in one pipeline update); the last member leaving deletes the team.
- Every team change (join, accept, decline, remove, leader change, delete, leave)
  writes an `AuditLog` row.
- Jest + Supertest suite, including **50 parallel joins for the last seat:
  exactly one wins, 49 get clean 409s** (`cd server && npm test`).

## API

| Method | Path                  | Auth | Description                                    |
| ------ | --------------------- | ---- | ---------------------------------------------- |
| GET    | `/api/health`         | –    | Service + DB health                            |
| POST   | `/api/auth/register`  | –    | `{ name, email, password, skills?, timezone? }` |
| POST   | `/api/auth/login`     | –    | `{ email, password }` → `{ token, userDetails }` |
| POST   | `/api/teams`          | JWT  | `{ hackathonId, name, idempotencyKey }` → creates team (caller = leader + first member) |
| GET    | `/api/teams?hackathonId=...` | – | Lists teams for a hackathon (invite codes are never exposed here) |
| POST   | `/api/teams/join`     | JWT  | `{ inviteCode, idempotencyKey }` → atomic seat-grab (`409` if full / already in a team) |
| POST   | `/api/teams/:teamId/requests` | JWT | `{ idempotencyKey? }` → ask the leader to join |
| GET    | `/api/teams/:teamId/requests` | JWT (leader) | List join requests |
| PATCH  | `/api/teams/:teamId/requests/:requestId/accept` | JWT (leader) | Accept (atomic seat-grab) |
| PATCH  | `/api/teams/:teamId/requests/:requestId/decline` | JWT (leader) | Decline |
| DELETE | `/api/teams/:teamId/members/:memberId` | JWT (leader) | Remove a member |
| POST   | `/api/teams/:teamId/leave` | JWT | Leave (leader leaving passes leadership / last member deletes team) |
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

Run the race-proofing test suite (needs MongoDB on `localhost:27017`):

```bash
npm test
```

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

```bash
server/
  src/
    app.js                 Express app + CORS + routes
    server.js              Entry: DB connect, seed, listen
    config/db.js           Mongoose connection from MONGODB_URI
    middleware/auth.js     requireAuth (Bearer JWT) + requireRole
    models/                User, Hackathon, Team, JoinRequest, AuditLog, Idempotency
    controllers/           auth (pawn-shop JWT shape), teams, joins (race-proof)
    routes/                auth, teams, hackathons
    utils/
      validate.js          Input validation → clear 400 errors
      idempotency.js       One execution per key (unique-index arbiter)
  tests/join.test.js       Jest + Supertest (50-parallel race is the gate)
client/
  src/
    api.js                Axios instance + Bearer/401 interceptors
    context/AuthContext   Session in localStorage
    pages/                Login, Register, TeamList, CreateTeam
```
