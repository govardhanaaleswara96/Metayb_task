# Architecture

React calls Express through Axios. ActorContext stores only the selected actor; pages use local state. SQLite/Prisma is authoritative. In `backend/src/services/orders.ts`, R1/R7 validate and reserve all stock atomically, R2 snapshots prices/discount, R3 checks outstanding credit, and R4 awards confirmation points. `lifecycle.ts` completes R1 releases/dispatch deductions and R4 manager confirmation. R5 reversal and tier refresh use `lifecycle.ts` and `loyalty.ts`. R6 is enforced by having no edit route in `app.ts`. R8 uses `integrations/orderEvents.ts` and append-only database triggers. That helper writes each live transition's outbox entry in the same transaction; `integrations/erp.ts` sends after commit. Frontend cart values are labelled estimates.

# Key decisions

1. SQLite with Prisma supports a local relational demonstration without an external database server; reject adding another database or deployment infrastructure.
2. Stock and lifecycle changes use one transaction with a write lock before reads; reject unprotected read-then-write checks. SQLite serializes writers; independent connections prove final-unit safety.
3. API services enforce business rules; reject trusting client prices, discounts or permissions. Integer minor units and half-up rounding avoid floating-point money drift.
4. ERP uses a transactional outbox; reject HTTP inside order transactions. Delivery is at least once, requiring receiver deduplication by stable event ID.
5. Idempotency keys are distributor-scoped; reject global keys that prevent different distributors using the same value. Replays return the original order, ignoring changed bodies, with fixed financial snapshots and current status/loyalty.

# Not implemented

No incomplete Section C requirement is identified; optional idempotency is demonstrated through API tests. The three final application screenshots are included in the pitch. Authentication and deployment are outside assessment scope.

# Known defects

No known failing tested business rule; visual browser inspection remains outstanding. The browser does not send optional idempotency keys. The 90-day cutoff is inclusive UTC; reversals offset original awards, so expired-award reversals do not reduce unrelated recent points. ERP has no supplied contract. Ordinary 4xx failures are parked for manual correction; imported/historical events are not backfilled. Seed reruns preserve data. Node 22 is required. Four previously reported Prisma CLI transitive dependency advisories and Vite's bundle-size advisory have not prevented execution. Git contains legitimate commits; periodic assessment history cannot be reconstructed honestly.

# AI tools

Codex assisted schema design, implementation, tests, debugging and documentation. A genuine problematic default was API port 5000: the browser screenshot showed a 403 from AirTunes. Health/header checks identified the conflict; backend configuration and frontend proxy were corrected to 5001.

The single most useful prompt was the initial design request, reproduced verbatim:

```text
Read the attached Full Stack Developer Practical Assessment completely. Treat the assessment document as the source of truth for requirements, business rules, workflows, seed data, deliverables, and evaluation criteria.

We will implement this project phase by phase. Do NOT build the complete application now.

## Locked Technology Stack

Frontend:

- React
- Vite
- TypeScript
- Material UI
- Axios
- React Context only for shared current-user/actor state
- useState for local component state
- No Redux

Backend:

- Node.js
- Express.js
- TypeScript

Database:

- SQLite
- Prisma ORM

Do NOT add:

- Authentication
- Redux
- Docker
- GraphQL
- Microservices
- Unnecessary libraries or architecture

Authentication is explicitly out of scope in the assessment. We will use seeded users and a simple actor/user switcher.

## Phase 0 Task

Before writing implementation code:

1. Propose a simple frontend/backend folder structure.
2. Design the Prisma relational schema required to satisfy the assessment.
3. Map business rules R1-R8 to the backend services/functions responsible for enforcing them.
4. List the REST API endpoints required by the assessment.
5. Identify database transaction boundaries, especially for:
   - order placement
   - inventory reservation/release
   - status transitions
   - loyalty points changes
6. Identify concurrency/race-condition risks, especially two orders attempting to reserve the final available unit.
7. Explain briefly how these three calculations will work:
   - available stock
   - available credit
   - trailing-90-day loyalty points/tier
8. Propose the implementation phases in priority order based on the assessment marking criteria.

Important:

- Business rules must be enforced server-side.
- Database/backend is the source of truth.
- Do not trust frontend values for price, stock, discount, total, credit, points or tier.
- Keep the architecture simple enough to implement quickly and explain during the oral walkthrough.
- Do not generate React pages or complete backend services yet.

Keep the response concise because AI token usage is limited.

Stop after Phase 0 and wait for approval before implementing anything.
```
