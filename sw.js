const CACHE_NAME = "gradeflow-v1";

const urlsToCache = [
  "index.html",
  "dashboard.html",
  "login.html",
  "signup.html",
  "style.css",
  "dashboard.js",
  "firebase.js",
  "logo.png",
  "share.js",
  "share.html",
  "auth.js",
  "manifest.json"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((res) => res || fetch(event.request))
  );
});