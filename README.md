# Distributor Orders

A local ordering, inventory, credit approval and loyalty application. Distributors
place/cancel their own orders; Sales Managers approve/reject, dispatch and deliver.
Status history and reliable outbound ERP delivery are included. No login is required.

## Run locally — five commands

Prerequisites: Node.js **22.14+**, npm, and free ports **5173**, **5001**, **5050**.
Start from the repository root. Run commands 3–5 in separate terminals:

```sh
npm install
npm run setup
npm run erp:demo -w backend
ERP_URL=http://127.0.0.1:5050/events npm run dev:backend
npm run dev:frontend
```

Open **http://localhost:5173**; API health: **http://localhost:5001/api/health**.
Setup creates `backend/.env` if absent, generates Prisma Client, prepares SQLite,
applies the migration and seeds data. The example defaults match the Vite proxy.
Port 5001 avoids the macOS AirTunes conflict. A project-local Node runtime is included,
but a supported Node installation is required for the initial dependency install.

The receiver prints status events. `ERP_URL` is configurable in `backend/.env` or
through the environment. If unset, events remain queued. No ERP account is needed.

## Demo actors and scenarios

| Actor ID | Role/tier on fresh seed | Credit limit | Recent points |
| --- | --- | ---: | ---: |
| bronze | Distributor / Bronze | 5,000 | 0 |
| silver | Distributor / Silver | 20,000 | 4,900 |
| gold | Distributor / Gold | 100,000 | 5,000 |
| manager | Sales Manager | — | — |

Eight products include unavailable Coffee (`SKU-007`) and one-unit Spice Box
(`SKU-008`). Historical delivered orders establish tiers without consuming credit.
Seed upserts preserve existing orders/stock; repeating setup does not reset a demo.

On a fresh seed, choose Silver and order 10 Rice Bags (`SKU-001`, unit price 1,250): subtotal 12,500,
3% discount, total 12,125, 121 awarded points, new balance 5,021/Gold. The next order
uses 6%. Choose Bronze and order five Rice Bags to demonstrate Pending Approval.
Use Catalogue & cart to place orders and My Orders to inspect or cancel them.
Switch to manager for Pending Approvals and Approve/Reject; use All orders for Dispatch/Deliver.
Order Details groups Order Summary, Items, Financial Summary and Status History.
Cart estimates are provisional; placement results show the final total and status. Eligible orders
can be cancelled by their owning distributor, reversing confirmation points.

## API and verification

Actor-scoped requests use `x-user-id`. `POST /api/orders` accepts
`{"items":[{"productId":"SKU-001","quantity":1}]}`. Optional `Idempotency-Key`
is scoped to distributor; a replay returns the same order even with a different body.
The browser does not currently send this optional header; backend tests demonstrate it.

```sh
npm run test -w backend
npm run typecheck
npm run build
```

Tests migrate isolated temporary databases and leave demo data untouched. They include
independent-connection concurrent duplicate requests and final-unit competition.
Products, order lists/details, distributor profile and five lifecycle action endpoints
are implemented; financial values in the API are integer minor units.

For retry demos, restart the receiver with `ERP_DEMO_MODE=5xx` or `timeout` before
`npm run erp:demo -w backend`; request timestamps show backoff. Restart in default
success mode to drain retries. `4xx` demonstrates parked permanent failure. Inspect
`ErpOutbox` using `npm exec -w backend -- prisma studio` to view attempts/errors/due dates.
Delivery is at least once; stable event IDs support receiver deduplication. Imported
seed history and events predating the integration are not replayed to ERP.

Schema and constraints are in Prisma/migrations and `schema.dbml`. See `NOTES.md`
for decisions and limitations. Do not commit `.env`, runtime databases, `dist` or
`node_modules`. The final screenshots referenced by `pitch.md` are included in `docs/screenshots/`: `distributor-cart.png`, `manager-approvals.png` and `order-history.png`.
