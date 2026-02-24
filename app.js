// 1. NHẬP KHẨU TỪ CÁC FILE KHÁC
import { auth, db, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, collection, addDoc, getDocs, deleteDoc, doc, query, where, updateDoc, writeBatch } from './firebase-config.js';
import { speakText, downloadSample, exportJSON } from './utils.js';

// 2. BIẾN TOÀN CỤC
const SRS_INTERVALS = [0, 1, 3, 7, 14, 30, 90, 180]; 
let currentUser = null;
let cachedWords = [];
let dueWords = [];
let quizHistory = [];
let historyIndex = -1;
let isCramMode = false;
let currentQuizItem = null;

// 3. LOGIC ĐĂNG NHẬP
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('userInfo').innerHTML = `Xin chào, <b>${user.displayName}</b>`;
        document.getElementById('btnLogin').style.display = 'none';
        document.getElementById('btnLogout').style.display = 'block';
        await loadDataFromCloud(); 
    } else {
        currentUser = null;
        cachedWords = [];
        document.getElementById('userInfo').innerHTML = `Bạn chưa đăng nhập`;
        document.getElementById('btnLogin').style.display = 'block';
        document.getElementById('btnLogout').style.display = 'none';
        document.getElementById('reviewStatus').innerHTML = "Vui lòng đăng nhập!";
        window.renderList();
    }
});

window.loginGoogle = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(err => alert("Lỗi: " + err.message));
window.logoutGoogle = () => signOut(auth);

// 4. DATABASE FIREBASE
async function loadDataFromCloud() {
    document.getElementById('reviewStatus').innerHTML = "⏳ Đang đồng bộ mây...";
    try {
        const q = query(collection(db, "words"), where("userId", "==", currentUser.uid));
        const snap = await getDocs(q);
        cachedWords = [];
        snap.forEach(doc => cachedWords.push({ id: doc.id, ...doc.data() }));
        
        window.updateSRSStatus();
        if(document.getElementById('list').classList.contains('active')) window.renderList();
        if(document.getElementById('quiz').classList.contains('active')) window.resetQuiz();
    } catch (error) { alert("Lỗi tải dữ liệu: " + error.message); }
}

window.addWord = async function() {
    if(!currentUser) return alert("Đăng nhập để lưu từ!");
    const w = document.getElementById('inpWord').value.trim();
    const m = document.getElementById('inpMeaning').value.trim();
    const p = document.getElementById('inpPhonetic').value.trim();
    const l = document.getElementById('inpLang').value;
    
    if(!w || !m) return alert("Thiếu từ hoặc nghĩa!");
    if (cachedWords.some(item => item.w.toLowerCase() === w.toLowerCase() && item.l === l)) return alert(`Từ "${w}" đã tồn tại!`);

    const newItem = { w, m, l, p, level: 0, nextReview: 0, userId: currentUser.uid };

    try {
        document.getElementById('addStatus').innerText = "Đang lưu...";
        const docRef = await addDoc(collection(db, "words"), newItem);
        cachedWords.unshift({ id: docRef.id, ...newItem }); 
        
        document.getElementById('inpWord').value = '';
        document.getElementById('inpMeaning').value = '';
        document.getElementById('inpPhonetic').value = '';
        document.getElementById('inpWord').focus();
        
        document.getElementById('addStatus').innerText = "✅ Đã lưu!";
        setTimeout(()=>document.getElementById('addStatus').innerText="", 2000);
        window.updateSRSStatus();
    } catch (e) { alert("Lỗi: " + e.message); }
}

window.deleteWord = async function(id) {
    if(confirm("Xóa vĩnh viễn?")) { 
        try {
            await deleteDoc(doc(db, "words", id));
            cachedWords = cachedWords.filter(x => x.id !== id);
            window.renderList(); 
            window.updateSRSStatus(); 
        } catch (e) { alert("Lỗi xóa!"); }
    }
}

// 5. QUIZ VÀ SRS
window.updateSRSStatus = function() {
    if(!currentUser) return;
    const now = Date.now();
    const filter = document.getElementById('quizFilter').value;
    let pool = filter === 'ALL' ? cachedWords : cachedWords.filter(w => w.l === filter);
    
    dueWords = pool.filter(w => (w.nextReview || 0) <= now).sort((a,b) => a.nextReview - b.nextReview);
    document.getElementById('reviewStatus').innerHTML = dueWords.length > 0 
        ? `Cần ôn: <b class="due-badge">${dueWords.length}</b> từ` 
        : `<span style="color:var(--success)">Đã học xong!</span>`;
}

// Gắn hàm âm thanh từ file utils
window.speakCurrent = () => { if(currentQuizItem) speakText(currentQuizItem.w, currentQuizItem.l); }
window.speakText = speakText;

window.resetQuiz = function() { quizHistory = []; historyIndex = -1; isCramMode = false; window.nextQuestion(); }

window.nextQuestion = function() {
    if(!currentUser) return;
    if(historyIndex < quizHistory.length - 1) {
        historyIndex++; renderQuestion(quizHistory[historyIndex]); return;
    }
    window.updateSRSStatus();
    let questionItem;
    if (dueWords.length > 0) {
        isCramMode = false;
        const topN = dueWords.slice(0, 10);
        questionItem = topN[Math.floor(Math.random() * topN.length)];
    } else {
        if (!isCramMode) {
            document.getElementById('quizArea').style.display = 'none';
            document.getElementById('doneArea').style.display = 'block';
            document.getElementById('emptyArea').style.display = 'none';
            return;
        } else {
            const pool = document.getElementById('quizFilter').value === 'ALL' ? cachedWords : cachedWords.filter(x => x.l === document.getElementById('quizFilter').value);
            if (pool.length < 4) return window.showEmpty();
            questionItem = pool[Math.floor(Math.random() * pool.length)];
        }
    }
    if(!questionItem) return window.showEmpty();

    const pool = document.getElementById('quizFilter').value === 'ALL' ? cachedWords : cachedWords.filter(x => x.l === document.getElementById('quizFilter').value);
    if (pool.length < 4) return window.showEmpty();

    const distractors = pool.filter(x => x.id !== questionItem.id).sort(() => 0.5 - Math.random()).slice(0, 3);
    const options = [questionItem, ...distractors].sort(() => 0.5 - Math.random());

    const qData = { correct: questionItem, options: options, selectedId: null, isAnswered: false };
    quizHistory.push(qData); historyIndex++;
    
    document.getElementById('doneArea').style.display = 'none';
    document.getElementById('quizArea').style.display = 'block';
    document.getElementById('emptyArea').style.display = 'none';
    renderQuestion(qData);
}

window.prevQuestion = function() { if(historyIndex > 0) { historyIndex--; renderQuestion(quizHistory[historyIndex]); } }

function renderQuestion(q) {
    currentQuizItem = q.correct;
    document.getElementById('qWord').innerText = q.correct.w;
    
    const phoneticEl = document.getElementById('qPhonetic');
    phoneticEl.innerText = q.correct.p || "(Chưa có phiên âm)";
    q.isAnswered ? phoneticEl.classList.add('revealed') : phoneticEl.classList.remove('revealed');

    const grid = document.getElementById('qOptions');
    grid.innerHTML = ''; document.getElementById('qMsg').innerText = '';
    
    q.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'opt-btn'; btn.innerText = opt.m;
        btn.onclick = () => handleAnswer(btn, opt, q.correct);
        
        if (q.isAnswered) {
            btn.disabled = true;
            if (opt.id === q.correct.id) btn.classList.add('correct');
            if (opt.id === q.selectedId && q.selectedId !== q.correct.id) btn.classList.add('wrong');
        }
        grid.appendChild(btn);
    });

    document.getElementById('btnPrev').disabled = (historyIndex <= 0);
    if (q.isAnswered) {
        document.getElementById('btnNext').style.visibility = 'visible';
        document.getElementById('qMsg').innerHTML = (q.selectedId === q.correct.id) ? "<span style='color:var(--success)'>Chính xác! 🎉</span>" : "<span style='color:var(--danger)'>Sai rồi!</span>";
    } else { document.getElementById('btnNext').style.visibility = 'hidden'; }
}

async function handleAnswer(btn, selected, correct) {
    quizHistory[historyIndex].selectedId = selected.id;
    quizHistory[historyIndex].isAnswered = true;

    document.querySelectorAll('.opt-btn').forEach(b => b.disabled = true);
    document.getElementById('btnNext').style.visibility = 'visible';
    document.getElementById('qPhonetic').classList.add('revealed');
    
    speakText(correct.w, correct.l);

    const isCorrect = (selected.id === correct.id);
    if (isCorrect) {
        btn.classList.add('correct');
        document.getElementById('qMsg').innerHTML = "<span style='color:var(--success)'>Chính xác! 🎉</span>";
        if (!isCramMode) {
            const newLevel = (correct.level || 0) + 1;
            const nextDate = Date.now() + ((SRS_INTERVALS[newLevel] || 180) * 24 * 60 * 60 * 1000);
            await updateWordSRS(correct.id, newLevel, nextDate);
        }
    } else {
        btn.classList.add('wrong');
        document.querySelectorAll('.opt-btn').forEach(b => { if(b.innerText === correct.m) b.classList.add('correct'); });
        document.getElementById('qMsg').innerHTML = "<span style='color:var(--danger)'>Sai rồi!</span>";
        if (!isCramMode) await updateWordSRS(correct.id, 0, 0);
    }
}

async function updateWordSRS(id, newLevel, newNextReview) {
    try {
        await updateDoc(doc(db, "words", id), { level: newLevel, nextReview: newNextReview });
        const wordInRam = cachedWords.find(w => w.id === id);
        if (wordInRam) { wordInRam.level = newLevel; wordInRam.nextReview = newNextReview; }
        window.updateSRSStatus();
    } catch (error) { console.error("Lỗi đồng bộ SRS", error); }
}

window.forceReviewMode = function() { isCramMode = true; window.nextQuestion(); }
window.showEmpty = function() { document.getElementById('quizArea').style.display = 'none'; document.getElementById('emptyArea').style.display = 'block'; }

// 6. GIAO DIỆN & CÔNG CỤ
window.renderList = function() {
    const container = document.getElementById('listContainer');
    const search = document.getElementById('search').value.toLowerCase();
    container.innerHTML = '';
    
    let count = 0;
    for(const item of cachedWords) {
        if(count > 50 && !search) break;
        if(item.w.toLowerCase().includes(search) || item.m.toLowerCase().includes(search)) {
            const lvl = item.level || 0;
            let color = lvl > 4 ? '#22c55e' : lvl > 2 ? '#f59e0b' : lvl > 0 ? '#ef4444' : '#ccc';
            const isDue = (item.nextReview || 0) <= Date.now();
            const dateStr = (item.nextReview || 0) === 0 ? "Mới" : new Date(item.nextReview).toLocaleDateString('vi-VN', {day:'numeric', month:'numeric'});

            const div = document.createElement('div');
            div.className = 'vocab-item';
            div.innerHTML = `
                <div style="flex:1">
                    <div>
                        <span class="level-dot" style="background:${color}" title="Level ${lvl}"></span>
                        <span class="badge ${item.l}">${item.l}</span> <b>${item.w}</b> <small style="color:#666; font-style:italic">${item.p || ''}</small>
                        <button onclick="speakText('${item.w}', '${item.l}')" style="border:none;background:none;cursor:pointer">🔊</button>
                    </div>
                    <div style="font-size:0.9em; color:#64748b; margin-top:2px">
                        ${item.m} <span style="float:right; font-size:0.8em; color:${isDue?'red':'green'}">${isDue ? '⚡ Cần ôn' : '📅 ' + dateStr}</span>
                    </div>
                </div>
                <button onclick="deleteWord('${item.id}')" style="border:none;background:none;color:#999;cursor:pointer;margin-left:10px">✖</button>
            `;
            container.appendChild(div); count++;
        }
    }
}

window.importCSV = async function() {
    if(!currentUser) return alert("Cần đăng nhập!");
    const file = document.getElementById('csvFile').files[0];
    if(!file) return alert("Chưa chọn file!");
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const lines = e.target.result.split(/\r\n|\n/);
        let newItems = [];
        lines.forEach(line => {
            const parts = line.split(',');
            if(parts.length >= 2 && !parts[0].toLowerCase().includes('tuvung')) {
                const w = parts[0].trim(), m = parts[1].trim(), l = parts[2]?.trim().toUpperCase() || 'EN', ph = parts[3] ? parts[3].trim() : ""; 
                if(w && m && !cachedWords.some(x => x.w.toLowerCase() === w.toLowerCase() && x.l === l) && !newItems.some(x => x.w.toLowerCase() === w.toLowerCase() && x.l === l)) {
                    newItems.push({ w, m, l, p: ph, level: 0, nextReview: 0, userId: currentUser.uid });
                }
            }
        });
        
        if(newItems.length > 0) {
            document.getElementById('csvFile').value = ''; 
            alert(`Đang nạp ${newItems.length} từ...`);
            const batch = writeBatch(db);
            newItems.forEach(item => batch.set(doc(collection(db, "words")), item));
            await batch.commit();
            alert("✅ Đã nạp thành công!"); loadDataFromCloud();
        } else { alert("Không có từ mới!"); }
    };
    reader.readAsText(file);
}

// Gắn các hàm Utils vào window để HTML gọi được
window.exportJSON = () => exportJSON(cachedWords);
window.downloadSample = downloadSample;

window.switchTab = function(id) {
    document.querySelectorAll('.content, .tab-btn').forEach(e => e.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.querySelector(`button[onclick="switchTab('${id}')"]`).classList.add('active');
    if(id==='list') window.renderList();
}