// Exists only so the rest timer can raise its "Rest complete" notification
// through ServiceWorkerRegistration.showNotification, which is the sole
// notification path Chrome for Android offers (its page-level Notification
// constructor throws). Deliberately no fetch handler, caching or precache:
// this worker must never sit between the app and the network.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => 'focus' in client);
      if (open) return open.focus();
      return self.clients.openWindow('/');
    }),
  );
});
