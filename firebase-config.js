import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, collection, addDoc, getDocs, deleteDoc, doc, query, where, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Thông tin dự án của bạn
const firebaseConfig = {
    apiKey: "AIzaSyAV3BXhCyt8_HKXrYr20C_uzaE9NU1NwaM",
    authDomain: "vocab-master-pro-4fb7a.firebaseapp.com",
    projectId: "vocab-master-pro-4fb7a",
    storageBucket: "vocab-master-pro-4fb7a.firebasestorage.app",
    messagingSenderId: "15841490208",
    appId: "1:15841490208:web:ebcbc0c3e248b43a281345"
};

// Khởi tạo
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Bật Offline Persistence (Lưu cache offline)
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache()
});

// "Xuất khẩu" các hàm này để file app.js có thể lấy dùng
export { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut };
export { collection, addDoc, getDocs, deleteDoc, doc, query, where, updateDoc, writeBatch };