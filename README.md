# Central Public Library

A responsive library website with a vanilla HTML/CSS/JavaScript frontend and an Express/MongoDB API. Members can create accounts, browse and request books, and review their requests. Administrators can manage requests and add books.

## Requirements

- Node.js 18 or newer
- A MongoDB database

## Set up

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`).
3. Set `MONGODB_URI` to your MongoDB connection string and choose a random `JWT_SECRET` with at least 32 characters.
4. Set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters for the first administrator account. Do not use a sample password in production.
5. On the first server start, an empty catalog is automatically filled with 31 starter books so catalog search works immediately. Optionally run `npm run seed:books` to import up to 6,000 English-language works from Open Library. The import uses smaller pages, retries temporary API failures, and is repeatable; rerunning it updates matching work records.
6. Run `npm run dev` and open `http://localhost:3000`. Do not open files in `public/` directly: account creation, login, catalog, profile, and loan records need the API server.

For local development, use `npm run dev`. When serving over HTTPS, set `COOKIE_SECURE=true`.

## Catalog and images

The catalog import uses the public Open Library Search API. It does not require an API key. It imports up to 6,000 English-language book records and stores available cover image URLs from Open Library Covers. Administrators can also enter a public HTTPS cover image URL when adding a book. The library's hero photography is served by Unsplash. The site remains usable without covers or remote images.

## API

- `GET /api/health` — health check
- `GET /api/books?page=1&limit=12&search=...` — paginated catalog search
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/loans`, `GET /api/loans/mine` — member book requests
- `GET /api/admin/overview`, `POST /api/admin/books`, `PATCH /api/admin/loans/:id`, `PATCH /api/admin/loans/:id/tracking` — administrator tools
- `GET /api/admin/books`, `PUT /api/admin/books/:id` — protected book editing
- `GET /api/library-settings`, `PUT /api/admin/library-settings`, `GET /api/admin/deliveries` — library location and delivery administration
- `GET /api/issues`, `POST /api/issues` — public issue board and rate-limited public reports
- `GET /api/admin/issues`, `PATCH /api/admin/issues/:id` — administrator review and public issue-status updates
- `GET /api/admin/members?page=1&limit=20` — administrator-only member profiles and full book-request/loan history

Authentication uses an HTTP-only, same-site cookie; passwords are hashed with bcrypt. The separate `/profile.html` page shows the signed-in account name, login email, account role, member-since date, last sign-in time, and book history. Passwords and password hashes are never returned to the frontend. Secrets belong in the untracked `.env` file and must never be placed in frontend files.

Book requests use separate `fulfillment.html`, `pickup.html`, and `delivery.html` pages. Select **Request this book** in the catalog, then choose pickup or delivery. Pickup uses the sample address shown in the Visit section. Delivery requests save the member's address and phone number and display a mock tracker; no courier, delivery booking, or live tracking integration is connected. Administrators can update the demo tracker from the admin dashboard.

Staff can open `/admin.html` to sign in with the configured administrator account, add or edit book records, update the public library address and opening hours, enable or disable home delivery, review delivery addresses, and update demo tracking statuses. The admin APIs enforce the administrator role on the server.

The public site includes a community issue board. Reports and their descriptions are visible to everyone; do not submit personal or sensitive information. Administrators can change a report's public status to Submitted, Under review, or Resolved in the admin console.

## Library details

The default address, hours, and email are sample content. Sign in at `/admin.html` and save the library's real details in **Library location & delivery** before publishing.
