# NDS — CLAUDE.md

Trimmed copy of the `nepaldairy` app (C:\Users\bandh\nepaldairy), containing only these menus:

| Menu | Routes |
|---|---|
| Dashboard | `/dashboard` |
| Pricelist | `/pricelist` (+ `/next-sn`, `/suggest`, `/export.csv`, add/edit/delete) |
| Products ▾ | `/admin/products`, `/admin/rawmaterials`, `/admin/recipes`, `/admin/recipe-summary`, `/admin/recipe-detail`, `/admin/raw-material-receipt` |
| Setup ▾ | `/admin/setup` (App Setup), `/admin/nepalical` (Update Calendar), `/calendar` (View Calendar) |
| Users | `/admin/users` (admin) or `/profile` (others) |

Also kept: `/login`, `/logout`, `/profile`, and the calendar APIs (`/api/adtobs`, `/api/bstoad`, `/api/nepalical`, `/api/calendar-notes`).

Removed from the source app: Lab Tests, Raw Milk (and its setup submenu), Online Orders, Shop, Sales, LabelP.

## Stack
Node.js (CommonJS), Express 5, EJS 5, PostgreSQL via `pg` (Neon), `express-session` + `connect-pg-simple`, `bcryptjs`, `exceljs`, `canvas`.
`db/database.js` wraps `pg` in a SQLite-style `db.get/all/run` API (`?` placeholders are converted to `$n`).

## Database
Neon database **`nds`**, in the same Neon project/endpoint as nepaldairy's `neondb`. It was created as an exact clone
(schema, sequences, constraints, indexes, functions, triggers and all data) of `neondb` on 2026-11-04.
The two databases are independent from that point on. All source tables were kept (including raw milk, orders, lab)
so the schema stays identical; `db/database.js` is unchanged from the source.

Connection string lives in `.env.local` (`DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV`) — never commit it.

## Running
```bash
npm install
npm start   # http://localhost:3000
```
