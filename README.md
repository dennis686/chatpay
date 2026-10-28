# Chatpay

Node.js + Express site with a validated application API. Applicants are saved to `data/applications.json`.

## Run
    npm install
    cp .env.example .env     # set ADMIN_TOKEN to a long random string
    npm start                # http://localhost:3000

## Admin (send header `Authorization: Bearer <ADMIN_TOKEN>`)
- GET   /api/admin/applications          list all
- PATCH /api/admin/applications/:id      body {"status":"contacted"}  (new|contacted|onboarded|rejected)
- GET   /api/admin/export.csv            download CSV

Example: curl -H "Authorization: Bearer YOUR_TOKEN" https://yourdomain/api/admin/export.csv -o apps.csv

## Deploy
Render, Railway or a VPS all work. Use HTTPS. The JSON file needs persistent disk
(on Render/Railway attach a volume at /data and edit DATA_DIR). For high traffic, swap to PostgreSQL.

## Before launch
Fill in pay rates, payout schedule, support contacts, registration number, and write real Terms and Privacy pages.
Pay workers manually or integrate Airtel Money / MTN MoMo Collections-Disbursements APIs (needs a business account).
