# Chatpay

Node.js + Express site with a validated application API, an admin dashboard, and PostgreSQL storage.

## Run locally
    npm install
    cp .env.example .env     # set ADMIN_TOKEN and DATABASE_URL (a local or hosted PostgreSQL)
    npm start                # http://localhost:3000

## Admin
Open /admin.html and sign in with ADMIN_TOKEN. API routes (header `Authorization: Bearer <ADMIN_TOKEN>`):
- GET   /api/admin/applications
- PATCH /api/admin/applications/:id   body {"status":"contacted"}  (new|contacted|onboarded|paid|rejected)
- GET   /api/admin/export.csv

## Worker dashboard
Workers create a password when they register and sign in at /dashboard.html. They see their status, payout method
(number partly hidden) and the earnings/bonuses you record. Record them in /admin.html with the "+ earning" / "+ bonus"
buttons, send the money from your own mobile money account, then press "Mark paid".
Add real work listings in /admin.html ("+ Add job"); workers see them on their dashboard, with a warning if pay or employer is missing.
Optional env vars PAYOUT_SCHEDULE and MIN_PAYOUT appear in the "How you get paid" box.
Set SESSION_SECRET (Render generates one from render.yaml). Workers who registered before this update have no password.

## Workplace (admin-approved access)
/workplace.html shows tasks only to workers you approve. In /admin.html press "Grant access" on a worker after verifying their
details (Revoke removes it). Add tasks with "+ Add task"; worker answers appear under Submissions. The dashboard shows the
"Go to your workplace" button only to approved workers. Access is enforced on the server, not just hidden.

## Deploy on Render
Use the included render.yaml (New > Blueprint), which creates the web service and the PostgreSQL database.
ADMIN_TOKEN is generated for you: Render dashboard > chatpay > Environment.
The table is created automatically on first start.

## Confirmation emails
Set BREVO_API_KEY, MAIL_FROM_EMAIL (a sender verified in Brevo), MAIL_FROM_NAME and SUPPORT_EMAIL.
If BREVO_API_KEY is empty, applications still save and no email is sent.

## Before launch
Fill in pay rates, payout schedule, support contacts, registration number, and write real Terms and Privacy pages.
Never charge applicants any fee to join or work.
