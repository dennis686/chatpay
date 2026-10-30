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
