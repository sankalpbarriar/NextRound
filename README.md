# NextRound website prototype

Open `index.html` in a browser to view the responsive public site and its team workspace prototype.

## What works now

- Public information site, plans, application form and FAQ
- No student login: applications are open directly from the website
- Prototype team login (`any email` / access code `nextround`)
- Applications appear in the team dashboard and are stored in the browser only

## Before launching publicly

1. Replace the four panel placeholders with authorised photos, real names, roles and company logos.
2. Add final pricing, payment flow and the actual application fields from the existing Google Form.
3. Replace browser-only storage and prototype login with secure authentication, a database, and a calendar/scheduling integration.

## Supabase setup

1. Open your Supabase project and run the SQL in `supabase/schema.sql` in the SQL editor.
2. Run `supabase/seed-interview-records.sql` in the SQL editor to import the historical completed interviews.
3. Create a storage bucket named `payment-proofs` if you want the application proof upload flow to work.
4. Copy `.env.example` to `.env` and add your project URL and service role key.
5. Run:
   `SUPABASE_URL=https://your-project.supabase.co SUPABASE_SERVICE_ROLE_KEY=your-key node scripts/seed-supabase.js`
6. Confirm the app loads data from Supabase by opening the site with `supabase-config.js` configured with the anon key.

For longer login sessions, open Supabase Dashboard → Authentication → Settings and increase the JWT expiry. The app persists the refresh session and automatically refreshes tokens while the browser is open.

The two source PDFs could not be read from the Downloads folder in this session, so no response data or exact fields were copied into this prototype.
