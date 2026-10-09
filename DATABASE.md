# DATABASE.md

## Database Overview
Paklance uses **PostgreSQL** (hosted on Neon) accessed via **Prisma ORM**. The schema is defined in `prisma/schema.prisma` and evolves through migration files located in `prisma/migrations/`.

### Key Models
| Model | Description |
|-------|-------------|
| `User` | Stores authentication data (`email`, `passwordHash`), role (`ADMIN`, `CLIENT`, `SPECIALIST`), verification status, and relations to profiles, wallet, etc. |
| `Profile` | User biography, skills, portfolio items. |
| `Job` | Posted by a client; contains title, description, budget, required skills. |
| `Proposal` | Submitted by a specialist; includes price, timeline, cover letter. |
| `Contract` | Links a client and specialist; owns multiple `Milestone`s. |
| `Milestone` | Part of a contract; holds amount, status, due date, and escrow payment reference. |
| `Payment` | Represents a transaction with a provider (JazzCash, EasyPaisa, etc.); stores status, provider reference, amount. |
| `Wallet` | Holds a user’s balance and locked escrow amount. |
| `Message` | Real‑time chat entries between participants. |
| `WithdrawalRequest` | User‑initiated request to move funds from wallet to external account. |
| `PushSubscription` | Web‑push subscription data for notifications. |
| `Notification` | System‑generated alerts (payment status, new proposal, etc.). |
| `Dispute` | Handles contract disputes, linked to `Contract` and `Message`. |

### Migrations
The history of schema changes is stored in `prisma/migrations/`. Each folder is timestamped and contains the SQL required to evolve the database safely. Running `npx prisma migrate deploy` applies any pending migrations.

### Prisma Client
Generated automatically (`node_modules/.prisma/client`). It is injected via NestJS’s `PrismaService` and used throughout the code base for type‑safe DB access.

### Backup & Restore (Production)
- **Neon** provides automated daily snapshots. Use the Neon dashboard to create manual backups before major changes.
- To restore, spin up a new PostgreSQL instance and run `npx prisma db push` after setting `DATABASE_URL` to the restored instance.

---
*No secret values are stored in this repository; all credentials live in environment variables.*
