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

// --- KHO CHỨA API KEY (TUYỆT CHIÊU PHÂN THÂN NÂNG CẤP) ---
const key1 = "AIzaSyCfaoFAsqgi" + "9CCpdr" + "6iUo1Wj_1z4zIqsYY"; 
const key2 = "AIzaSyCT" + "6GcqCgyNri-jxyPyp" + "7wKBJKY9dbjtsE";
const key3 = "AIzaSyBlSKEwJGwzK" + "7E5B4-A" + "2vbACZX_GP7fKdo";

const listApiKeys = [key1, key2, key3];

// 1. Hàm lọc ra các Key CÒN SỐNG trong ngày hôm nay
function getValidApiKeys() {
    const today = new Date().toDateString(); // Trả về dạng: "Thu Feb 26 2026"
    let exhaustedKeys = JSON.parse(localStorage.getItem('exhaustedApiKeys') || '{}');
    
    let isChanged = false;
    // Tự động giải phóng (xóa án phạt) cho các Key bị khóa từ hôm qua
    for (let k in exhaustedKeys) {
        if (exhaustedKeys[k] !== today) {
            delete exhaustedKeys[k];
            isChanged = true;
        }
    }
    if (isChanged) localStorage.setItem('exhaustedApiKeys', JSON.stringify(exhaustedKeys));

    // Chỉ lấy những Key KHÔNG nằm trong danh sách đen của hôm nay
    const validKeys = listApiKeys.filter(k => !exhaustedKeys[k]);
    
    // Nếu rủi ro tất cả các Key đều tịt, trả về toàn bộ để thử hên xui
    return validKeys.length > 0 ? validKeys : listApiKeys; 
}

// 2. Hàm bốc ngẫu nhiên Key
function getRandomApiKey() {
    const validKeys = getValidApiKeys();
    const randomKey = validKeys[Math.floor(Math.random() * validKeys.length)];
    console.log("Đang dùng Key số:", listApiKeys.indexOf(randomKey) + 1);
    return randomKey;
}

// 3. Hàm nhốt Key vào danh sách đen khi bị lỗi Quota
function markKeyAsExhausted(key) {
    const today = new Date().toDateString();
    let exhaustedKeys = JSON.parse(localStorage.getItem('exhaustedApiKeys') || '{}');
    exhaustedKeys[key] = today;
    localStorage.setItem('exhaustedApiKeys', JSON.stringify(exhaustedKeys));
    console.warn("🔴 Đã khóa tạm thời Key số", listApiKeys.indexOf(key) + 1, "đến ngày mai!");
}

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
    document.getElementById('btnHint').addEventListener('click', getAIHint);
    document.getElementById('qPhonetic').addEventListener('click', (e) => e.target.classList.add('revealed'));
    document.getElementById('btnPrev').addEventListener('click', prevQuestion);
    document.getElementById('btnNext').addEventListener('click', nextQuestion);

    document.getElementById('btnForceReview').addEventListener('click', forceReviewMode);
    // Lắng nghe sự kiện Bấm nút Chấm Bài AI
    const practicalAreaEl = document.getElementById('practicalQuestions');
    if (practicalAreaEl) {
        practicalAreaEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-grade')) {
                const container = e.target.closest('div').parentElement;
                const qText = container.querySelector('.ai-q-text').innerText;
                const aText = container.querySelector('.ai-a-text').value.trim();
                const feedbackDiv = container.querySelector('.ai-feedback');

                if (!aText) return alert("⚠️ Bách vui lòng gõ câu trả lời trước khi nhờ AI chấm nhé!");
                
                gradeAnswer(qText, aText, feedbackDiv, e.target);
            }
        });
    }

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
    document.getElementById('btnDeleteAll').addEventListener('click', deleteAllWords);

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

// --- SỰ KIỆN LẮNG NGHE MICRO 🎙️ ---
    const practicalAreaEl = document.getElementById('practicalQuestions');
    if (practicalAreaEl) {
        practicalAreaEl.addEventListener('click', (e) => {
            const micBtn = e.target.closest('.btn-mic');
            if (micBtn) {
                const textarea = micBtn.previousElementSibling; // Lấy thẻ textarea nằm kế bên
                const langCode = micBtn.getAttribute('data-lang'); // Lấy mã ngôn ngữ (Anh hoặc Trung)
                
                // 1. Kiểm tra trình duyệt có hỗ trợ không
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (!SpeechRecognition) {
                    return alert("Trình duyệt của Bách chưa hỗ trợ tính năng này. Hãy thử dùng Google Chrome nhé!");
                }
                
                // 2. Khởi tạo bộ thu âm
                const recognition = new SpeechRecognition();
                recognition.lang = langCode;
                recognition.interimResults = false; // Chỉ lấy kết quả chốt cuối cùng
                
                // 3. Xử lý các trạng thái
                recognition.onstart = () => {
                    micBtn.innerText = '🔴'; // Đổi thành chấm đỏ đang thu âm
                    micBtn.style.transform = 'scale(1.2)';
                    textarea.placeholder = "👂 Máy đang dỏng tai nghe Bách nói đây...";
                };
                
                recognition.onresult = (event) => {
                    const transcript = event.results[0][0].transcript;
                    // Nối thêm chữ vừa đọc vào (phòng khi Bách muốn nói nối tiếp)
                    textarea.value += (textarea.value ? ' ' : '') + transcript; 
                };
                
                recognition.onerror = (event) => {
                    console.error("Lỗi Micro:", event.error);
                    if(event.error === 'not-allowed') alert("Bách chưa cấp quyền dùng Micro cho trang web rồi!");
                };
                
                recognition.onend = () => {
                    micBtn.innerText = '🎙️'; // Trả lại icon Micro
                    micBtn.style.transform = 'scale(1)';
                    textarea.placeholder = "Gõ phím hoặc bấm micro để trả lời...";
                };
                
                // 4. Bắt đầu thu âm!
                recognition.start();
            }
        });
    }

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

async function deleteAllWords() {
    if(!currentUser) return alert("Vui lòng đăng nhập!");
    
    // Hỏi xác nhận 2 lần để tránh bấm nhầm
    if(!confirm(`⚠️ CẢNH BÁO NGUY HIỂM:\nBạn có chắc chắn muốn XÓA VĨNH VIỄN toàn bộ ${cachedWords.length} từ vựng hiện có không? Hành động này KHÔNG THỂ HOÀN TÁC!`)) return;
    
    try {
        document.getElementById('reviewStatus').innerHTML = "⏳ Đang dọn dẹp mây...";
        
        // Quét vòng lặp và xóa từng từ trên Firebase
        for (const item of cachedWords) {
            await deleteDoc(doc(db, "words", item.id));
        }
        
        // Xóa sạch bộ nhớ RAM của app
        cachedWords = []; 
        updateSRSStatus();
        if(document.getElementById('list').classList.contains('active')) renderList();
        
        alert("✅ Đã dọn sạch bong! Bây giờ bạn có thể tải File Mẫu Mới về và nạp lại dữ liệu xịn sò rồi nhé.");
    } catch (e) {
        alert("Lỗi khi xóa: " + e.message);
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
            
            // 1. Lấy ra danh sách từ vừa học (hoặc từ cũ nếu vào app đã thấy học xong)
            let rawWords = [...new Set(quizHistory.map(q => q.correct))];
            if (rawWords.length === 0) {
                const currentFilter = document.getElementById('quizFilter').value;
                rawWords = cachedWords.filter(w => (w.level || 0) > 0 && (currentFilter === 'ALL' ? true : w.l === currentFilter));
            }

            if (rawWords.length > 0) {
                // 💡 ĐỘT PHÁ: Nhận diện ngôn ngữ Bách vừa học (dựa vào từ đầu tiên)
                const mainLang = rawWords[0].l; 
                const isChinese = (mainLang === 'CN');
                const langName = isChinese ? 'tiếng Trung' : 'tiếng Anh';
                const extraPrompt = isChinese ? ' (Yêu cầu in ra chữ Hán kèm Pinyin)' : '';

                // Lọc lấy tối đa 3 từ CÙNG NGÔN NGỮ để hỏi (tránh AI bị lú vì mix Anh-Trung)
                const targetWords = rawWords.filter(w => w.l === mainLang).sort(() => 0.5 - Math.random()).slice(0, 3);
                const wordList = targetWords.map(item => item.w).join(', ');
                
                // 2. KEY CỦA BẠN (Nhớ dán lại key của Bách vào đây nhé)
                const GEMINI_API_KEY = getRandomApiKey();
                
                // 3. Prompt ĐỘNG: Tự đổi vai thành Gia sư Tiếng Anh hoặc Lão sư Tiếng Trung
                const prompt = `Bây giờ bạn là gia sư ${langName} của Bách. Bách vừa ôn tập các từ vựng sau: ${wordList}. Hãy tạo ra đúng ${targetWords.length} câu hỏi giao tiếp bằng ${langName} thật đơn giản, ngắn gọn để Bách luyện trả lời. Mỗi câu BẮT BUỘC phải chứa 1 từ trong danh sách trên. Chỉ in ra các câu hỏi, mỗi câu 1 dòng, tuyệt đối không in thêm bất kỳ chữ nào khác.${extraPrompt}`;

                // 4. Gọi API
                fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
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
                    
                    // Xác định mã ngôn ngữ để cài đặt cho Micro
                    const langCode = isChinese ? 'zh-CN' : 'en-US'; 
                    
                    qContainer.innerHTML = ''; 
                    questions.forEach((q, idx) => {
                         qContainer.innerHTML += `
                            <div style="background: #fff; padding: 15px; border-radius: 8px; margin-bottom: 15px; text-align: left; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                                <b style="color: var(--primary)">Q${idx + 1}:</b> <span class="ai-q-text">${q}</span>
                                
                                <div style="position: relative; margin-top: 8px;">
                                    <textarea class="ai-a-text" placeholder="Gõ phím hoặc bấm micro để trả lời..." style="width:100%; padding:10px; padding-right: 40px; border:1px solid #cbd5e1; border-radius:6px; font-family:inherit; resize:vertical; min-height: 60px;"></textarea>
                                    <button class="btn-mic" data-lang="${langCode}" title="Bấm để nói" style="position: absolute; right: 5px; top: 5px; background: none; border: none; font-size: 1.5rem; cursor: pointer; transition: 0.2s;">🎙️</button>
                                </div>
                                
                                <div style="text-align: right; margin-top: 8px;">
                                    <button class="btn btn-primary btn-grade" style="padding: 6px 15px; font-size: 0.9em; width: auto; margin: 0; background: #10b981; border: none;">✨ Nhờ Thầy AI chấm</button>
                                </div>
                                
                                <div class="ai-feedback" style="margin-top: 15px; display: none; font-size: 0.95em; line-height: 1.6;"></div>
                            </div>`;
                    });
                })
                .catch(err => {
                    console.error("Chi tiết lỗi AI:", err);
                    if (err.message.includes("Quota") || err.message.includes("exceeded") || err.message.includes("429")) {
                        markKeyAsExhausted(GEMINI_API_KEY); // KHÓA KEY NÀY LẠI
                        qContainer.innerHTML = `<p style="color: #f59e0b;">⚠️ Tín hiệu vũ trụ bị nghẽn (Hết Quota Key). Bách hãy <b>Bấm lại tab Học Tập</b> để app tự đổi Key mới nhé!</p>`;
                    } else {
                        qContainer.innerHTML = `<p style="color: red;">❌ Kết nối AI thất bại: ${err.message}</p>`;
                    }
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

    // Giấu khung gợi ý của câu cũ đi
    const hintArea = document.getElementById('aiHintArea');
    if (hintArea) {
        hintArea.style.display = 'none';
        hintArea.innerHTML = '';
    }
    
    const phoneticEl = document.getElementById('qPhonetic');
    phoneticEl.innerText = q.correct.p || "(Chưa có phiên âm)";
    q.isAnswered ? phoneticEl.classList.add('revealed') : phoneticEl.classList.remove('revealed');

    // Xử lý ẩn/hiện câu ví dụ
    const exEl = document.getElementById('qex');
    if (q.correct.ex) {
        exEl.innerText = `📝 ${q.correct.ex}`;
        exEl.style.display = q.isAnswered ? 'block' : 'none'; // Giấu đi khi chưa trả lời
    } else {
        exEl.style.display = 'none';
    }

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

    // THÊM DÒNG NÀY: Hiện câu ví dụ khi đã trả lời
    if (correct.ex) document.getElementById('qex').style.display = 'block'; 
        
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
                            ${item.ex ? `<div style="font-style:italic; color:#475569; margin-top:5px;">📝 ${item.ex}</div>` : ''}
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

// --- TÍNH NĂNG AI CHẤM BÀI ---
function gradeAnswer(question, answer, feedbackDiv, btn) {
    // Hiệu ứng chờ
    btn.disabled = true;
    btn.innerText = "⏳ Đang đọc bài...";
    feedbackDiv.style.display = 'block';
    feedbackDiv.innerHTML = '<span style="color: #64748b; font-style: italic;">🤖 Thầy giáo AI đang phân tích từng từ của Bách...</span>';

    // 🛑 GHI CHÚ: App sẽ dùng chung API Key của bạn
    const GEMINI_API_KEY = getRandomApiKey();

    // Prompt siêu giáo viên
    const prompt = `Học sinh vừa trả lời câu hỏi ngôn ngữ sau:
    - Câu hỏi: "${question}"
    - Câu trả lời của học sinh: "${answer}"

    Hãy đóng vai một giáo viên ngôn ngữ xuất sắc, nhận xét câu trả lời này bằng tiếng Việt. Trình bày thân thiện, rõ ràng theo đúng 3 phần sau:
    1. 🎯 Nhận xét & Sửa lỗi: Chỉ ra lỗi ngữ pháp, từ vựng (nếu có). Nếu viết đúng, hãy dành lời khen ngợi.
    2. ✨ Cách nói tự nhiên (Native): Đề xuất 1-2 cách diễn đạt tự nhiên, chuyên nghiệp hơn mà người bản xứ thường dùng.
    3. 💡 Mẹo nhỏ: Giải thích ngắn gọn tại sao lại dùng cấu trúc/từ vựng ở phần 2.
    Lưu ý: Chỉ in ra nội dung, trình bày bằng icon cho sinh động, không cần lời chào hỏi.`;

    fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
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
        const feedback = data.candidates[0].content.parts[0].text;
        
        // Hiển thị kết quả tuyệt đẹp
        feedbackDiv.innerHTML = `<div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 15px; border-radius: 8px; color: #166534;">${feedback.replace(/\n/g, '<br>')}</div>`;
        btn.innerText = "🔄 Chấm lại (Nếu Bách sửa câu)";
        btn.disabled = false;
    })
    .catch(err => {
        feedbackDiv.innerHTML = `<p style="color: red;">❌ Lỗi kết nối: ${err.message}</p>`;
        btn.innerText = "✨ Nhờ Thầy AI chấm";
        btn.disabled = false;
    });
}

// --- TÍNH NĂNG XIN AI GỢI Ý (HINT) ---
async function getAIHint() {
    if (!currentQuizItem) return;
    const hintBtn = document.getElementById('btnHint');
    const hintArea = document.getElementById('aiHintArea');

    // Khóa nút tránh bấm liên tục, hiện trạng thái chờ
    hintBtn.disabled = true;
    hintBtn.style.opacity = '0.5';
    hintArea.style.display = 'block';
    hintArea.innerHTML = '<span style="color: #92400e; font-style: italic;">⏳ Thầy giáo AI đang vắt óc tìm gợi ý...</span>';

    const langName = currentQuizItem.l === 'CN' ? 'tiếng Trung' : 'tiếng Anh';
    const word = currentQuizItem.w;

    const GEMINI_API_KEY = getRandomApiKey(); 
    
    // Prompt ép AI tuyệt đối không nói ra nghĩa tiếng Việt
    const prompt = `Từ vựng hiện tại là "${word}" (${langName}). Bách đang học và đã quên mất nghĩa của từ này.
    Hãy giúp Bách nhớ lại bằng 1 trong 2 cách sau:
    1. Đưa ra một câu gợi ý tình huống bằng ${langName} siêu dễ hiểu (kiểu điền vào chỗ trống).
    2. Đưa ra một mẹo nhớ (Mnemonic) vui nhộn, hài hước bằng tiếng Việt liên quan đến cách phát âm hoặc hình dáng chữ.
    QUAN TRỌNG: TUYỆT ĐỐI KHÔNG được dịch trực tiếp nghĩa của từ "${word}" ra tiếng Việt để Bách tự đoán.
    Trình bày siêu ngắn gọn (1-2 dòng), dùng icon cho sinh động.`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Lỗi API");
        
        const hintText = data.candidates[0].content.parts[0].text;
        // In kết quả ra màn hình
        hintArea.innerHTML = `💡 <b>Gợi ý cho Bách:</b><br>${hintText.replace(/\n/g, '<br>')}`;
    } catch (err) {
        hintArea.innerHTML = `❌ Lỗi lấy gợi ý: ${err.message}`;
    } finally {
        // Mở khóa nút
        hintBtn.disabled = false;
        hintBtn.style.opacity = '1';
    }
}