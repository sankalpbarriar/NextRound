# NextRound website prototype

Open `index.html` in a browser to view the responsive public site and its team workspace prototype.

## What works now

- Public information site, plans, application form and FAQ
- No student login: applications are open directly from the website
- Team login through Supabase Auth for emails listed in `ADMIN_EMAILS`
- Applications appear in the team dashboard and are stored in the browser only

## Before launching publicly

1. Replace the four panel placeholders with authorised photos, real names, roles and company logos.
2. Add final pricing, payment flow and the actual application fields from the existing Google Form.
3. Replace browser-only storage and prototype login with secure authentication, a database, and a calendar/scheduling integration.

## Supabase setup

1. Open your Supabase project and run the SQL in `supabase/schema.sql` in the SQL editor.
2. Run `supabase/seed-interview-records.sql` in the SQL editor to import the historical completed interviews.
3. Run `supabase/seed-google-meet-applications.sql` to add the latest Google Meet application record.
4. Create a storage bucket named `payment-proofs` if you want the application proof upload flow to work.
5. Copy `.env.example` to `.env` and add your project URL, anon key, admin emails, and finance admin email. Keep the service role key for server-side seeding only; never use it in `supabase-config.js`.
   Create those team users in Supabase Dashboard → Authentication → Users before signing in.
6. Run:
   `SUPABASE_URL=https://your-project.supabase.co SUPABASE_SERVICE_ROLE_KEY=your-key node scripts/seed-supabase.js`
7. Generate the browser config from `.env`:
   `node scripts/generate-supabase-config.js`
   This creates the ignored `supabase-config.js` runtime file.
8. Confirm the app loads data from Supabase by opening the site after generating both files.

## Netlify deployment

The repository does not contain the generated config file or any keys. Netlify creates `supabase-config.js` during deployment.

1. In Netlify, open **Site configuration → Environment variables**.
2. Add these variables for the **Builds** scope:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `ADMIN_EMAILS` (comma-separated emails)
   - `FINANCE_ADMIN_EMAIL`
3. Deploy the site. `netlify.toml` runs `node scripts/generate-supabase-config.js` before publishing the project.

Do not add `SUPABASE_SERVICE_ROLE_KEY` to the frontend build. Use that key only locally or in a separate server-side seed command.

For longer login sessions, open Supabase Dashboard → Authentication → Settings and increase the JWT expiry. The app persists the refresh session and automatically refreshes tokens while the browser is open.

The two source PDFs could not be read from the Downloads folder in this session, so no response data or exact fields were copied into this prototype.
