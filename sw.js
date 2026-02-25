// Đổi tên cache để ép máy tải lại bản mới nhất
const CACHE_NAME = 'vocab-pro-v7';

// Danh sách các file cần lưu Offline (Bao gồm cả thư viện Google và Icon)
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-config.js',
  './utils.js',
  './manifest.json',
  // Thư viện Firebase bắt buộc phải lưu offline
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js',
  // Lưu luôn cái icon để lúc mất mạng app vẫn có logo
  'https://cdn-icons-png.flaticon.com/512/2232/2232688.png'
];

// 1. Cài đặt Service Worker và tải file vào Cache
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// 2. Chặn và xử lý khi mất mạng
self.addEventListener('fetch', (e) => {
  // Bỏ qua các request POST/PUT (Vì Firebase dùng cái này để đồng bộ dữ liệu)
  if (e.request.method !== 'GET') return;

  // Bỏ qua các API kết nối trực tiếp đến Database của Google
  // (Để cho Firebase tự lo phần Offline Database của nó)
  if (e.request.url.includes('firestore.googleapis.com')) return;

  // Với các file code/ảnh/css bình thường -> Lấy từ Cache ra dùng
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});