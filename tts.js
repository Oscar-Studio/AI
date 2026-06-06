// =====================================================
// AI Studio — TTS module
//   基于小米 MiMo 开放平台
//   三 tab：内置音色 / 声音定制 / 声音克隆
// =====================================================

(function () {
    'use strict';

    const API_URL = 'https://api.oscarstudio.cn/api/tts';
    const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

    // ---- DOM ----
    const tabs           = document.querySelectorAll('.tts-tab');
    const panels         = document.querySelectorAll('.tts-panel');
    const generateBtn    = document.getElementById('ttsGenerateBtn');
    const statusEl       = document.getElementById('ttsStatus');
    const audioPlayer    = document.getElementById('ttsAudioPlayer');
    const audioEl        = document.getElementById('ttsAudioEl');
    const downloadBtn    = document.getElementById('ttsDownloadBtn');

    // Built-in
    const builtinText    = document.getElementById('builtinText');
    const builtinVoice   = document.getElementById('builtinVoice');
    const builtinStyle   = document.getElementById('builtinStyle');
    const builtinTags    = document.getElementById('builtinStyleTags');
    const builtinExamples = document.getElementById('builtinExamples');

    // Design
    const designDescription = document.getElementById('designDescription');
    const designText        = document.getElementById('designText');
    const designCharCount   = document.getElementById('designCharCount');
    const designExamples    = document.getElementById('designExamples');

    // Clone
    const cloneUpload     = document.getElementById('cloneUpload');
    const cloneFile       = document.getElementById('cloneFile');
    const cloneFilePreview = document.getElementById('cloneFilePreview');
    const cloneFileName   = document.getElementById('cloneFileName');
    const cloneFileSize   = document.getElementById('cloneFileSize');
    const cloneFileRemove = document.getElementById('cloneFileRemove');
    const cloneStyle      = document.getElementById('cloneStyle');
    const cloneText       = document.getElementById('cloneText');
    const cloneCharCount  = document.getElementById('cloneCharCount');

    // ---- State ----
    let activeMode = 'builtin';
    let audioBlob  = null;
    let audioName  = 'mimo-tts-output';
    let uploadedAudioBase64 = null;

    // ---- Static example data ----
    const BUILTIN_EXAMPLES = [
        { text: '明天就是周五了，真开心！',                          style: '开心' },
        { text: '哎呀妈呀，这天儿也忒冷了吧！你说这风，嗖嗖的，跟刀子似的，割脸啊！', style: '东北话' },
        { text: '呢个真係好正啊！食过一次就唔会忘记！',                  style: '粤语' },
        { text: '原谅我这一生不羁放纵爱自由，也会怕有一天会跌倒，Oh no。', style: '唱歌' }
    ];

    const DESIGN_EXAMPLES = [
        { desc: '活泼开朗的年轻女孩，声音甜美清新',  text: '大家好，我是小美，很高兴认识你们！' },
        { desc: '沉稳有力的中年男性声音，播音员风格', text: '欢迎收听今天的新闻播报，本期主要内容有…' },
        { desc: '可爱的小朋友，声音稚嫩纯真',         text: '妈妈，妈妈，我今天在幼儿园画了一幅画！' }
    ];

    // ---- Tab switching ----
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            activeMode = tab.dataset.ttsMode;
            document.querySelector(`.tts-panel[data-tts-panel="${activeMode}"]`).classList.add('active');
            hideAudio();
            clearStatus();
        });
    });

    // ---- Render examples ----
    BUILTIN_EXAMPLES.forEach(ex => {
        const item = document.createElement('div');
        item.className = 'example-item';
        item.textContent = `${ex.style} · ${ex.text.slice(0, 28)}${ex.text.length > 28 ? '…' : ''}`;
        item.addEventListener('click', () => {
            builtinText.value = ex.text;
            builtinStyle.value = ex.style;
        });
        builtinExamples.appendChild(item);
    });

    DESIGN_EXAMPLES.forEach(ex => {
        const item = document.createElement('div');
        item.className = 'example-item';
        item.textContent = `${ex.desc} → ${ex.text.slice(0, 22)}${ex.text.length > 22 ? '…' : ''}`;
        item.addEventListener('click', () => {
            designDescription.value = ex.desc;
            designText.value = ex.text;
            updateCharCount();
        });
        designExamples.appendChild(item);
    });

    // ---- Style tag clicks ----
    builtinTags.querySelectorAll('.style-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            const style = tag.dataset.style;
            builtinStyle.value = builtinStyle.value ? `${builtinStyle.value} ${style}` : style;
            tag.classList.add('selected');
            setTimeout(() => tag.classList.remove('selected'), 200);
        });
    });

    designText.addEventListener('input', updateCharCount);
    cloneText.addEventListener('input', updateCharCount);
    function updateCharCount() {
        designCharCount.textContent = designText.value.length;
        cloneCharCount.textContent  = cloneText.value.length;
    }

    // ---- Clone file upload ----
    cloneUpload.addEventListener('click', () => cloneFile.click());
    cloneUpload.addEventListener('dragover', (e) => {
        e.preventDefault();
        cloneUpload.classList.add('dragover');
    });
    cloneUpload.addEventListener('dragleave', () => cloneUpload.classList.remove('dragover'));
    cloneUpload.addEventListener('drop', (e) => {
        e.preventDefault();
        cloneUpload.classList.remove('dragover');
        if (e.dataTransfer.files[0]) handleAudioFile(e.dataTransfer.files[0]);
    });
    cloneFile.addEventListener('change', () => {
        if (cloneFile.files[0]) handleAudioFile(cloneFile.files[0]);
    });
    cloneFileRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        uploadedAudioBase64 = null;
        cloneFilePreview.classList.remove('show');
        cloneFile.value = '';
    });

    function handleAudioFile(file) {
        if (!file) return;
        const valid = ['audio/mpeg', 'audio/wav', 'audio/x-wav'];
        if (!valid.includes(file.type) && !/\.(mp3|wav)$/i.test(file.name)) {
            setStatus('请上传 MP3 或 WAV 格式的音频文件', 'error');
            return;
        }
        if (file.size > MAX_AUDIO_BYTES) {
            setStatus('音频文件大小不能超过 10MB', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            uploadedAudioBase64 = e.target.result.split(',')[1];
            cloneFileName.textContent = file.name;
            cloneFileSize.textContent = formatFileSize(file.size);
            cloneFilePreview.classList.add('show');
        };
        reader.readAsDataURL(file);
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // ---- Generate ----
    generateBtn.addEventListener('click', generateSpeech);
    downloadBtn.addEventListener('click', downloadWAV);

    async function generateSpeech() {
        let model, text, voice, style, audioData;
        if (activeMode === 'builtin') {
            text  = builtinText.value.trim();
            voice = builtinVoice.value;
            style = builtinStyle.value.trim();
            model = 'mimo-v2.5-tts';
        } else if (activeMode === 'design') {
            text  = designText.value.trim();
            style = designDescription.value.trim();
            model = 'mimo-v2.5-tts-voicedesign';
        } else {
            text      = cloneText.value.trim();
            style     = cloneStyle.value.trim();
            audioData = uploadedAudioBase64;
            model     = 'mimo-v2.5-tts-voiceclone';
            if (!audioData) { setStatus('请先上传音频样本', 'error'); return; }
        }
        if (!text) { setStatus('请输入要转换的文本', 'error'); return; }

        generateBtn.disabled = true;
        setStatus('<span class="spinner"></span>正在生成语音，请稍候…', 'loading');
        hideAudio();

        try {
            const resp = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, text, voice, style, audioData })
            });
            if (!resp.ok) {
                const ed = await resp.json().catch(() => ({}));
                throw new Error(ed.message || `HTTP ${resp.status}: ${resp.statusText}`);
            }
            const data = await resp.json();
            const base64 = data.choices?.[0]?.message?.audio?.data;
            if (!base64) throw new Error('API 返回数据格式错误');
            const bytes = base64ToArrayBuffer(base64);
            audioBlob = new Blob([bytes], { type: 'audio/wav' });
            audioEl.src = URL.createObjectURL(audioBlob);
            audioPlayer.classList.add('show');
            audioName = `mimo-tts-${Date.now()}`;
            setStatus('语音生成成功', 'success');
        } catch (err) {
            setStatus(`生成失败：${err.message}`, 'error');
        } finally {
            generateBtn.disabled = false;
        }
    }

    function hideAudio() {
        audioPlayer.classList.remove('show');
        audioBlob = null;
    }

    function base64ToArrayBuffer(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
    }

    function downloadWAV() {
        if (!audioBlob) { setStatus('请先生成语音', 'error'); return; }
        const url = URL.createObjectURL(audioBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${audioName}.wav`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus('WAV 文件已下载', 'success');
    }

    function setStatus(html, type) {
        statusEl.innerHTML = html;
        statusEl.className = `tts-status ${type || ''}`.trim();
    }
    function clearStatus() { setStatus('', ''); }
})();
