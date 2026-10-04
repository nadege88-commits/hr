"""Adds (or removes) example people with realistic data on the live project, to try the app and show it around.
   Usage: python3 tools/demo_people.py add | remove
   Everything it creates uses an @demo.northpoint.example email or a 203.0.113.x network, so `remove` takes all of it away.
   Needs the Supabase access token in ~/.ops-supabase-token. Demo people are kept out of Miracles (v1), where real managers are."""
import json, os, random, secrets, sys, urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

REF = 'iyyzqyijdozojebzhsrk'; DOM = '@demo.northpoint.example'; TZ = ZoneInfo('Europe/Malta')
T = open(os.path.expanduser('~/.ops-supabase-token')).read().strip()
def http(url, data=None, headers=None, method=None):
    r = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                               headers={'Content-Type': 'application/json', 'User-Agent': 'curl/8', **(headers or {})}, method=method)
    try: return json.loads(urllib.request.urlopen(r).read().decode() or 'null')
    except urllib.error.HTTPError as e: return {'ERR': e.code, 'body': e.read().decode()[:300]}
M = {'Authorization': 'Bearer ' + T}
def q(sql):
    r = http(f'https://api.supabase.com/v1/projects/{REF}/database/query', {'query': sql}, M)
    assert isinstance(r, list), r
    return r
def service():
    keys = http(f'https://api.supabase.com/v1/projects/{REF}/api-keys?reveal=true', headers=M)
    k = next(k['api_key'] for k in keys if k.get('name') == 'service_role' or k.get('type') == 'secret')
    return {'apikey': k, 'Authorization': 'Bearer ' + k}
s = lambda v: "'" + str(v).replace("'", "''") + "'"

Z = 'xmusti0bzrmndx'
PEOPLE = [  # key, name, job, role, venues
    ('dario', 'Dario Kovač', 'Venue manager', 'manager', ['v3', 'v4']), ('elena', 'Elena Rossi', 'Venue manager', 'manager', ['v6', 'v5']),
    ('luka', 'Luka Petrović', 'Bartender', 'employee', ['v3']), ('amara', 'Amara Okafor', 'Waiter', 'employee', ['v3', 'v4']),
    ('tomas', 'Tomás Silva', 'Chef', 'employee', ['v4']), ('hana', 'Hana Suzuki', 'Bartender', 'employee', ['v6']),
    ('yusuf', 'Yusuf Demir', 'Waiter', 'employee', ['v6', 'v5']), ('sofia', 'Sofia Marin', 'Pizza chef', 'employee', ['v5']),
    ('nikos', 'Nikos Pappas', 'Grill chef', 'employee', [Z])]
WIFI = {'v3': ('203.0.113.10', 'Victoria Wi-Fi'), 'v4': ('203.0.113.20', 'Merak Wi-Fi'), 'v5': ('203.0.113.40', 'Tramonto Wi-Fi'),
        'v6': ('203.0.113.30', 'Ammos Wi-Fi'), Z: ('203.0.113.50', 'Zorbas Wi-Fi')}
E = lambda k: k + DOM

def remove():
    q(f"""delete from public.hr_inbox where recipient like '%{DOM}' or body like '%(demo)';
          delete from public.hr_push_subscriptions where email like '%{DOM}';
          delete from public.hr_leave where person like '%{DOM}';
          delete from public.hr_shifts where person like '%{DOM}';
          delete from public.hr_people where email like '%{DOM}';
          delete from public.hr_networks where net like '203.0.113.%';
          delete from auth.users where email like '%{DOM}'; select 1""")
    print('demo people removed')

def add():
    remove()
    rnd = random.Random(20261004); now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    today = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    A = service(); pw = 'Northpoint-' + ''.join(secrets.choice('23456789') for _ in range(4))
    for k, *_ in PEOPLE:
        r = http(f'https://{REF}.supabase.co/auth/v1/admin/users', {'email': E(k), 'password': pw, 'email_confirm': True}, A); assert 'id' in r, r
    q('insert into public.hr_people(email,name,job,role,venue_ids) values ' + ','.join(
        f"({s(E(k))},{s(n)},{s(j)},{s(r)},{s('{' + ','.join(v) + '}')})" for k, n, j, r, v in PEOPLE) + '; select 1')
    q('insert into public.hr_networks(net,label) values ' + ','.join(f'({s(ip)},{s(lb)})' for ip, lb in WIFI.values()) + ' on conflict (net) do nothing; select 1')

    shifts = []   # (person, venue, in, out, extra columns dict)
    on_now = {'luka': timedelta(hours=3, minutes=10), 'hana': timedelta(hours=1, minutes=25), 'tomas': timedelta(hours=5, minutes=2)}
    for d in range(20, 0, -1):
        for k, _, _, role, venues in PEOPLE:
            work, hour, minute, length = rnd.random() < 0.66, 8 + rnd.randrange(9), rnd.randrange(60), 6 + rnd.random() * 3.2
            if not work or (d == 1 and (k in on_now or k == 'amara')): continue
            t = (today - timedelta(days=d) + timedelta(hours=hour, minutes=minute)).astimezone(timezone.utc)
            shifts.append([k, venues[d % len(venues)], t, t + timedelta(minutes=round(length * 60)), {}])
    shifts.append(['amara', 'v4', (today - timedelta(days=1) + timedelta(hours=16, minutes=4)).astimezone(timezone.utc), None, {}])   # forgot to clock out
    for k, back in on_now.items(): shifts.append([k, next(p[4][0] for p in PEOPLE if p[0] == k), now - back, None, {}])
    fixed = [x for x in shifts if x[0] == 'luka' and x[3]][-1]
    fixed[4] = {'edited_by': E('dario'), 'edited_at': fixed[3] + timedelta(hours=2), 'edit_reason': 'Forgot to clock out', 'orig_in': fixed[2]}
    added = [x for x in shifts if x[0] == 'tomas' and x[3]][-2]
    added[4] = {'added': True, 'edited_by': E('dario'), 'edited_at': added[3] + timedelta(hours=1), 'edit_reason': 'Phone was dead, hours from the kitchen sheet'}
    def net(k, venue):   # most clocks come from the venue Wi-Fi; Yusuf's often do not, so there is something to look into
        off = rnd.random() < (0.5 if k == 'yusuf' else 0.08)
        return f'198.51.100.{rnd.randrange(2, 250)}' if off else WIFI[venue][0]
    sql = []
    for i, (k, v, tin, tout, x) in enumerate(shifts):
        cols = {'person': E(k), 'venue_id': v, 'clock_in': tin.isoformat(), 'clock_out': tout.isoformat() if tout else None,
                **{c: (val.isoformat() if isinstance(val, datetime) else val) for c, val in x.items()}}
        names = ','.join(cols); vals = ','.join('null' if val is None else ('true' if val is True else s(val)) for val in cols.values())
        ins = f'insert into public.hr_shifts({names}) values ({vals}) returning id'
        if x.get('added'): sql.append(ins + ';')
        else:
            a, b = net(k, v), (net(k, v) if tout else None)
            sql.append(f"with n as ({ins}) insert into public.hr_shift_net(shift_id,in_ip,in_net,out_ip,out_net,at) select id,{s(a)},{s(a)},{s(b) if b else 'null'},{s(b) if b else 'null'},{s(tin.isoformat())} from n;")
    q('\n'.join(sql) + ' select 1')

    D = lambda n: (today + timedelta(days=n)).date().isoformat(); ago = lambda **kw: (now - timedelta(**kw)).isoformat()
    leave = [  # person, type, from, to, note, status, decided_by, reason, created
        ('luka', 'holiday', 10, 14, 'Family trip', 'pending', None, '', ago(hours=5)),
        ('hana', 'sick', -1, 0, "Flu, doctor's note to follow", 'pending', None, '', ago(hours=20)),
        ('sofia', 'holiday', 5, 6, 'Wedding', 'pending', None, '', ago(hours=3)),
        ('nikos', 'other', 3, 3, 'Dentist in the morning', 'pending', None, '', ago(hours=2)),
        ('dario', 'holiday', 30, 36, '', 'pending', None, '', ago(hours=8)),
        ('amara', 'holiday', 20, 22, '', 'approved', 'dario', '', ago(days=3)),
        ('yusuf', 'holiday', -20, -16, '', 'approved', 'elena', '', ago(days=30)),
        ('tomas', 'unpaid', 6, 6, 'Moving flat', 'rejected', 'dario', 'Two chefs are already off that day', ago(days=2))]
    q('insert into public.hr_leave(person,type,from_date,to_date,note,status,decided_by,decided_at,reason,created_at) values ' + ','.join(
        f"({s(E(p))},{s(t)},{s(D(a))},{s(D(b))},{s(n)},{s(st)},{s(E(by)) if by else 'null'},{s(ago(days=1)) if by else 'null'},{s(rs)},{s(c)})"
        for p, t, a, b, n, st, by, rs, c in leave) + '; select 1')
    rng = "public.hr_range({}::date,{}::date)".format
    admins = [r['email'] for r in q(f"select email from public.hr_people where role='admin' and active and email not like '%{DOM}'")]
    box = [(E('dario'), 'leave', "'Luka Petrović asked for Holiday, ' || " + rng(s(D(10)), s(D(14))), 'leave', ago(hours=5), False),
           (E('elena'), 'leave', "'Hana Suzuki asked for Sick leave, ' || " + rng(s(D(-1)), s(D(0))), 'leave', ago(hours=20), False),
           (E('elena'), 'leave', "'Sofia Marin asked for Holiday, ' || " + rng(s(D(5)), s(D(6))), 'leave', ago(hours=3), False),
           (E('amara'), 'decision', "'Dario Kovač approved your Holiday, ' || " + rng(s(D(20)), s(D(22))), 'leave', ago(days=1), True),
           (E('tomas'), 'decision', "'Dario Kovač rejected your Unpaid leave, ' || " + rng(s(D(6)), s(D(6))) + " || ': Two chefs are already off that day'", 'leave', ago(days=1), False),
           (E('luka'), 'shift', "'Dario Kovač changed your shift on ' || public.hr_day(" + s(fixed[2].isoformat()) + "::timestamptz) || ': Forgot to clock out'", 'hours', fixed[4]['edited_at'].isoformat(), False)]
    for a in admins:   # the two requests only an admin can decide; marked (demo) and not pushed to anyone's phone
        box.append((a, 'leave', "'Dario Kovač asked for Holiday, ' || " + rng(s(D(30)), s(D(36))) + " || ' (demo)'", 'leave', ago(hours=8), False))
        box.append((a, 'leave', "'Nikos Pappas asked for Other, ' || " + rng(s(D(3)), s(D(3))) + " || ' (demo)'", 'leave', ago(hours=2), False))
    q('insert into public.hr_inbox(recipient,kind,body,tab,created_at,read_at,pushed_at) values ' + ','.join(
        f"({s(to)},{s(kind)},{body},{s(tab)},{s(at)},{'now()' if read else 'null'},now())" for to, kind, body, tab, at, read in box) + '; select 1')
    print(q(f"select (select count(*) from public.hr_people where email like '%{DOM}') people, (select count(*) from public.hr_shifts where person like '%{DOM}') shifts, (select count(*) from public.hr_shift_net) clock_networks, (select count(*) from public.hr_leave where person like '%{DOM}') leave, (select count(*) from public.hr_inbox) inbox"))
    print('PASSWORD', pw)

{'add': add, 'remove': remove}[sys.argv[1] if len(sys.argv) > 1 else 'add']()
