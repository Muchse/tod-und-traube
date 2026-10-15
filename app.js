let currentRole = null;
let selectedHintRound = null;
let touchStartX = 0;
let touchEndX = 0;

let rolesBase = [];
let roleContent = {};
let appState = null;
const STORAGE_KEY = 'krimi_v10';

async function loadCase() {
    const res = await fetch('case.json');
    if (!res.ok) throw new Error('case.json: HTTP ' + res.status);
    const data = await res.json();
    rolesBase = data.roles;
    roleContent = data.content;
    const defaults = {
        codes: rolesBase.reduce((acc, r) => ({ ...acc, [r.id]: r.defaultCode }), {}),
        activeSides: rolesBase.filter(r => r.isSide).reduce((acc, r) => ({ ...acc, [r.id]: true }), {}),
        introEnabled: data.defaults.introEnabled,
        passwords: data.defaults.passwords
    };
    const remote = await connectLiveSync();
    if (liveSync()) {
        appState = mergeState(defaults, remote);
        unlockedRef.on('value', snap => {
            appState.unlocked = snap.val() || {};
            onUnlockedChange();
        });
    } else {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) {}
        appState = saved || defaults;
        appState.unlocked = {};
    }
}

// --- Live-Sync (Firebase Realtime Database) ---
// Ohne FIREBASE_CONFIG (firebase-config.js) laeuft alles lokal wie bisher.
let settingsRef = null;
let unlockedRef = null;
let presenceRef = null;
const hintMode = {}; // Runde -> 'live' | 'password'

function liveSync() { return !!settingsRef; }
function isUnlocked(r) { return !!(appState.unlocked && appState.unlocked[r]); }

async function connectLiveSync() {
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !window.firebase) return null;
    try {
        firebase.initializeApp(cfg);
        const game = firebase.database().ref('game');
        const read = game.child('settings').once('value');
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Firebase-Timeout')), 8000));
        const snap = await Promise.race([read, timeout]);
        settingsRef = game.child('settings');
        unlockedRef = game.child('unlocked');
        presenceRef = game.child('presence');
        return snap.val() || {};
    } catch (err) {
        console.error('Live-Sync nicht verfuegbar, lokaler Modus:', err);
        settingsRef = unlockedRef = presenceRef = null;
        return null;
    }
}

function mergeState(defaults, remote) {
    const r = remote || {};
    return {
        codes: { ...defaults.codes, ...(r.codes || {}) },
        activeSides: { ...defaults.activeSides, ...(r.activeSides || {}) },
        introEnabled: r.introEnabled === undefined ? defaults.introEnabled : r.introEnabled,
        passwords: { ...defaults.passwords, ...(r.passwords || {}) },
        unlocked: {}
    };
}

function onUnlockedChange() {
    if (!document.getElementById('step-admin').classList.contains('step-hidden')) renderAdminLive();
    if (currentRole && !document.getElementById('step-dossier').classList.contains('step-hidden')) refreshHints();
}

function setRoundUnlocked(r, value) { if (unlockedRef) unlockedRef.child(String(r)).set(value); }
function lockAllRounds() { if (unlockedRef) unlockedRef.set({ 1: false, 2: false, 3: false, 4: false }); }

function renderAdminLive() {
    const box = document.getElementById('admin-live');
    if (!box) return;
    if (!liveSync()) {
        box.innerHTML = '<p class="text-[10px] text-zinc-500 font-sans leading-relaxed">Live-Sync ist aus. Trage die Firebase-Konfiguration in firebase-config.js ein, dann schaltest Du Runden hier für alle Spieler frei.</p>';
        return;
    }
    const rows = [1, 2, 3, 4].map(r => `
        <div class="flex items-center justify-between p-3 bg-black/40 rounded-lg border border-zinc-800">
            <p class="font-bold text-white text-xs font-sans">Runde ${r}</p>
            <div class="admin-toggle ${isUnlocked(r) ? 'active' : ''}" onclick="setRoundUnlocked(${r}, ${!isUnlocked(r)})"></div>
        </div>`).join('');
    box.innerHTML = `<div class="space-y-3">${rows}</div>
        <button onclick="lockAllRounds()" class="mt-4 w-full bg-zinc-800 text-zinc-400 py-2 rounded font-bold text-[10px] uppercase tracking-widest font-sans">Alle sperren</button>
        <p id="admin-presence" class="mt-4 text-[10px] text-zinc-500 font-sans leading-relaxed"></p>`;
}

let presenceWatched = false;
function watchPresence() {
    if (!presenceRef || presenceWatched) return;
    presenceWatched = true;
    presenceRef.on('value', snap => {
        const online = Object.keys(snap.val() || {}).map(id => (rolesBase.find(r => r.id === id) || { name: id }).name);
        const el = document.getElementById('admin-presence');
        if (el) el.textContent = online.length ? `Online (${online.length}): ${online.join(', ')}` : 'Niemand online.';
    });
}

function initAdmin() {
    const list = document.getElementById('admin-role-list');
    list.innerHTML = '';
    rolesBase.forEach(r => {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between p-3 bg-black/40 rounded-lg border border-zinc-800';
        const isSideControl = r.isSide ? `<div id="toggle-${r.id}" class="admin-toggle ${appState.activeSides[r.id] ? 'active' : ''}" onclick="toggleAdminRole('${r.id}')"></div>` : '<span class="text-[8px] text-zinc-600 uppercase font-sans">Haupt</span>';
        div.innerHTML = `
            <div class="flex-1 text-left"><p class="font-bold text-white text-xs font-sans">${r.name}</p></div>
            <div class="flex items-center space-x-2"><input type="text" maxlength="3" class="w-10 bg-black border border-zinc-700 p-1 text-white text-center text-xs rounded font-mono" id="code-${r.id}" value="${appState.codes[r.id]}">${isSideControl}</div>
        `;
        list.appendChild(div);
    });
    for(let i=1; i<=4; i++) { document.getElementById(`pw-${i}`).value = appState.passwords[i]; }
    appState.introEnabled ? document.getElementById('toggle-intro').classList.add('active') : document.getElementById('toggle-intro').classList.remove('active');
    renderAdminLive();
    watchPresence();
}

function toggleAdminRole(id) { appState.activeSides[id] = !appState.activeSides[id]; document.getElementById(`toggle-${id}`).classList.toggle('active'); }
function toggleIntroSetting() { appState.introEnabled = !appState.introEnabled; document.getElementById('toggle-intro').classList.toggle('active'); }

function saveAdminChanges() {
    rolesBase.forEach(r => { const val = document.getElementById(`code-${r.id}`).value.trim(); if(val.length === 3) appState.codes[r.id] = val; });
    for(let i=1; i<=4; i++) { appState.passwords[i] = document.getElementById(`pw-${i}`).value.trim().toLowerCase(); }
    const { unlocked, ...settings } = appState;
    if (liveSync()) {
        settingsRef.set(settings).then(() => location.reload()).catch(err => { console.error(err); alert('Speichern fehlgeschlagen: ' + err.message); });
        return;
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch(e) {}
    location.reload();
}

function handleLogin() {
    if (!appState) { showError(); return; }
    const entered = document.getElementById('accessCode').value.trim();
    if (entered === '123') { showAdmin(); return; }
    const roleId = Object.keys(appState.codes).find(id => appState.codes[id] === entered);
    if (!roleId) { showError(); return; }
    const rData = rolesBase.find(r => r.id === roleId);
    if (rData.isSide && !appState.activeSides[roleId]) { showError(); return; }
    currentRole = { ...rData, ...roleContent[roleId] };
    document.getElementById('roleNameDisplay').textContent = currentRole.name;
    if (presenceRef) { const me = presenceRef.child(roleId); me.set(true); me.onDisconnect().remove(); }
    appState.introEnabled ? nextStep(1) : nextStep(4);
}

function showError() { const e = document.getElementById('loginError'); e.style.opacity = '1'; setTimeout(() => e.style.opacity = '0', 2000); }
function showAdmin() { document.querySelectorAll('body > div').forEach(d => d.classList.add('step-hidden')); document.getElementById('step-admin').classList.remove('step-hidden'); initAdmin(); }

function nextStep(s) {
    document.querySelectorAll('body > div').forEach(d => d.classList.add('step-hidden'));
    if (s === 1) document.getElementById('step-identity').classList.remove('step-hidden');
    else if (s === 2) { document.getElementById('step-prologue').classList.remove('step-hidden'); renderPrologue(); }
    else if (s === 3) { document.getElementById('step-status').classList.remove('step-hidden'); renderStatus(); }
    else if (s === 4) { document.getElementById('step-dossier').classList.remove('step-hidden'); renderDossier(); }
    window.scrollTo(0, 0);
}

function renderPrologue() {
    const c = document.getElementById('prologueContainer'); c.innerHTML = '';
    currentRole.intro.forEach((l, i) => {
        const p = document.createElement('p'); p.textContent = l; p.className = 'opacity-0'; c.appendChild(p);
        setTimeout(() => { p.style.transition = 'opacity 1s'; p.style.opacity = '1'; }, i * 1000);
    });
    setTimeout(() => document.getElementById('toStatusBtn').style.opacity = '1', currentRole.intro.length * 1000);
}

function renderStatus() {
    const s = document.getElementById('statusStamp'); s.textContent = currentRole.status;
    s.className = 'stamp-effect ' + (currentRole.status === "TÄTER" ? 'stamp-guilty' : currentRole.status === "ERMITTLER" ? 'border-blue-800 text-blue-800' : 'stamp-innocent');
    document.getElementById('displayRoleRule').textContent = `"${currentRole.rule}"`;
    setTimeout(() => s.classList.add('stamp-animate'), 500);
}

function renderDossier() {
    document.getElementById('dossName').textContent = currentRole.name;
    document.getElementById('dossStatusLabel').textContent = currentRole.status;
    document.getElementById('dossBackground').textContent = currentRole.background;
    document.getElementById('dossGoal').textContent = currentRole.goal;
    document.getElementById('dossSecret').textContent = currentRole.secret;
    document.getElementById('dossDetails').textContent = currentRole.details;
    for (let i = 1; i <= 4; i++) { delete hintMode[i]; lockHint(i); }
    refreshHints();
    lucide.createIcons();
}

function lockHint(i) {
    const h = document.getElementById(`hint-${i}`);
    h.innerHTML = `<i data-lucide="lock" class="w-5 h-5 mb-1 opacity-30"></i><span class="text-[9px] font-bold uppercase">Runde ${i}</span>`;
    h.className = "hint-locked p-6 rounded flex flex-col items-center justify-center text-center";
    h.onclick = () => unlockHint(i);
    lucide.createIcons();
}

// Runden, die der Spielleiter live freigegeben hat, oeffnen sich automatisch;
// zurueckgesetzte Runden werden wieder gesperrt (per Passwort geoeffnete bleiben offen).
function refreshHints() {
    for (let r = 1; r <= 4; r++) {
        if (isUnlocked(r) && !hintMode[r]) openHint(r, 'live');
        else if (!isUnlocked(r) && hintMode[r] === 'live') { delete hintMode[r]; lockHint(r); }
    }
}

function openHint(round, mode) {
    hintMode[round] = mode;
    const h = document.getElementById(`hint-${round}`);
    h.onclick = null;
    const parts = currentRole.hints[round].split('\n').map(line => line.trim()).filter(line => line !== '');
    h.className = "col-span-2 border border-zinc-300 rounded-xl overflow-hidden bg-white shadow-inner";
    h.innerHTML = createSliderHTML(parts, round);
    lucide.createIcons();
    initSlider(h);
}

function unlockHint(r) { selectedHintRound = r; document.getElementById('passwordModal').classList.remove('step-hidden'); document.getElementById('hintPasswordInput').focus(); }
function closeModal() { document.getElementById('passwordModal').classList.add('step-hidden'); document.getElementById('hintPasswordInput').value = ''; }

function confirmUnlock() {
    const p = document.getElementById('hintPasswordInput').value.trim().toLowerCase();
    if (p === appState.passwords[selectedHintRound]) {
        openHint(selectedHintRound, 'password');
        closeModal();
    } else { 
        document.getElementById('hintPasswordInput').classList.add('border-red-600'); 
        setTimeout(() => document.getElementById('hintPasswordInput').classList.remove('border-red-600'), 1000); 
    }
}

function createSliderHTML(parts, round) {
    if (parts.length === 0) parts = ["Keine Info."];
    let slides = parts.map((part, index) => `<div class="hint-slide ${index === 0 ? 'active' : ''} readable-font text-sm text-zinc-800 leading-relaxed">${part}</div>`).join('');
    let indicators = parts.length > 1 ? parts.map((_, i) => `<div class="w-1.5 h-1.5 rounded-full mx-1 ${i === 0 ? 'bg-red-900 w-3' : 'bg-zinc-300'}"></div>`).join('') : "";
    return `
        <div class="hint-slider-container">
            <div class="flex-grow flex items-center justify-center min-h-[220px] relative px-4">${slides}
                ${parts.length > 1 ? `<button class="prev-hint absolute left-1 top-1/2 -translate-y-1/2 p-2"><i data-lucide="chevron-left"></i></button><button class="next-hint absolute right-1 top-1/2 -translate-y-1/2 p-2"><i data-lucide="chevron-right"></i></button>` : ''}
            </div>
            <div class="bg-zinc-50 p-2 flex flex-col items-center">
                <div class="flex mb-1">${indicators}</div>
                <div class="text-[8px] uppercase font-bold text-zinc-400">Runde ${round} ${parts.length > 1 ? `• <span class="current-part">1</span>/${parts.length}` : ''}</div>
            </div>
        </div>
    `;
}

function initSlider(container) {
    const slides = container.querySelectorAll('.hint-slide');
    if (slides.length <= 1) return;
    const indicators = container.querySelectorAll('.bg-zinc-300, .bg-red-900');
    const currentPartDisplay = container.querySelector('.current-part');
    let index = 0;
    const update = () => {
        slides.forEach(s => s.classList.remove('active')); slides[index].classList.add('active');
        indicators.forEach((ind, i) => { ind.className = i === index ? "w-3 h-1.5 rounded-full mx-1 bg-red-900" : "w-1.5 h-1.5 rounded-full mx-1 bg-zinc-300"; });
        currentPartDisplay.textContent = index + 1;
    };
    container.querySelector('.next-hint').onclick = () => { index = (index + 1) % slides.length; update(); };
    container.querySelector('.prev-hint').onclick = () => { index = (index - 1 + slides.length) % slides.length; update(); };
    container.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; });
    container.addEventListener('touchend', e => { 
        touchEndX = e.changedTouches[0].screenX;
        if (touchStartX - touchEndX > 50) { index = (index + 1) % slides.length; update(); }
        if (touchEndX - touchStartX > 50) { index = (index - 1 + slides.length) % slides.length; update(); }
    });
}
window.onload = () => {
    lucide.createIcons();
    loadCase().catch(err => {
        console.error(err);
        const e = document.getElementById('loginError');
        e.textContent = 'Fall konnte nicht geladen werden';
        e.style.opacity = '1';
    });
};
