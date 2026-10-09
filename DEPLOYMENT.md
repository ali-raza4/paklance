# DEPLOYMENT.md

## Overview
Paklance is deployed on **Vercel** as a serverless NestJS application. Vercel pulls the repository from GitHub, installs dependencies, builds the project, and runs it as a Node.js serverless function (or a Vercel Edge Runtime). The database lives externally (Neon PostgreSQL).

## Prerequisites
- Access to the Vercel dashboard for the project.
- The GitHub repository must be connected to Vercel (already set up).
- All required environment variables must be defined in Vercel's **Environment Variables** settings (see `ENVIRONMENT VARIABLES` section in `README.md`).

## Deployment Steps
1. **Push to `main`/`master`**
   - Every commit to the default branch automatically triggers a Vercel deployment.
   - Vercel runs `npm ci`, `npm run build`, and starts the server with `npm run start:prod`.
2. **Review Deployment**
   - Vercel provides a preview URL for each deployment. Verify that the API endpoints respond as expected.
3. **Production Promotion**
   - Once a preview passes QA, promote it to Production by merging the commit into the default branch (Vercel will treat it as Production automatically).

## Environment Variables (Names Only)
Add the following variables in the Vercel dashboard (separate values for **Production** and **Preview** as needed):
```
DATABASE_URL
JWT_SECRET
CORS_ORIGIN
RESEND_API_KEY
RESEND_FROM
SENDGRID_API_KEY
BREVO_API_KEY
SMTP_HOST
SMTP_USER
SMTP_PASS
PORT   # optional; defaults to 3000
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```
These must be kept secret; never commit them.

## Scaling & Limits
- **Serverless Functions**: Vercel limits each function to 60 seconds execution time (configurable up to 300 seconds). Long‑running background jobs should be offloaded to external workers (e.g., a cron service or a separate server).
- **Database Connections**: Neon provides a limited number of concurrent connections. The Prisma client uses connection pooling; monitor connection usage via Neon console.

## Rollback
- Vercel retains previous deployments. To rollback, go to the **Deployments** tab, find the prior successful deployment, and click **Rollback**.

## Post‑Deployment Checks
- Verify that the `/health` endpoint (if implemented) returns `200`.
- Run a quick smoke test against the live API (e.g., `GET /jobs`).
- Ensure that email OTP delivery works in the new environment (test with a non‑admin account).

---
*All deployment actions are performed via Vercel; no manual server provisioning is required.*
