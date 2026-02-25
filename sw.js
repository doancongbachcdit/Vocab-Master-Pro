// Đặt tên cache (nhớ đổi tên này mỗi khi cập nhật code mới để máy tự tải lại)
const CACHE_NAME = 'vocab-pro-v6';

// Danh sách các file cần lưu vào bộ nhớ đệm
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-config.js',
  './utils.js',
  './manifest.json'
];

// 1. Cài đặt Service Worker
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// 2. Lấy dữ liệu từ Cache khi không có mạng
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request))
  );
});