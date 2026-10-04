// Northpoint Team: shows phone notifications and opens the right screen when one is tapped. Nothing is cached; the app always loads fresh.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { d = {title:'Northpoint Team', body:e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Northpoint Team', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag || ('hr-' + Date.now()), data: {url: d.url || ''}
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = self.registration.scope + (e.notification.data?.url || '');
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(list => {
    for (const c of list) if ('focus' in c) { if ('navigate' in c) c.navigate(target).catch(()=>{}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
