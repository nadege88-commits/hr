// Sends phone notifications for the HR app. Only for time off:
//  - a request goes to whoever approves it (kind "leave")
//  - the decision goes to the person who asked (kind "decision")
// Everything else (shift corrections) stays in the inbox only.
// Called by a timer (pg_cron) with a shared secret; never by phones.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const KINDS = ["leave", "decision"];
const MAX_AGE_MS = 14 * 60 * 60 * 1000; // older unsent items are only kept in the inbox

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
webpush.setVapidDetails("https://nadege88-commits.github.io/hr/", Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("Forbidden", { status: 403 });
  const { data: rows } = await sb.from("hr_inbox").select("id,recipient,kind,body,created_at").is("pushed_at", null).in("kind", KINDS).order("id");
  if (!rows?.length) return Response.json({ rows: 0, sent: 0 });
  const { data: people } = await sb.from("hr_people").select("email,active");
  let sent = 0, gone = 0;
  for (const r of rows) {
    const fresh = Date.now() - Date.parse(r.created_at) < MAX_AGE_MS;
    const person = (people ?? []).find((p) => p.email === r.recipient);
    if (!fresh || !person?.active) continue;
    const { data: subs } = await sb.from("hr_push_subscriptions").select("endpoint,p256dh,auth").eq("email", r.recipient);
    const payload = JSON.stringify({ title: r.kind === "leave" ? "Time off request" : "Your time off", body: r.body, url: "#leave", tag: "hr-" + r.id });
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 12 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { await sb.from("hr_push_subscriptions").delete().eq("endpoint", s.endpoint); gone++; } // phone unsubscribed
      }
    }
  }
  await sb.from("hr_inbox").update({ pushed_at: new Date().toISOString() }).in("id", rows.map((r) => r.id));
  return Response.json({ rows: rows.length, sent, gone });
});
