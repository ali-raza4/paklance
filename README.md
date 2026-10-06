# Paklance: website + backend

This is the finalised Paklance website (everything approved in the review build, Tasks 1–14) running on a real backend with a database.

- **Backend:** Node.js 22 + Express, with SQLite for local use and PostgreSQL for production. Both run the same code.
- **Frontend:** the approved design, unchanged, in `public/`. It reads and writes real data through the API.
- **Covers:** email and Google sign-up, 6-digit email verification, login, password reset, the profile completion tracker, profile pages with photo, video introduction (upload or link) and star ratings, free recording seminars, jobs with the PKR price range, applications, hiring, contracts and milestones, SafePay escrow funding, reviews after a finished contract, wallet, payout methods, withdrawals, the Resolution Centre, notifications, Paklance Match™, Global Hiring requirements, the blog (key takeaways, checklists, a matching next-step button, "Was this helpful?" and SEO), the newsletter and admin tools.
- **Tested:** 19 automated API tests pass on both SQLite and PostgreSQL. A browser walkthrough of the served site passed (sign up, photo and video upload, seminars, blog feedback, reviewing a finished contract, ratings on profiles, phone width), with no console or security-policy errors.

---

## 1. Run it on your computer

1. Install **Node.js 22 or newer** from https://nodejs.org (the LTS version).
2. Unzip this folder and open a terminal inside it.
3. Install and start:

   ```bash
   npm install
   cp .env.example .env        # Windows: copy .env.example .env
   npm start
   ```

4. Open **http://localhost:3000**.

On first start, the server creates the database (`data/paklance.sqlite`) and adds the sample content. No email server is needed locally: verification codes and reset links are printed in the terminal window.

**Demo accounts** (local only; they are never created in production):

| Email | Password | What you can try |
|---|---|---|
| `demo@paklance.com` | `Paklance123` | Specialist: contract PK-10001, a finished contract with a 5-star review from each side, wallet balance PKR 45,000, submit milestone 2, withdraw, apply to a job, add a photo and video on the dashboard |
| `client@paklance.com` | `Paklance123` | Client: approve milestone 2, fund milestone 3 by bank transfer (fee shown), post jobs through the API; review the specialist when a contract finishes |

Confirm a bank transfer the way the finance team would:

```bash
npm run admin -- payments                  # list transfers waiting for confirmation
npm run admin -- confirm-payment PLF-XXXXXX
```

To start again from a clean database, stop the server, delete the `data` folder and run `npm start`.

---

## 2. Going live checklist

| # | What | Where |
|---|---|---|
| 1 | Use PostgreSQL: set `DATABASE_URL` (and `DATABASE_SSL=true` for most hosts) | `.env` |
| 2 | Set `NODE_ENV=production`, `APP_URL=https://www.paklance.com` and a long random `SESSION_SECRET` | `.env` |
| 3 | Serve over **HTTPS**. Session cookies are Secure-only in production. | hosting / Nginx |
| 4 | Email: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (SendGrid, Amazon SES, Mailgun, Zoho, …) | `.env` |
| 5 | Google sign-in: create an OAuth client (Web). Add the site under *Authorised JavaScript origins*, then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. | Google Cloud Console → `.env` |
| 6 | SafePay escrow bank account shown to clients: `ESCROW_ACCOUNT_TITLE`, `ESCROW_BANK_NAME`, `ESCROW_IBAN`, `ESCROW_RAAST_ID` | `.env` |
| 7 | **Real fees.** 3% client and 10% specialist are placeholders. Change `CLIENT_FEE_PERCENT` / `SPECIALIST_FEE_PERCENT` **and** the Pricing page (`public/index.html`, section "PRICING"), so they always match. | `.env` + `index.html` |
| 8 | Give the ops team admin rights: `ADMIN_EMAILS=ops@paklance.com` (or `npm run admin -- make-admin <email>`) | `.env` |
| 9 | Remove the sample jobs, specialists and demo articles once real ones exist: `npm run admin -- clear-samples` | terminal |
| 10 | Terms, Privacy and Marketplace policy pages. The footer links currently say "coming soon". | content |
| 11 | Payment custody, KYC and settlement must go through your regulated banking partner before taking real money (see the Trust Centre note on the site) | legal / bank |
| 12 | **Uploads:** photos and videos are saved under `UPLOAD_DIR` (default `data/uploads`). Use a persistent disk or volume, back it up, and allow uploads of at least `VIDEO_MAX_MB` in your web server (Nginx: `client_max_body_size 110m;`). | hosting |
| 13 | **Seminars:** real dates replace the three sample dates. Add them with `npm run admin -- add-seminar …` (see below) and put the Zoom/Meet link or the venue address in *details*: it is only emailed to people who register. | terminal |

Docker option: `docker compose up --build` runs the app and PostgreSQL together. Change the passwords marked "change-me" first.

---

## 3. How money moves (SafePay)

```
Client funds a milestone ── bank transfer / Raast ──►  milestone "funding_pending"  (PLF-XXXXXX reference emailed)
Finance confirms the money arrived (CLI or admin API) ──►  "funded"  (shown as protected)
Specialist submits work ──►  "submitted"   ⇄  client requests changes ──►  "changes_requested"
Client approves ──►  "released": specialist wallet +amount, −specialist fee
Specialist withdraws ──►  withdrawal "requested" (amount locked) ──► finance pays via 1Link ──► "paid"   (or "rejected" → money returned)
Either side opens a case ──►  milestone "disputed" (frozen) ──► admin resolves: release / refund / dismiss
```

- **JazzCash and Easypaisa stay "coming soon".** The API refuses them with `409 GATEWAY_COMING_SOON`. There is no switch that fakes a successful payment.
- **No simulated success.** A bank transfer only counts once someone confirms the money reached the escrow account. A bank webhook can replace the manual confirmation later; call `confirmPayment()` in `src/services/money.js`.
- Amounts are whole PKR. The wallet balance is the sum of ledger entries, so every rupee has a record.

---

## 4. API reference

Base path `/api`. Requests and responses are JSON. The session is an HttpOnly cookie, so the browser sends it automatically (`credentials: 'include'`).

**Errors** always look like this:

```json
{ "code": "VALIDATION_ERROR", "message": "Plain-English message", "fields": { "email": "…" } }
```

Codes: `VALIDATION_ERROR`, `UNAUTHENTICATED` (401), `FORBIDDEN` / `PROFILE_INCOMPLETE` / `OWN_JOB` (403), `NOT_FOUND` (404), `EMAIL_TAKEN`, `ALREADY_APPLIED`, `INVALID_STATE`, `INSUFFICIENT_BALANCE`, `SAMPLE_CONTENT`, `GATEWAY_COMING_SOON` (409), `RATE_LIMITED` (429), `GOOGLE_UNAVAILABLE` (503), and the auth codes below.

### Sign up / log in (the contract used by the sign-up screens)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/me` | – | `{ user }`, or `{ user: null }` when signed out |
| POST | `/auth/signup` | `{ email, password }` | `201 { pendingVerification: true }`; emails a 6-digit code |
| POST | `/auth/verify-email` | `{ email, code }` | `{ user }` and signs in |
| POST | `/auth/resend-code` | `{ email }` | `{ ok: true }` (30 s cooldown) |
| POST | `/auth/login` | `{ email, password }` | `{ user }`, or `{ pendingVerification: true }` for an unverified sign-up |
| POST | `/auth/google` | `{ code }` (pop-up) or `{ credential }` (ID token) | `{ user }` |
| POST | `/auth/forgot-password` | `{ email }` | always `{ ok: true }` |
| POST | `/auth/reset-password` | `{ token, password }` | `{ user }` and signs in; other devices are signed out |
| PATCH | `/me` | `{ fullName }` or `{ skills: [...] }` | `{ user }` |
| POST | `/auth/logout` | – | `{ ok: true }` |

`user` = `{ id, email, fullName | null, skills: [], emailVerified, provider: 'email' | 'google' }`

Auth error codes: `EMAIL_TAKEN`, `INVALID_CODE`, `CODE_EXPIRED`, `NOT_FOUND`, `RATE_LIMITED`, `INVALID_CREDENTIALS`, `USE_GOOGLE`, `INVALID_NAME`, `INVALID_SKILLS`, `INVALID_TOKEN`, `INVALID_GOOGLE_TOKEN`, `GOOGLE_EMAIL_UNVERIFIED`, `UNAUTHENTICATED`.

Rules (the same in the frontend):

- **Password:** 8+ characters, with a letter and a number.
- **Name:** letters, 2–60 characters.
- **Skills:** 1–15 skills, each 2–40 characters.
- **Email codes:** expire after 15 minutes and allow 5 attempts. Each code is tied to the browser that requested it, so nobody can register someone else's email.
- **Login limits:** 10 failed logins per email per 15 minutes, plus per-IP limits.

### Marketplace

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/jobs` | anyone | `?q&category&minBudget&maxBudget&verified&safepay&sort=new\|high\|low&page&limit` (the Find Work price range uses `minBudget`/`maxBudget`) |
| GET | `/jobs/:id` | anyone | adds `isOwner` and `hasApplied` when signed in |
| POST | `/jobs` | onboarded user | `{ title, city, category, budget, skills, description, milestones:[{title,amount}], type?, safepay?, clientLabel? }`. Milestones must add up to the budget. |
| GET | `/jobs/mine` | signed in | my posted jobs, with proposal counts |
| PATCH | `/jobs/:id` | owner | `{ status: 'open' \| 'closed' }` |
| POST | `/jobs/:id/proposals` | onboarded user | `{ coverLetter?, bidAmount? }`. Sample jobs return `SAMPLE_CONTENT`. |
| GET | `/jobs/:id/proposals` | owner | applicants with name, skills and profile |
| GET | `/proposals/mine` | signed in | my applications |
| POST | `/proposals/:id/hire` | job owner | creates a contract with the job's milestones (scaled to the bid) |
| POST | `/proposals/:id/decline` · `/withdraw` | owner · applicant | |
| GET | `/talent` | anyone | `?q&category&available=now&maxRate&page&limit` |
| GET | `/talent/:id` | anyone | `{ talent, page }`. `page` (real profiles) has everything the profile page shows: `photo`, `video`, `memberSince`, `items` (services, portfolio, experience, education, certificates), `rating: { freelancer: [n5…n1], client: [n5…n1] }`, `reviews`, `seller`, `buyer`, `delivery`. The list also gives `rating: { avg, count }` and `photo` per card. |
| GET · PUT | `/me/profile` | onboarded user | my public profile `{ headline, city, category, hourlyRate, availability, bio, published? }` (the dashboard tracker's "Update introduction"). Name and skills come from the account. GET also returns `items`, `video`, and my `rating`, `reviews`, `seller`, `buyer` and `delivery` for my own profile page. |
| POST | `/me/profile/items` | onboarded user | add a profile section for the dashboard's profile tracker: `{ kind, … }` → `{ item }`. `portfolio { title, url?, description? }` · `services { title, amount, description? }` (starting price, PKR) · `education { title, subtitle, startYear, endYear }` · `experience { title, subtitle, startYear, endYear?, description? }` (no `endYear` = current role) · `certificates { title, subtitle, endYear, url? }`. Links must be http(s); up to 20 per section. |
| DELETE | `/me/profile/items/:id` | owner | remove one of my profile sections |
| POST · DELETE | `/me/photo` | signed in | multipart field `photo` (JPG, PNG or WebP, up to 5 MB; the type is checked from the file itself) → `{ user }` with `user.photo` |
| PUT | `/me/profile/video` | onboarded user | `{ url }` a YouTube, Vimeo, Loom or Google Drive link; `url: null` removes the video → `{ video }` |
| POST | `/me/profile/video/upload` | onboarded user | multipart `video` (MP4, MOV or WebM, up to 100 MB) + `duration` in seconds (10–180, measured by the browser) → `{ video: { kind: 'upload', url, name, size, type, duration } }`. Upload progress works with XHR. |
| GET | `/seminars` | anyone | upcoming free seminars on recording a video introduction: `{ id, title, mode, place, about, startsAt, minutes, seats, taken, seatsLeft, sample, registered }` |
| POST · DELETE | `/seminars/:id/register` | signed in | take or give up a place → `{ seminar }`. Emails the details. `FULL` (409) when no seats are left; sample dates return `SAMPLE_CONTENT`. |
| POST | `/match-requests` | anyone | `{ role, engagement, seniority, timezone, budgetModel, skills }` → `{ shortlist:[{ …, fit, matchedSkills }] }` |
| POST · GET | `/global-requests` | signed in | `{ role, engagement, timezone, duration, startWindow, skills, protections:{nda,ip,replacement} }` |

### Contracts, SafePay, wallet, cases

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/contracts` · `/contracts/:id` | parties | totals `{ value, released, protected }`, milestones, pending transfers |
| POST | `/contracts/:id/milestones/:mid/fund` | client | `{ method: 'bank_transfer' \| 'raast' }` → `{ payment:{reference, amount, fee, total}, instructions }` |
| POST | `…/cancel-funding` | client | while the transfer is still pending |
| POST | `…/submit` | specialist | `{ note? }` |
| POST | `…/request-changes` | client | `{ note }` |
| POST | `…/approve` | client | releases to the specialist's wallet; the contract is `completed` when every milestone is released |
| POST | `/contracts/:id/review` | either side | `{ stars: 1–5, text }` once the contract is completed. The client's review appears on the specialist's profile ("as a freelancer"), the specialist's on the client's ("as a client"). One each; `ALREADY_REVIEWED` after that. Every contract includes `review: { canReview, mine, theirs }`. |
| GET | `/wallet` | signed in | `{ available, locked, totalEarned, entries, withdrawals }` |
| GET · POST | `/wallet/payout-methods` | signed in | `{ channel: 'bank' \| 'raast', accountTitle, accountNumber, bankName?, isDefault? }`. Accepts PK IBAN, 8–20 digit account numbers or Raast mobile numbers. Only the last 4 digits are ever returned. |
| POST · DELETE | `/wallet/payout-methods/:id/default` · `/wallet/payout-methods/:id` | owner | |
| GET · POST | `/wallet/withdrawals` | signed in | `{ amount, payoutMethodId }` or `{ amount, channel, accountTitle, accountNumber }` |
| POST · GET | `/disputes` · `/disputes/:id` | parties | `{ contractId, milestoneId?, issue, description }` |
| GET | `/notifications` | signed in | `{ notifications, unread }` |
| POST | `/notifications/read-all` · `/notifications/:id/read` | signed in | |
| GET | `/dashboard` | signed in | counts, wallet, jobs matching my skills |

### Site, blog, newsletter

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{ ok: true }` for uptime checks |
| GET | `/config` | Google client id, fees, payment methods (JazzCash/Easypaisa `coming_soon`) |
| GET | `/blog/categories` | |
| GET | `/blog/articles` | `?category&q&page&limit&full=1`. Same article shape as the frontend: `{ slug, title, excerpt, category, tags, date, updated?, featured?, popular?, demo, body? }` |
| GET | `/blog/articles/:slug` | `{ article, related }`. Articles can have `takeaways` (short points shown first), `cta` (the next-step button: `{ title, text, button, action: 'profile'\|'video'\|'signup' }` or `{ …, href: '#jobs' }`) and `checklist` blocks. |
| POST | `/blog/articles/:slug/feedback` | "Was this helpful?" `{ vote: 'yes'\|'no', comment? }`. One answer per reader per article (their latest counts); "Not really" is sent first, then again with the comment. |
| POST | `/newsletter/subscribe` | `{ email, source? }` → `{ ok: true }` plus a welcome email with an unsubscribe link |

Pages served by the backend:

- `/` (the site)
- `/blog` and `/blog/<slug>`: server-side title, description, Open Graph tags and JSON-LD, for Google and link previews
- `/pricing` and the other page paths
- `/reset-password`
- `/newsletter/unsubscribe`
- `/sitemap.xml` and `/robots.txt`

### Admin (role `admin` or listed in `ADMIN_EMAILS`)

| Method | Path | |
|---|---|---|
| GET | `/admin/overview` | counts |
| GET · POST | `/admin/payments?status=pending` · `/admin/payments/:id/confirm` `{ bankReference? }` · `/admin/payments/:id/cancel` | |
| GET · POST | `/admin/withdrawals` · `/admin/withdrawals/:id/status` `{ status: processing\|paid\|rejected, note? }` | |
| GET · POST | `/admin/disputes` · `/admin/disputes/:id/resolve` `{ outcome: release\|refund\|dismiss, note? }` | |
| POST | `/admin/users/:id/identity` `{ verified }` | sets "Verified" on the user's jobs and profile |
| GET · POST · PATCH · DELETE | `/admin/blog/articles[/:slug]` | publish and edit articles (same block format as the frontend, plus `takeaways` and `cta`) |
| GET | `/admin/blog/feedback` | "Was this helpful?" yes / no counts per article, with the latest comments |
| GET · POST · PATCH | `/admin/seminars[/:id]` | list, add `{ title, mode: 'Online'\|'In person', place, about, details?, startsAt, minutes, seats }`, change or cancel (`{ status: 'cancelled' }`) |
| GET | `/admin/seminars/:id/registrations` | names and emails of the people who registered |
| GET | `/admin/newsletter` | subscribers |

The same operations from the terminal: `npm run admin -- <command>`

| Command | What it does |
|---|---|
| `make-admin <email>` | Gives an account admin rights |
| `verify-identity <email> [false]` | Marks an account identity-verified (or unverified) |
| `payments` | Lists transfers waiting for confirmation |
| `confirm-payment <ref> [bankRef]` | Confirms a transfer arrived |
| `cancel-payment <ref>` | Cancels a pending transfer |
| `withdrawals` | Lists withdrawals to pay |
| `withdrawal <id> paid\|rejected\|processing [note]` | Updates a withdrawal |
| `disputes` | Lists open cases |
| `resolve-dispute <id> release\|refund\|dismiss [note]` | Resolves a case |
| `subscribers` | Lists newsletter subscribers |
| `seminars` | Lists seminars with how many people registered |
| `add-seminar "<title>" <Online\|In-person> "<place>" <startsAt> <minutes> <seats> "<about>" ["<details>"]` | Adds a seminar, e.g. `npm run admin -- add-seminar "Record your video on your phone" Online "Live on Zoom" 2026-10-10T19:00+05:00 60 100 "Light, sound and a simple script." "https://zoom.us/j/…"`. The sample dates disappear once a real one exists. |
| `seminar-registrations <id>` | Who registered |
| `cancel-seminar <id>` | Cancels a seminar (tell the people who registered) |
| `feedback` | "Was this helpful?" answers per article, with comments |
| `clear-samples` | Removes the sample jobs, specialists, demo articles, sample seminar dates and demo accounts |

---

## 5. Project structure

```
public/                 the website (served as-is)
  index.html            approved design; review panel removed
  assets/css/site.css   unchanged styles (+ the review form on finished contracts)
  assets/fonts/         Outfit and Figtree (served from this site, no Google Fonts)
  assets/js/anim.js     turns motion on unless the visitor prefers reduced motion
  assets/js/auth.js     sign-up / login, profile tracker, profile page, photo, video and seminars (real API mode)
  assets/js/blog.js     blog module (articles from the API)
  assets/js/site.js     pages, forms and modals, using the API
  reset-password.html   the page behind the reset email link
src/
  server.js             starts the app: runs migrations, seeds, listens
  app.js                security headers, CSRF protection, rate limits, uploads, routes
  config.js             all settings (from .env)
  routes/               auth, jobs, talent, media (photo, video), seminars, requests, contracts (and reviews),
                        disputes, wallet, notifications, blog (and feedback), site, admin
  services/money.js     every money movement (release, confirm, withdraw, resolve)
  services/profilePage.js  ratings, reviews and seller / buyer stats for profile pages
  lib/                  validation, emails, payments rules, security helpers, uploads, video links
  seed.js               sample content, demo accounts, sample seminar dates
migrations/             database schema (SQLite and PostgreSQL)
seeds/data/             sample jobs, specialists and blog articles (from the design)
scripts/admin.js        operations CLI
tests/api.test.js       end-to-end API tests (accounts, marketplace, money, blog, security)
tests/features.test.js  photo, video, seminars, reviews and ratings, blog takeaways / checklists / feedback
```

**Tests:** `npm test` uses an in-memory SQLite database. To test against Postgres:

```bash
DATABASE_URL=postgres://…/paklance_test npm test
```

The database name must end in `_test`, because the tests wipe it.

**Security built in:**

- bcrypt password hashes; session tokens stored only as hashes
- HttpOnly, SameSite=Lax cookies (Secure in production)
- same-origin checks on every change, with JSON-only bodies (CSRF protection)
- strict Content-Security-Policy, with no inline scripts
- rate limits; input validation on every field
- user-generated text is escaped before it's shown
- payout account numbers are masked in every response
- uploads: the file type is read from the file's first bytes, files get random names, only `/uploads/photos` and `/uploads/videos` are served, and uploads must carry the site's own Origin

---

## 6. What changed in the frontend (compared with the review build)

Nothing was redesigned. `public/` is built from the final review build (Tasks 1–14) with only what a live site needs:

1. **Review layer removed:** the "Review build" button and panel, and the dashed "Removed: …" notes.
2. **Proper page head:** doctype, charset, viewport, `<title>Paklance</title>` and the green logo as the tab icon. Scripts, styles and fonts moved into files so the strict Content-Security-Policy works (no inline scripts). The fonts (Outfit and Figtree) are served from `/assets/fonts/`.
3. **Real data:**
   - Jobs (with the PKR price range), specialists and blog articles come from the API.
   - "Sample" and "Demo Content" labels show only on sample items; sample specialist profiles keep their built-in sample reviews.
   - Real specialists get their own profile page from the API: photo, video introduction, services, portfolio, experience, education, certificates, star ratings and reviews (as a freelancer and as a client), seller and buyer stats and delivery record.
4. **Forms work:** the profile tracker, profile photo (crop and upload), video introduction (file upload with progress, or a link), seminar registration, Match, Global requirement, payout method, withdrawal, open a case, fund milestone (bank transfer instructions, with the fee shown before paying), newsletter and "Was this helpful?" all save to the backend. Signed-out users are asked to log in.
5. **Reviews:** when every milestone of a contract is released, the Contracts window shows a short form (1–5 stars and a few words) to each side. The review then appears on the other person's profile, and their stars on the specialist cards.
6. **Next-step buttons on articles** open the dashboard, the video introduction or sign-up; the others link to Jobs, Match or Pricing. The fee calculator uses the fees set on the server.
7. **Wording that said "preview"** now says "coming soon": Messages, Urdu version, footer links.
8. **Google sign-in** uses Google's own account pop-up.

If you open `public/index.html` straight from disk (no server), it behaves like the review build: sample data and preview sign-up.

---

## 7. Not built yet (the API is ready or easy to extend)

- **Screens that have endpoints but no page:** post a job, a proposal/apply form with cover letter and bid, "my jobs / proposals / contracts" lists, and an admin panel (the team uses the admin API or `npm run admin` for payments, withdrawals, cases, seminars and blog feedback).
- **Messages:** chat between client and specialist (no backend yet).
- **Evidence uploads** for Resolution Centre cases.
- **Cloud file storage:** photos and videos are stored on the server's disk. For several servers or a host without a persistent disk, move them to S3 or Cloudflare R2 by changing `src/lib/uploads.js` only.
- **Video processing:** uploaded videos are served as they are (no re-encoding or thumbnails). MP4 (H.264) plays everywhere; the length is measured by the visitor's browser and checked against the 10–180 second limit.
- **JazzCash / Easypaisa checkout:** once merchant onboarding is done, add the signed checkout plus a server-verified callback, which then calls `confirmPayment()`.
- **Urdu version**, and identity (KYC) checks through a provider.
- **Scaling to several servers:** move rate limits to Redis.

## 8. Using your existing backend instead

If the current Paklance backend uses another language, keep `public/` and implement the endpoints in section 4 with the same request and response shapes. The frontend only depends on those. The tests in `tests/api.test.js` describe the expected behaviour step by step.
