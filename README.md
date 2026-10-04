# Northpoint Team

Staff app for the Northpoint venues: clock in and out, hours, time off requests, an inbox, and an hours export.
A web app installed on the phone's home screen (Share → Add to Home Screen).

- Hosting: GitHub Pages (this repo).
- Data and logins: the same Supabase project as Operations, so one login works in both apps. Row-level security decides who sees what.
- Database setup: `supabase/001_hr.sql` (only adds `hr_` tables and functions).
- Demo with example people, stored in the browser only: open the app with `?demo` at the end of the address.

No personal data is stored in this repository.
