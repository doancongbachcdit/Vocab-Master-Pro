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

// 3. LOGIC DOM & SỰ KIỆN KHỞI TẠO
document.addEventListener('DOMContentLoaded', () => {
    // Auth Event Listeners
    document.getElementById('btnLogin').addEventListener('click', () => {
        signInWithPopup(auth, new GoogleAuthProvider()).catch(err => alert("Lỗi: " + err.message));
    });
    
    document.getElementById('btnLogout').addEventListener('click', () => {
        signOut(auth);
    });

    // Navigation and Tabs
    const mainTabs = document.getElementById('mainTabs');
    if (mainTabs) {
        mainTabs.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-btn')) {
                const tabId = e.target.getAttribute('data-tab');
                switchTab(tabId);
            }
        });
    }

    // Quiz Elements
    document.getElementById('quizFilter').addEventListener('change', resetQuiz);
    document.getElementById('qWord').addEventListener('click', speakCurrent);
    document.getElementById('btnSpeak').addEventListener('click', speakCurrent);
    document.getElementById('qPhonetic').addEventListener('click', (e) => e.target.classList.add('revealed'));
    document.getElementById('btnPrev').addEventListener('click', prevQuestion);
    document.getElementById('btnNext').addEventListener('click', nextQuestion);
    document.getElementById('btnForceReview').addEventListener('click', forceReviewMode);
    document.getElementById('btnGoToData').addEventListener('click', () => switchTab('data'));
    
    // Data Elements
    document.getElementById('btnAddWord').addEventListener('click', addWord);
    // Ẩn/Hiện 3 ô Giải phẫu từ tùy theo ngôn ngữ (EN / CN)
    const inpLangEl = document.getElementById('inpLang');
    if (inpLangEl) {
        inpLangEl.addEventListener('change', (e) => {
            const anatomyDiv = document.getElementById('englishAnatomy');
            if (anatomyDiv) {
                // Nếu là EN thì hiện (flex), nếu là CN thì ẩn (none)
                anatomyDiv.style.display = (e.target.value === 'EN') ? 'flex' : 'none';
            }
        });
    }
    document.getElementById('btnDownloadSample').addEventListener('click', downloadSample);
    document.getElementById('btnImportCSV').addEventListener('click', importCSV);
    document.getElementById('btnExportJSON').addEventListener('click', () => exportJSON(cachedWords));

    // List Search Element
    const searchInput = document.getElementById('search');
    searchInput.addEventListener('input', renderList);

    // Event Delegation cho Quiz Options
    document.getElementById('qOptions').addEventListener('click', (e) => {
        if(e.target.classList.contains('opt-btn') && !e.target.disabled) {
            const optId = e.target.getAttribute('data-id');
            const qData = quizHistory[historyIndex];
            const selectedOpt = qData.options.find(opt => opt.id === optId);
            if (selectedOpt) {
                handleAnswer(e.target, selectedOpt, qData.correct);
            }
        }
    });

    // Event Delegation cho List Container (Âm thanh và Xóa)
    document.getElementById('listContainer').addEventListener('click', (e) => {
        const speakBtn = e.target.closest('.btn-list-speak');
        const deleteBtn = e.target.closest('.btn-list-delete');
        
        if (speakBtn) {
            const w = speakBtn.getAttribute('data-w');
            const l = speakBtn.getAttribute('data-l');
            const ex = speakBtn.getAttribute('data-ex'); // Lấy câu ví dụ
            speakText(w, l, ex); // Truyền sang utils.js
        } else if (deleteBtn) {
            const id = deleteBtn.getAttribute('data-id');
            deleteWord(id);
        }
    });
});

// 4. LOGIC ĐĂNG NHẬP
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
        renderList();
    }
});

// 5. DATABASE FIREBASE
async function loadDataFromCloud() {
    document.getElementById('reviewStatus').innerHTML = "⏳ Đang đồng bộ mây...";
    try {
        const q = query(collection(db, "words"), where("userId", "==", currentUser.uid));
        const snap = await getDocs(q);
        cachedWords = [];
        snap.forEach(doc => cachedWords.push({ id: doc.id, ...doc.data() }));
        
        updateSRSStatus();
        if(document.getElementById('list').classList.contains('active')) renderList();
        if(document.getElementById('quiz').classList.contains('active')) resetQuiz();
    } catch (error) { alert("Lỗi tải dữ liệu: " + error.message); }
}

async function addWord() {
    if(!currentUser) return alert("Đăng nhập để lưu từ!");
    const w = document.getElementById('inpWord').value.trim();
    const m = document.getElementById('inpMeaning').value.trim();
    const p = document.getElementById('inpPhonetic').value.trim();
    const l = document.getElementById('inpLang').value;
    
    // Lấy thêm dữ liệu giải phẫu & ví dụ (nếu người dùng có nhập)
    const prf = document.getElementById('inpPrefix')?.value.trim() || "";
    const rt = document.getElementById('inpRoot')?.value.trim() || "";
    const suf = document.getElementById('inpSuffix')?.value.trim() || "";
    const ex = document.getElementById('inpExample')?.value.trim() || "";

    // 🛑 KIỂM TRA CHẶN DẤU PHẨY (Bảo vệ dữ liệu CSV)
    if (ex.includes(',')) {
        return alert("⚠️ Lỗi: Vui lòng không dùng dấu phẩy (,) trong câu ví dụ. Thay vào đó hãy dùng dấu chấm (.) hoặc dấu chấm phẩy (;)");
    }
    if (w.includes(',') || m.includes(',')) {
        return alert("⚠️ Lỗi: Vui lòng không dùng dấu phẩy (,) trong Từ vựng và Nghĩa.");
    }
    
    if(!w || !m) return alert("Thiếu từ hoặc nghĩa!");
    
    if(!w || !m) return alert("Thiếu từ hoặc nghĩa!");
    if (cachedWords.some(item => item.w.toLowerCase() === w.toLowerCase() && item.l === l)) return alert(`Từ "${w}" đã tồn tại!`);

    const newItem = { 
        w, m, l, p, 
        prf, rt, suf, ex, // Đẩy các trường mới này lên Firebase
        level: 0, nextReview: 0, userId: currentUser.uid 
    };

    try {
        document.getElementById('addStatus').innerText = "Đang lưu...";
        const docRef = await addDoc(collection(db, "words"), newItem);
        cachedWords.unshift({ id: docRef.id, ...newItem }); 
        
        // Reset sạch các ô nhập liệu
        ['inpWord', 'inpMeaning', 'inpPhonetic', 'inpPrefix', 'inpRoot', 'inpSuffix', 'inpExample'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.value = '';
        });
        document.getElementById('inpWord').focus();
        
        document.getElementById('addStatus').innerText = "✅ Đã lưu!";
        setTimeout(()=>document.getElementById('addStatus').innerText="", 2000);
        updateSRSStatus();
    } catch (e) { alert("Lỗi: " + e.message); }
}

async function deleteWord(id) {
    if(confirm("Xóa vĩnh viễn?")) { 
        try {
            await deleteDoc(doc(db, "words", id));
            cachedWords = cachedWords.filter(x => x.id !== id);
            renderList(); 
            updateSRSStatus(); 
        } catch (e) { alert("Lỗi xóa!"); }
    }
}

// 6. QUIZ VÀ SRS
function updateSRSStatus() {
    if(!currentUser) return;
    const now = Date.now();
    const filter = document.getElementById('quizFilter').value;
    let pool = filter === 'ALL' ? cachedWords : cachedWords.filter(w => w.l === filter);
    
    dueWords = pool.filter(w => (w.nextReview || 0) <= now).sort((a,b) => a.nextReview - b.nextReview);
    document.getElementById('reviewStatus').innerHTML = dueWords.length > 0 
        ? `Cần ôn: <b class="due-badge">${dueWords.length}</b> từ` 
        : `<span style="color:var(--success)">Đã học xong!</span>`;
    // Cập nhật thanh tiến độ 300 từ (Chỉ tính những từ có level > 0 tức là đã học ít nhất 1 lần)
    const learnedCount = cachedWords.filter(w => (w.level || 0) > 0).length;
    const percent = Math.min((learnedCount / 300) * 100, 100);
    const pb = document.getElementById('progressBar');
    const pt = document.getElementById('progressText');
    if (pb) pb.style.width = percent + '%';
    if (pt) pt.innerText = `${learnedCount}/300`;
}

function speakCurrent() { 
    if(currentQuizItem) speakText(currentQuizItem.w, currentQuizItem.l, currentQuizItem.ex); 
}

function resetQuiz() { quizHistory = []; historyIndex = -1; isCramMode = false; nextQuestion(); }

function nextQuestion() {
    if(!currentUser) return;
    if(historyIndex < quizHistory.length - 1) {
        historyIndex++; renderQuestion(quizHistory[historyIndex]); return;
    }
    updateSRSStatus();
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
            
            // 🛑 TÍCH HỢP AI TẠO CÂU HỎI THỰC CHIẾN
            const qContainer = document.getElementById('practicalQuestions');
            qContainer.innerHTML = '<p style="color: #64748b;">🤖 AI đang suy nghĩ câu hỏi riêng cho bạn...</p>';
            
            // 1. Lấy ra tối đa 3 từ để hỏi
            // Ưu tiên các từ vừa học trong phiên này (quizHistory)
            let targetWords = [...new Set(quizHistory.map(q => q.correct))].sort(() => 0.5 - Math.random()).slice(0, 3);
            
            // 💡 CẬP NHẬT MỚI: Nếu phiên này rỗng (vào app đã thấy học xong), 
            // bốc ngẫu nhiên 3 từ đã từng học (level > 0) trong quá khứ để hỏi.
            if (targetWords.length === 0) {
                const learnedWords = cachedWords.filter(w => (w.level || 0) > 0);
                targetWords = [...learnedWords].sort(() => 0.5 - Math.random()).slice(0, 3);
            }

            if (targetWords.length > 0) {
                const wordList = targetWords.map(item => item.w).join(', ');
                
                // 2. KEY CỦA BẠN (Đã giữ nguyên)
                const GEMINI_API_KEY = "AIzaSyCpK_2VqRaeCvHdnvE6CwCXw3jID_PRtRc"; 
                
                // 3. Ra lệnh cho AI (Prompt)
                const prompt = `Bây giờ bạn là gia sư tiếng Anh của Bách. Bách vừa ôn tập các từ vựng sau: ${wordList}. Hãy tạo ra đúng ${targetWords.length} câu hỏi giao tiếp bằng tiếng Anh thật đơn giản, ngắn gọn để Bách luyện trả lời. Mỗi câu BẮT BUỘC phải chứa 1 từ trong danh sách trên. Chỉ in ra các câu hỏi, mỗi câu 1 dòng, tuyệt đối không in thêm bất kỳ chữ nào khác.`;

                // 4. Gọi API
                fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                })
                .then(async response => {
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error?.message || "Lỗi máy chủ Google API");
                    return data;
                })
                .then(data => {
                    if (!data.candidates || !data.candidates[0]) throw new Error("AI không trả về kết quả.");
                    
                    const aiText = data.candidates[0].content.parts[0].text;
                    const questions = aiText.split('\n').filter(q => q.trim().length > 0);
                    
                    qContainer.innerHTML = ''; 
                    questions.forEach((q, idx) => {
                         qContainer.innerHTML += `
                            <div style="background: #f1f5f9; padding: 10px; border-radius: 8px; margin-bottom: 10px; text-align: left;">
                                <b style="color: var(--primary)">Q${idx + 1}:</b> ${q}
                                <textarea placeholder="Gõ câu trả lời bằng tiếng Anh để luyện tập..." style="width:100%; margin-top:5px; padding:8px; border:1px solid #cbd5e1; border-radius:5px; font-family:inherit; resize:vertical;"></textarea>
                            </div>`;
                    });
                })
                .catch(err => {
                    console.error("Chi tiết lỗi AI:", err);
                    qContainer.innerHTML = `<p style="color: red;">❌ Kết nối AI thất bại: ${err.message}</p>`;
                });
            } else {
                // Xử lý triệt để: Nếu tài khoản mới tinh chưa từng học từ nào bao giờ
                qContainer.innerHTML = '<p style="color: #64748b;">Bạn chưa học từ vựng nào. Hãy thêm từ và làm bài tập để AI có thể tạo câu hỏi nhé!</p>';
            }
            return;
        } else {
            const pool = document.getElementById('quizFilter').value === 'ALL' ? cachedWords : cachedWords.filter(x => x.l === document.getElementById('quizFilter').value);
            if (pool.length < 4) return showEmpty();
            questionItem = pool[Math.floor(Math.random() * pool.length)];
        }
    }
    if(!questionItem) return showEmpty();

    const pool = document.getElementById('quizFilter').value === 'ALL' ? cachedWords : cachedWords.filter(x => x.l === document.getElementById('quizFilter').value);
    if (pool.length < 4) return showEmpty();

    const distractors = pool.filter(x => x.id !== questionItem.id).sort(() => 0.5 - Math.random()).slice(0, 3);
    const options = [questionItem, ...distractors].sort(() => 0.5 - Math.random());

    const qData = { correct: questionItem, options: options, selectedId: null, isAnswered: false };
    quizHistory.push(qData); historyIndex++;
    
    document.getElementById('doneArea').style.display = 'none';
    document.getElementById('quizArea').style.display = 'block';
    document.getElementById('emptyArea').style.display = 'none';
    renderQuestion(qData);
}

function prevQuestion() { if(historyIndex > 0) { historyIndex--; renderQuestion(quizHistory[historyIndex]); } }

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
        btn.className = 'opt-btn'; 
        btn.innerText = opt.m;
        btn.setAttribute('data-id', opt.id); // For event delegation
        
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
        // Because of event delegation, we re-find the correct button to style it
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
        updateSRSStatus();
    } catch (error) { console.error("Lỗi đồng bộ SRS", error); }
}

function forceReviewMode() { isCramMode = true; nextQuestion(); }
function showEmpty() { document.getElementById('quizArea').style.display = 'none'; document.getElementById('emptyArea').style.display = 'block'; }

// 7. GIAO DIỆN & CÔNG CỤ
// Adding debounce to renderList to optimize search input processing
let listRenderTimeout;
function renderList() {
    clearTimeout(listRenderTimeout);
    listRenderTimeout = setTimeout(() => {
        const container = document.getElementById('listContainer');
        const searchInputEl = document.getElementById('search');
        if (!container || !searchInputEl) return;
        const search = searchInputEl.value.toLowerCase();
        container.innerHTML = '';
        
        // Optimize DOM manipulation using DocumentFragment
        const fragment = document.createDocumentFragment();
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
                            <button class="btn-list-speak" data-w="${item.w}" data-l="${item.l}" data-ex="${item.ex || ''}" style="border:none;background:none;cursor:pointer">🔊</button>
                        </div>
                        <div style="font-size:0.9em; color:#64748b; margin-top:2px">
                            ${item.m} <span style="float:right; font-size:0.8em; color:${isDue?'red':'green'}">${isDue ? '⚡ Cần ôn' : '📅 ' + dateStr}</span>
                        </div>
                    </div>
                    <button class="btn-list-delete" data-id="${item.id}" style="border:none;background:none;color:#999;cursor:pointer;margin-left:10px">✖</button>
                `;
                fragment.appendChild(div); count++;
            }
        }
        container.appendChild(fragment);
    }, 150); // debounce delay
}

async function importCSV() {
    if(!currentUser) return alert("Cần đăng nhập!");
    const file = document.getElementById('csvFile').files[0];
    if(!file) return alert("Chưa chọn file!");
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const lines = e.target.result.split(/\r\n|\n/);
        let newItems = [];
        lines.forEach(line => {
            // Tách các cột dựa vào dấu phẩy
            const parts = line.split(',');
            
            // Đảm bảo dòng có dữ liệu và không phải dòng tiêu đề
            if(parts.length >= 2 && !parts[0].toLowerCase().includes('tuvung')) {
                const w = parts[0]?.trim() || ""; 
                const m = parts[1]?.trim() || ""; 
                const l = parts[2]?.trim().toUpperCase() || 'EN'; 
                const ph = parts[3]?.trim() || ""; 
                
                // Đọc thêm 4 cột mới (Giải phẫu từ & Ví dụ)
                const prf = parts[4]?.trim() || "";
                const rt = parts[5]?.trim() || "";
                const suf = parts[6]?.trim() || "";
                const ex = parts[7]?.trim() || "";

                // Kiểm tra điều kiện: Có từ, có nghĩa và không bị trùng lặp
                if(w && m && !cachedWords.some(x => x.w.toLowerCase() === w.toLowerCase() && x.l === l) && !newItems.some(x => x.w.toLowerCase() === w.toLowerCase() && x.l === l)) {
                    // Đẩy TẤT CẢ dữ liệu vào mảng
                    newItems.push({ w, m, l, p: ph, prf, rt, suf, ex, level: 0, nextReview: 0, userId: currentUser.uid });
                }
            }
        });
        
        if(newItems.length > 0) {
            document.getElementById('csvFile').value = ''; 
            alert(`Đang nạp ${newItems.length} từ lên mây...`);
            const batch = writeBatch(db);
            newItems.forEach(item => batch.set(doc(collection(db, "words")), item));
            await batch.commit();
            alert("✅ Đã nạp thành công!"); 
            loadDataFromCloud();
        } else { 
            alert("Không có từ mới nào được nạp (hoặc tất cả đều bị trùng)!"); 
        }
    };
    reader.readAsText(file);
}

function switchTab(id) {
    document.querySelectorAll('.content, .tab-btn').forEach(e => e.classList.remove('active'));
    const targetContent = document.getElementById(id);
    if (targetContent) targetContent.classList.add('active');
    
    const targetBtn = document.querySelector(`button[data-tab="${id}"]`);
    if (targetBtn) targetBtn.classList.add('active');
    
    if(id==='list') renderList();
}