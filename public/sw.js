// Minimal service worker: makes Mealbook installable. It caches nothing,
// so you always get the latest recipes and the latest version of the app.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
