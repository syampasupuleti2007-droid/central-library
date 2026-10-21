# Central Public Library

A responsive library website with a vanilla HTML/CSS/JavaScript frontend and an Express/MongoDB API. Members can create accounts, browse books by category, request titles, and review their requests. Administrators can manage requests, categorize books, and add books.

## Requirements

- Node.js 18 or newer
- A MongoDB database

## Set up

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`).
3. Set `MONGODB_URI` to your MongoDB connection string and choose a random `JWT_SECRET` with at least 32 characters.
4. Set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters for the first administrator account. Do not use a sample password in production.
5. To enable complaint SMS updates, set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` to your Twilio account credentials and sender number. Users must provide a mobile number in international format and consent when submitting a report.
6. On the first server start, an empty catalog is automatically filled with 31 starter books so catalog search works immediately. Optionally run `npm run seed:books` to import up to 6,000 English-language works from Open Library. The import uses smaller pages, retries temporary API failures, and is repeatable; rerunning it updates matching work records and refreshes inferred categories without overwriting categories assigned by staff.
7. Run `npm run dev` and open `http://localhost:3000`. Do not open files in `public/` directly: account creation, login, catalog, profile, and loan records need the API server.

For local development, use `npm run dev`. When serving over HTTPS, set `COOKIE_SECURE=true`.

## Catalog and images

The catalog import uses the public Open Library Search API. It does not require an API key. It imports up to 6,000 English-language book records and stores available cover image URLs from Open Library Covers. Administrators can also enter a public HTTPS cover image URL when adding a book. The library's hero photography is served by Unsplash. The site remains usable without covers or remote images.

## API

- `GET /api/health` — health check
- `GET /api/books?page=1&limit=12&search=...&category=...&language=...` — paginated catalog search and category/language filtering, including total and available copies
- `GET /api/books/languages` — catalog languages for the public and administrator filters
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/notifications/mine`, `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all` — signed-in members view their private notification inbox and mark messages as read
- `POST /api/loans`, `GET /api/loans/mine`, `POST /api/loans/:id/return` — member book requests, history, and return requests
- `GET /api/table-bookings/availability?date=YYYY-MM-DD&floor=1`, `GET /api/table-bookings/mine`, `POST /api/table-bookings`, `PATCH /api/table-bookings/:id/cancel` — member table availability, one-hour reservations, and cancellation
- `GET /api/admin/table-bookings`, `PATCH /api/admin/table-bookings/:id/cancel` — administrator table booking management
- `POST /api/book-suggestions`, `GET /api/book-suggestions/mine` — signed-in members can submit and track private book suggestions
- `GET /api/admin/overview` — administrator summary statistics, copy availability, and loan status counts
- `GET /api/admin/book-suggestions`, `PATCH /api/admin/book-suggestions/:id` — administrators review and update suggestion statuses
- `POST /api/admin/books`, `PATCH /api/admin/loans/:id`, `PATCH /api/admin/loans/:id/tracking` — administrator tools
- `GET /api/admin/books`, `PUT /api/admin/books/:id` — protected book editing, including the copies-in-collection count
- `GET /api/library-settings`, `PUT /api/admin/library-settings`, `GET /api/admin/deliveries` — library location and delivery administration
- `GET /api/issues`, `POST /api/issues` — signed-in member reports and rate-limited submissions
- `GET /api/admin/issues`, `PATCH /api/admin/issues/:id` — administrator review and report-status updates
- `GET /api/admin/members?page=1&limit=20&search=...` — administrator-only member profiles, library IDs, account dates, and book-request/loan history
- `POST /api/admin/members/:id/messages` — administrator-only message delivery to an individual member's notification inbox

Authentication uses an HTTP-only, same-site cookie; passwords are hashed with bcrypt. The separate `/profile.html` page shows the signed-in account name, login email, account role, member-since date, last sign-in time, and book history. Passwords and password hashes are never returned to the frontend. Secrets belong in the untracked `.env` file and must never be placed in frontend files.

Member services are available on their own signed-in pages: `/notifications.html`, `/table-bookings.html`, `/book-suggestion.html`, and `/complaint.html`. The member navigation links to each page, and signing in from one returns you to it. The Notifications inbox has an unread badge and receives updates when book or table requests are received, administrators approve or decline book requests, delivery tracking changes, returns are confirmed, book suggestions are reviewed, complaints change status, or a table booking is cancelled. Administrators can also send a titled message to an individual member from that member's card in the **Members** admin section; it appears in their inbox as a message from library staff. The inbox refreshes periodically while open; notifications are private to their member account.

Book requests use separate `fulfillment.html`, `pickup.html`, `delivery.html`, and `payment.html` pages. Select **Request this book** in the catalog, then choose pickup or delivery. Pickup uses the sample address shown in the Visit section. Home delivery records a fixed ₹45 delivery fee and demo-only payment status. After demo checkout, members can view and print a receipt identified by their loan request. The payment page simulates checkout and does not charge money; no payment gateway or courier is connected.

Members can request a return from **My profile** after a pickup loan is approved or a delivery is marked delivered. Their return request and timestamp appear in the admin pickup or delivery queue. Staff confirm receipt in the admin portal; only then is the loan marked returned and its copy made available again.

Members can book a study table from **My profile** for one-hour slots during the library's configured opening hours, up to 30 days ahead. Each of the 5 floors has 30 tables. Confirmations and booking lists show the table address as its floor and table number. Available tables are confirmed immediately, and members can cancel their own bookings to release a table. Administrators have a separate **Table bookings** section to view or cancel reservations. Booking dates and opening-hour slots use the server's local time zone.

Members can also use **Suggest a book** from the public catalog or their profile to request a new title. Suggestions are visible only to their submitter and administrators. Staff have a separate **Book suggestions** admin section to review submissions and mark them submitted, under review, approved, declined, or added to the collection.

The signed-in member profile includes an offline, rule-based library chat helper for common borrowing, return, delivery, suggestion, and complaint questions. It uses preset responses in the browser, makes no AI-service/API requests, and cannot access live catalog or account data.

Staff can open `/admin.html` to sign in with the configured administrator account, view and search member details and loan history, manage books and library settings, categorize books, set a language when adding a book, edit each book's language, edit the number of copies in the collection, review pickup and delivery requests, and update demo tracking statuses. Members can search the catalog by language or filter to a selected language. Existing books without a saved language default to English; staff can change that value when needed. The public catalog displays each book's language, total copies, and available copies, and marks books unavailable when every copy is requested or approved. Requests reserve a copy, and copies become available again when a request is declined or the library confirms a return. The admin APIs enforce the administrator role on the server.

Books use these categories: Adventure, Biography, Children, Classics, Fantasy, History, Horror, Mystery, Nonfiction, Philosophy, Romance, Science Fiction, and Other. Imported and existing catalog entries are categorized from their available subject metadata; administrators can edit each book to correct or refine its category.

The community issue board is available only after a member signs in, and members see only their own reports. Reports are visible only to the submitting member and administrators; do not submit personal or sensitive information. Administrators can see each report's submitting member and change its status to Submitted, Under review, or Resolved in the admin console.

When Twilio is configured, members who consent receive SMS notifications when their report is submitted and when an administrator changes its status. Without Twilio configuration, reports are still saved and the profile displays that SMS could not be sent.

## Library details

The default address, hours, and email are sample content. Sign in at `/admin.html` and save the library's real details in **Library location & delivery** before publishing.
