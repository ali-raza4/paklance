# SETUP.md

## Prerequisites
- **Node.js** (v22 or later recommended)
- **npm** (v10+)
- **PostgreSQL** instance (Neon recommended) – connection string placed in `.env` as `DATABASE_URL`
- **Docker** (optional, for running a local PostgreSQL container)

## Getting the Code
```bash
git clone https://github.com/syeda-ashna/paklance.git
cd paklance
```

## Install Dependencies
```bash
npm ci
```

## Configure Environment Variables
Copy the template and fill in real values:
```bash
cp .env.example .env
# edit .env and set DATABASE_URL, JWT_SECRET, etc.
```
**Never** commit the resulting `.env` file.

## Database Setup
```bash
# Apply existing migrations
npx prisma migrate deploy
# (or) generate the Prisma client
npx prisma generate
# Seed optional data
node prisma/seed.ts   # run only if you need seed data
```

## Run the Application
```bash
# Development mode (watch files)
npm run start:dev
# Production mode
npm run build && npm run start:prod
```
The server will listen on `PORT` (default 3000).

## Running Tests
```bash
npm test            # unit tests
npm run test:e2e    # end‑to‑end tests
```
All tests should pass (see `TEST_REPORT.md`).

---
*For any additional tooling (Docker, VSCode extensions, etc.) refer to the project's `README.md`.*
