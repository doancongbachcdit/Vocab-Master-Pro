// Hàm đọc âm thanh
export function speakText(text, lang) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = (lang === 'CN') ? 'zh-CN' : 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
}

// Hàm tải file mẫu Excel
export function downloadSample() { 
    const c = "\uFEFFTuVung,Nghia,NgonNgu(EN/CN),PhienAm\nHello,Xin chào,EN,/həˈloʊ/\n你好,Xin chào,CN,nǐ hǎo"; 
    const b = new Blob([c],{type:'text/csv;charset=utf-8;'}); 
    const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download="Mau_Moi.csv"; a.click();
}

// Hàm tải file Backup
export function exportJSON(cachedWords) {
    const b = new Blob([JSON.stringify(cachedWords)],{type:"application/json"});
    const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download=`Backup_Cloud_${Date.now()}.json`; a.click();
}