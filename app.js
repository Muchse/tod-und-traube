let currentRole = null;
let selectedHintRound = null;
let touchStartX = 0;
let touchEndX = 0;

let rolesBase = [];
let roleContent = {};
let appState = null;
const STORAGE_KEY = 'krimi_v10';

async function loadCase() {
    const res = await fetch('case.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('case.json: HTTP ' + res.status);
    const data = await res.json();
    rolesBase = data.roles;
    roleContent = data.content;
    caseSolution = data.solution || null;
    caseGm = data.gmNotes || null;
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
        finaleRef.on('value', snap => { finale = snap.val() || {}; onFinaleChange(); });
        votesRef.on('value', snap => { votes = snap.val() || {}; onFinaleChange(); });
        announceRef.on('value', snap => { announcement = snap.val(); renderAnnouncement(); });
        epochRef.on('value', snap => {
            const e = snap.val();
            if (e === epoch) return;
            epoch = e;
            if (currentRole && dossierVisible()) renderNotebook();
        });
    } else {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) {}
        appState = saved || defaults;
        appState.players = appState.players || {};
        appState.unlocked = {};
    }
}

// --- Live-Sync (Firebase Realtime Database) ---
// Ohne FIREBASE_CONFIG (firebase-config.js) laeuft alles lokal wie bisher.
let settingsRef = null;
let unlockedRef = null;
let presenceRef = null;
let finaleRef = null;
let votesRef = null;
let announceRef = null;
let progressRef = null;
let epochRef = null;
let announcement = null;
let epoch = null;
let presence = {};
let progress = {};
let previewMode = false;
let caseGm = null;
let finale = {};          // { open, reveal }
let votes = {};           // roleId -> verdaechtigte roleId
let caseSolution = null;
let revealDismissed = false;
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
        finaleRef = game.child('finale');
        votesRef = game.child('votes');
        announceRef = game.child('announcement');
        progressRef = game.child('progress');
        epochRef = game.child('epoch');
        return snap.val() || {};
    } catch (err) {
        console.error('Live-Sync nicht verfuegbar, lokaler Modus:', err);
        settingsRef = unlockedRef = presenceRef = finaleRef = votesRef = announceRef = progressRef = epochRef = null;
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
        players: r.players || {},
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
        <button onclick="lockAllRounds()" class="mt-4 w-full bg-zinc-800 text-zinc-400 py-2 rounded font-bold text-[10px] uppercase tracking-widest font-sans">Alle sperren</button>`;
}

function initAdmin() {
    // Eine Tabelle: Eingaben (Name, Code, Aktiv) einmal aufbauen, Live-Zellen (st-/rd-/vt-) fuellt renderAdminPlayers()
    const rows = rolesBase.map(r => {
        const side = r.isSide
            ? `<div id="toggle-${r.id}" class="admin-toggle ${appState.activeSides[r.id] ? 'active' : ''}" onclick="toggleAdminRole('${r.id}')"></div>`
            : '<span class="text-[8px] text-zinc-600 uppercase">Haupt</span>';
        return `<tr id="row-${r.id}" class="border-t border-zinc-800">
            <td class="py-2 pr-3 text-white font-bold whitespace-nowrap">${esc(r.name)}</td>
            <td class="py-2 pr-3"><input type="text" maxlength="40" placeholder="Echter Name" class="w-full min-w-[110px] bg-black border border-zinc-700 p-1 px-2 text-white text-xs rounded font-sans" id="player-${r.id}" value="${esc(appState.players[r.id] || '')}"></td>
            <td class="py-2 pr-3"><input type="text" maxlength="3" class="w-12 bg-black border border-zinc-700 p-1 text-white text-center text-xs rounded font-mono" id="code-${r.id}" value="${esc(appState.codes[r.id])}"></td>
            <td class="py-2 pr-3">${side}</td>
            <td class="py-2 pr-3 whitespace-nowrap" id="st-${r.id}"></td>
            <td class="py-2 pr-3 font-mono tracking-widest whitespace-nowrap" id="rd-${r.id}"></td>
            <td class="py-2 text-zinc-300" id="vt-${r.id}"></td></tr>`;
    }).join('');
    document.getElementById('admin-roster').innerHTML = `<div class="overflow-x-auto"><table class="w-full min-w-[680px] text-xs font-sans">
        <thead><tr class="text-[9px] uppercase tracking-widest text-zinc-500 text-left">
            <th class="pb-2 pr-3">Rolle</th><th class="pb-2 pr-3">Echter Name</th><th class="pb-2 pr-3">Code</th><th class="pb-2 pr-3">Aktiv</th>
            <th class="pb-2 pr-3">Status</th><th class="pb-2 pr-3">Runden geöffnet</th><th class="pb-2">Anklage</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <p class="mt-3 text-[10px] text-zinc-500 font-sans leading-relaxed">Echter Name, Code und Aktiv werden mit Speichern übernommen. <span id="admin-roster-note"></span></p>`;
    for(let i=1; i<=4; i++) { document.getElementById(`pw-${i}`).value = appState.passwords[i]; }
    appState.introEnabled ? document.getElementById('toggle-intro').classList.add('active') : document.getElementById('toggle-intro').classList.remove('active');
    renderAdminLive();
    renderAdminFinale();
    renderAdminPlayers();
    renderAdminAnnounce();
    renderAdminPreview();
    renderAdminTools();
    watchAdminData();
}

function toggleAdminRole(id) { appState.activeSides[id] = !appState.activeSides[id]; document.getElementById(`toggle-${id}`).classList.toggle('active'); renderAdminPlayers(); }
function toggleIntroSetting() { appState.introEnabled = !appState.introEnabled; document.getElementById('toggle-intro').classList.toggle('active'); }

function saveAdminChanges() {
    rolesBase.forEach(r => { const val = document.getElementById(`code-${r.id}`).value.trim(); if(val.length === 3) appState.codes[r.id] = val; });
    for(let i=1; i<=4; i++) { appState.passwords[i] = document.getElementById(`pw-${i}`).value.trim().toLowerCase(); }
    appState.players = {};
    rolesBase.forEach(r => { const n = document.getElementById(`player-${r.id}`).value.trim(); if (n) appState.players[r.id] = n; });
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
    if (entered === '123') {
        try { localStorage.setItem(LOGIN_KEY, JSON.stringify({ admin: true })); } catch (e) {}
        showAdmin();
        return;
    }
    const roleId = Object.keys(appState.codes).find(id => appState.codes[id] === entered);
    if (!roleId) { showError(); return; }
    const rData = rolesBase.find(r => r.id === roleId);
    if (rData.isSide && !appState.activeSides[roleId]) { showError(); return; }
    enterRole(roleId, false);
}

// Letzte Anmeldung merken: nach Neuladen oder Absturz geht es direkt zurueck ins Dossier
const LOGIN_KEY = 'krimi_last_login';

function enterRole(roleId, skipIntro) {
    const rData = rolesBase.find(r => r.id === roleId);
    currentRole = { ...rData, ...roleContent[roleId] };
    document.getElementById('roleNameDisplay').textContent = currentRole.name;
    if (presenceRef) { const me = presenceRef.child(roleId); me.set(true); me.onDisconnect().remove(); }
    try { localStorage.setItem(LOGIN_KEY, JSON.stringify({ roleId, code: appState.codes[roleId] })); } catch (e) {}
    (skipIntro || !appState.introEnabled) ? nextStep(4) : nextStep(1);
    renderAnnouncement();
}

function restoreLogin() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LOGIN_KEY)); } catch (e) {}
    if (!saved) return false;
    if (saved.admin) { showAdmin(); return true; }
    const r = rolesBase.find(x => x.id === saved.roleId);
    const valid = r && appState.codes[r.id] === saved.code && (!r.isSide || appState.activeSides[r.id]);
    if (!valid) { try { localStorage.removeItem(LOGIN_KEY); } catch (e) {} return false; }
    enterRole(r.id, true);
    return true;
}

function logout() {
    try { localStorage.removeItem(LOGIN_KEY); } catch (e) {}
    location.reload();
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
    renderNotebook();
    renderVoting();
    renderReveal();
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
        if (previewMode) { if (!hintMode[r]) openHint(r, 'preview'); }
        else if (isUnlocked(r) && !hintMode[r]) openHint(r, 'live');
        else if (!isUnlocked(r) && hintMode[r] === 'live') { delete hintMode[r]; lockHint(r); }
    }
}

function openHint(round, mode) {
    hintMode[round] = mode;
    if (progressRef && currentRole && !previewMode) progressRef.child(currentRole.id).child('rounds').child(String(round)).set(true);
    const h = document.getElementById(`hint-${round}`);
    h.onclick = null;
    const parts = resolveOptional(currentRole.hints[round]).split('\n').map(line => line.trim()).filter(line => line !== '');
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
// --- Notizbuch (nur lokal auf dem Geraet des Spielers) ---
const NOTES_PREFIX = 'krimi_notes_';
const MARK_ORDER = ['', 'suspect', 'cleared'];
const MARK_VIEW = {
    '': ['○', 'text-zinc-400', 'offen'],
    suspect: ['!', 'text-red-800', 'verdächtig'],
    cleared: ['✓', 'text-green-800', 'entlastet']
};

// Textstellen, die nur mit der optionalen Rolle Fassbinder gelten: {{G:mit|ohne}} oder {{G:nur mit}}
function resolveOptional(text) {
    const on = !!appState.activeSides.fassbinder;
    return text.replace(/\{\{G:(.*?)(?:\|(.*?))?\}\}/gs, (_, withG, withoutG) => on ? withG : (withoutG || ''));
}

function suspectsFor(roleId) {
    return rolesBase.filter(r => r.status !== 'ERMITTLER' && r.id !== roleId && (!r.isSide || appState.activeSides[r.id]));
}

function activePlayers() {
    return rolesBase.filter(r => !r.isSide || appState.activeSides[r.id]);
}

function loadNotes() {
    try { return JSON.parse(localStorage.getItem(notesKey())) || { marks: {}, text: '' }; } catch (e) { return { marks: {}, text: '' }; }
}
function saveNotes(n) { try { localStorage.setItem(notesKey(), JSON.stringify(n)); } catch (e) {} }

function renderNotebook() {
    const notes = loadNotes();
    const box = document.getElementById('notebookSuspects');
    box.innerHTML = '';
    suspectsFor(currentRole.id).forEach(r => {
        const [sym, cls, label] = MARK_VIEW[notes.marks[r.id] || ''];
        const b = document.createElement('button');
        b.className = 'flex items-center justify-between px-3 py-2 rounded border border-zinc-300 bg-white/60 text-left readable-font text-sm';
        b.innerHTML = `<span>${r.name}</span><span class="font-bold ${cls}">${sym} ${label}</span>`;
        b.onclick = () => {
            const n = loadNotes();
            n.marks[r.id] = MARK_ORDER[(MARK_ORDER.indexOf(n.marks[r.id] || '') + 1) % MARK_ORDER.length];
            saveNotes(n);
            renderNotebook();
        };
        box.appendChild(b);
    });
    const ta = document.getElementById('notebookText');
    ta.value = notes.text || '';
    ta.oninput = () => { const n = loadNotes(); n.text = ta.value; saveNotes(n); };
}

// --- Anklage, Aufloesung und Finale-Steuerung (nur mit Live-Sync) ---
function dossierVisible() { return !document.getElementById('step-dossier').classList.contains('step-hidden'); }
function nameOf(id) { const r = rolesBase.find(x => x.id === id); return r ? r.name : id; }

function onFinaleChange() {
    renderAdminFinale();
    renderAdminPlayers();
    renderVoting();
    renderReveal();
}

function renderVoting() {
    const sec = document.getElementById('voting');
    const open = liveSync() && currentRole && finale.open && !finale.reveal && dossierVisible() && !previewMode;
    sec.classList.toggle('step-hidden', !open);
    if (!open) return;
    const body = document.getElementById('votingBody');
    const mine = votes[currentRole.id];
    const key = mine || 'open';
    if (body.dataset.key === key) return; // Auswahl nicht wegrendern, wenn andere abstimmen
    body.dataset.key = key;
    if (mine) {
        body.innerHTML = `<p class="readable-font text-sm">Deine Anklage ist abgegeben: <b>${nameOf(mine)}</b>. Sie lässt sich nicht mehr ändern. Warte auf die Auflösung.</p>`;
        return;
    }
    const options = suspectsFor(currentRole.id).map(r =>
        `<label class="flex items-center gap-3 p-3 rounded border border-zinc-300 bg-white/60 readable-font text-sm cursor-pointer"><input type="radio" name="vote" value="${r.id}"> ${r.name}</label>`).join('');
    body.innerHTML = `<p class="readable-font text-sm mb-4">Wer hat Gunter von Bernstein erschlagen? Du kannst nur einmal anklagen.</p>
        <div class="space-y-2 mb-4">${options}</div>
        <button onclick="submitVote()" class="bg-red-950 text-white px-6 py-3 rounded font-bold text-[10px] uppercase tracking-widest font-sans">Anklage erheben</button>`;
}

function submitVote() {
    const picked = document.querySelector('input[name="vote"]:checked');
    if (!picked || !votesRef || previewMode) return;
    if (!confirm(`Anklage gegen ${nameOf(picked.value)} erheben? Das lässt sich nicht mehr ändern.`)) return;
    votesRef.child(currentRole.id).set(picked.value);
}

function renderReveal() {
    const ov = document.getElementById('revealOverlay');
    if (!finale.reveal) revealDismissed = false;
    if (!(liveSync() && currentRole && finale.reveal && !revealDismissed && caseSolution && !previewMode)) {
        ov.classList.add('step-hidden');
        return;
    }
    const wasHidden = ov.classList.contains('step-hidden');
    const sol = caseSolution;
    document.getElementById('revealStamp').textContent = sol.stampLabel;
    document.getElementById('revealName').textContent = nameOf(sol.culpritId);
    const mine = votes[currentRole.id];
    document.getElementById('revealOwn').textContent = !mine ? 'Du hast keine Anklage abgegeben.'
        : mine === sol.culpritId ? 'Du hattest recht.' : 'Diesmal lagst Du falsch.';
    const story = document.getElementById('revealStory');
    story.innerHTML = '';
    resolveOptional(sol.text).split('\n').forEach(t => { const p = document.createElement('p'); p.textContent = t; story.appendChild(p); });
    const counts = {};
    Object.values(votes).forEach(id => { counts[id] = (counts[id] || 0) + 1; });
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1])
        .map(([id, n]) => `<div class="flex justify-between py-1 ${id === sol.culpritId ? 'text-red-500 font-bold' : 'text-zinc-400'}"><span>${nameOf(id)}</span><span>${n}</span></div>`).join('');
    document.getElementById('revealTally').innerHTML = `<p class="text-[9px] uppercase tracking-widest text-zinc-500 mb-2">Die Anklagen</p>${rows || '<p class="text-zinc-500">Keine Stimmen.</p>'}`;
    ov.classList.remove('step-hidden');
    if (wasHidden) {
        const stamp = document.getElementById('revealStamp');
        stamp.classList.remove('stamp-animate');
        void stamp.offsetWidth;
        stamp.classList.add('stamp-animate');
    }
}

function dismissReveal() { revealDismissed = true; renderReveal(); }

function setFinale(key, value) {
    if (!finaleRef) return;
    if (key === 'reveal' && value && !confirm('Auflösung jetzt für ALLE Spieler anzeigen?')) {
        renderAdminFinale(); // Schalter zurueck in die alte Stellung
        return;
    }
    finaleRef.child(key).set(value);
}
function resetFinale() {
    if (!finaleRef || !confirm('Abstimmung und Auflösung wirklich zurücksetzen?')) return;
    votesRef.remove();
    finaleRef.set({ open: false, reveal: false });
}

function renderAdminFinale() {
    const box = document.getElementById('admin-finale');
    if (!box) return;
    if (!liveSync()) {
        box.innerHTML = '<p class="text-[10px] text-zinc-500 font-sans leading-relaxed">Live-Sync ist aus.</p>';
        return;
    }
    const players = activePlayers();
    const missing = players.filter(r => !votes[r.id]);
    const row = (label, key) => `
        <div class="flex items-center justify-between p-3 bg-black/40 rounded-lg border border-zinc-800">
            <p class="font-bold text-white text-xs font-sans">${label}</p>
            <div class="admin-toggle ${finale[key] ? 'active' : ''}" onclick="setFinale('${key}', ${!finale[key]})"></div>
        </div>`;
    box.innerHTML = `<div class="space-y-3">${row('Abstimmung offen', 'open')}${row('Auflösung zeigen', 'reveal')}</div>
        <p class="mt-4 text-[10px] text-zinc-400 font-sans">Abgestimmt: ${players.length - missing.length}/${players.length}</p>
        <p class="mt-1 text-[10px] text-zinc-500 font-sans leading-relaxed">${missing.length ? 'Fehlt noch: ' + missing.map(r => labelOf(r.id)).join(', ') : 'Alle haben abgestimmt.'}</p>
        <button onclick="resetFinale()" class="mt-4 w-full bg-zinc-800 text-zinc-400 py-2 rounded font-bold text-[10px] uppercase tracking-widest font-sans">Finale zurücksetzen</button>`;
}

// --- Admin-Werkzeuge: Durchsage, Spielerübersicht, Vorschau, Zettel, Spickzettel, Export, Neues Spiel ---
function notesKey() { return NOTES_PREFIX + (epoch || 0) + '_' + currentRole.id; }

function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function playerOf(id) { return (appState.players && appState.players[id]) || ''; }
function labelOf(id) { const p = playerOf(id); return p ? `${nameOf(id)} (${p})` : nameOf(id); }

const ADMIN_BTN = 'w-full px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-3 rounded font-bold text-[10px] uppercase tracking-widest font-sans transition-colors';
const ADMIN_NOTE = 'text-[10px] text-zinc-500 font-sans leading-relaxed';

// Durchsage
function dismissedAnnouncementId() { try { return localStorage.getItem('krimi_ann_dismissed'); } catch (e) { return null; } }

function renderAnnouncement() {
    const bar = document.getElementById('announceBanner');
    const show = currentRole && !previewMode && announcement && announcement.text && String(announcement.id) !== dismissedAnnouncementId();
    if (!show) { bar.classList.add('step-hidden'); return; }
    const wasHidden = bar.classList.contains('step-hidden');
    document.getElementById('announceText').textContent = announcement.text;
    bar.classList.remove('step-hidden');
    if (wasHidden && navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) navigator.vibrate(200);
}

function dismissAnnouncement() {
    try { localStorage.setItem('krimi_ann_dismissed', String(announcement.id)); } catch (e) {}
    renderAnnouncement();
}

function sendAnnouncement() {
    const input = document.getElementById('announceInput');
    const text = input.value.trim();
    if (!text || !announceRef) return;
    announceRef.set({ text, id: Date.now() });
    input.value = '';
}

function clearAnnouncement() { if (announceRef) announceRef.remove(); }

function renderAdminAnnounce() {
    const box = document.getElementById('admin-announce');
    if (!box) return;
    if (!liveSync()) { box.innerHTML = `<p class="${ADMIN_NOTE}">Live-Sync ist aus.</p>`; return; }
    box.innerHTML = `<textarea id="announceInput" rows="3" maxlength="200" placeholder="z. B. Pause bis 20:15 Uhr" class="w-full bg-black border border-zinc-700 p-2 text-white text-sm rounded font-sans outline-none focus:border-red-900"></textarea>
        <div class="flex gap-2 mt-3">
            <button onclick="sendAnnouncement()" class="flex-1 bg-red-950 text-white py-2 rounded font-bold text-[10px] uppercase tracking-widest border border-red-800 font-sans">Senden</button>
            <button onclick="clearAnnouncement()" class="flex-1 bg-zinc-800 text-zinc-400 py-2 rounded font-bold text-[10px] uppercase tracking-widest font-sans">Löschen</button>
        </div>`;
}

// Spielerübersicht (Online-Status, geöffnete Runden, Anklage)
let adminWatched = false;
function watchAdminData() {
    if (!presenceRef || adminWatched) return;
    adminWatched = true;
    presenceRef.on('value', snap => { presence = snap.val() || {}; renderAdminPlayers(); });
    progressRef.on('value', snap => { progress = snap.val() || {}; renderAdminPlayers(); });
}

// Fuellt nur die Live-Zellen der Tabelle, damit ungespeicherte Eingaben (Name, Code) erhalten bleiben
function renderAdminPlayers() {
    const live = liveSync();
    const note = document.getElementById('admin-roster-note');
    if (note) note.textContent = live ? '' : 'Live-Sync ist aus: Status, Runden und Anklage sind nicht verfügbar.';
    const dash = '<span class="text-zinc-700">–</span>';
    rolesBase.forEach(r => {
        const row = document.getElementById(`row-${r.id}`);
        if (!row) return;
        const active = !r.isSide || appState.activeSides[r.id];
        row.classList.toggle('opacity-40', !active);
        const show = live && active;
        const opened = (progress[r.id] && progress[r.id].rounds) || {};
        const v = votes[r.id];
        document.getElementById(`st-${r.id}`).innerHTML = !show ? dash
            : presence[r.id] ? '<span class="text-green-500">● online</span>' : '<span class="text-zinc-600">○ offline</span>';
        document.getElementById(`rd-${r.id}`).innerHTML = !show ? dash
            : [1, 2, 3, 4].map(n => `<span class="${opened[n] ? 'text-white' : 'text-zinc-700'}">${n}</span>`).join(' ');
        document.getElementById(`vt-${r.id}`).innerHTML = !show || !v ? dash : '→ ' + esc(labelOf(v));
    });
}

// Rollenvorschau (ohne Anmeldung, ohne Schreibzugriffe)
function renderAdminPreview() {
    const box = document.getElementById('admin-preview');
    if (!box) return;
    box.innerHTML = activePlayers().map(r =>
        `<button onclick="previewRole('${r.id}')" class="${ADMIN_BTN} text-left normal-case tracking-normal">${esc(labelOf(r.id))}</button>`).join('');
}

function previewRole(id) {
    const rData = rolesBase.find(r => r.id === id);
    previewMode = true;
    currentRole = { ...rData, ...roleContent[id] };
    document.getElementById('previewBarName').textContent = rData.name;
    document.getElementById('previewBar').classList.remove('step-hidden');
    document.body.classList.add('previewing');
    nextStep(4);
    renderAnnouncement();
    renderReveal();
}

function exitPreview() {
    previewMode = false;
    currentRole = null;
    Object.keys(hintMode).forEach(k => delete hintMode[k]);
    document.getElementById('previewBar').classList.add('step-hidden');
    document.body.classList.remove('previewing');
    showAdmin();
}

// Zugangszettel (QR-Link meldet direkt mit dem Code an)
function baseUrl() { return location.origin + location.pathname.replace(/[^/]*$/, ''); }

function buildSlips() {
    const base = baseUrl();
    return `<div class="slips-grid">${activePlayers().map(r => {
        const code = appState.codes[r.id];
        const qr = qrcode(0, 'M');
        qr.addData(`${base}?c=${code}`);
        qr.make();
        return `<div class="slip"><div class="slip-title">Tod &amp; Traube</div>${playerOf(r.id) ? `<div class="slip-player">${esc(playerOf(r.id))}</div>` : ''}<div class="slip-name">${esc(r.name)}</div>
            <div class="slip-code">${esc(code)}</div><div class="slip-qr">${qr.createSvgTag(4, 0)}</div><div class="slip-url">${esc(base)}</div></div>`;
    }).join('')}</div>`;
}

function printSlips() {
    document.getElementById('slipsSheet').innerHTML = buildSlips();
    document.body.classList.add('printing-slips');
    window.print();
}
window.addEventListener('afterprint', () => document.body.classList.remove('printing-slips'));

function autoLoginFromUrl() {
    const code = new URLSearchParams(location.search).get('c');
    if (!code || code === '123') return;
    history.replaceState(null, '', location.pathname);
    document.getElementById('accessCode').value = code;
    handleLogin();
}

// Spielleiter-Spickzettel
function openGmSheet() {
    if (!caseGm || !caseSolution) return;
    const section = (title, body) => `<section><h3 class="text-[10px] font-bold uppercase tracking-widest text-red-800 mb-3">${title}</h3>${body}</section>`;
    const list = items => `<ul class="list-disc pl-5 space-y-2">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
    const timeline = caseGm.timeline.map(([t, x]) =>
        `<div class="flex gap-4 py-1 border-t border-zinc-800"><span class="w-28 shrink-0 font-mono text-zinc-500">${esc(t)}</span><span>${esc(x)}</span></div>`).join('');
    const herrings = caseGm.redHerrings.map(([w, x]) => `<p><b class="text-white">${esc(w)}:</b> ${esc(x)}</p>`).join('');
    const story = resolveOptional(caseSolution.text).split('\n').map(t => `<p>${esc(t)}</p>`).join('');
    document.getElementById('gmSheetBody').innerHTML =
        section('Täter', `<p class="text-lg text-white font-bold">${esc(labelOf(caseGm.culpritId))}</p>`) +
        section('Tathergang', `<div class="space-y-3">${story}</div>`) +
        section('Zeitlinie', timeline) +
        section('Schlüsselhinweise gegen den Täter', list(caseGm.keyClues)) +
        section('Falsche Fährten', `<div class="space-y-3">${herrings}</div>`) +
        section('Tipps zur Spielleitung', list(caseGm.tips));
    document.getElementById('gmSheet').classList.remove('step-hidden');
}
function closeGmSheet() { document.getElementById('gmSheet').classList.add('step-hidden'); }

// Ergebnis exportieren (Textdatei)
function exportResult() {
    const players = activePlayers();
    const culprit = caseSolution ? caseSolution.culpritId : null;
    const lines = [
        'Tod & Traube - Ergebnis',
        'Datum: ' + new Date().toLocaleString('de-DE'),
        '',
        'Täter: ' + (culprit ? labelOf(culprit) : 'unbekannt'),
        `Spieler (${players.length}): ` + players.map(r => labelOf(r.id)).join(', '),
        'Gisela Fassbinder dabei: ' + (appState.activeSides.fassbinder ? 'ja' : 'nein'),
        'Freigeschaltete Runden: ' + ([1, 2, 3, 4].filter(isUnlocked).join(', ') || 'keine'),
        '',
        'Anklagen:'
    ];
    let right = 0;
    const counts = {};
    players.forEach(r => {
        const v = votes[r.id];
        if (v) { counts[v] = (counts[v] || 0) + 1; if (v === culprit) right++; }
        lines.push(`  ${labelOf(r.id)} -> ${v ? labelOf(v) + (v === culprit ? ' (richtig)' : ' (falsch)') : 'keine Anklage'}`);
    });
    const cast = Object.keys(votes).filter(id => players.some(p => p.id === id)).length;
    lines.push('', `Richtig getippt: ${right} von ${cast} abgegebenen Anklagen`, '', 'Stimmen je Person:');
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([id, n]) => lines.push(`  ${labelOf(id)}: ${n}`));
    if (!cast) lines.push('  (keine Stimmen)');
    const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tod-und-traube-ergebnis-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Neues Spiel: Runden, Finale, Anklagen, Durchsage, Fortschritt zuruecksetzen
function newGame() {
    if (!liveSync()) return;
    if (!confirm('NEUES SPIEL starten?\nRunden werden gesperrt, Anklagen, Finale, Durchsage und Spielfortschritt gelöscht.')) return;
    lockAllRounds();
    finaleRef.set({ open: false, reveal: false });
    votesRef.remove();
    progressRef.remove();
    announceRef.remove();
    epochRef.set(Date.now());
}

function renderAdminTools() {
    const box = document.getElementById('admin-tools');
    if (!box) return;
    const live = liveSync();
    box.innerHTML = `<button onclick="printSlips()" class="${ADMIN_BTN}">Zugangszettel drucken</button>
        <button onclick="openGmSheet()" class="${ADMIN_BTN}">Spickzettel</button>
        <button onclick="exportResult()" class="${ADMIN_BTN}">Ergebnis exportieren</button>
        <button onclick="newGame()" ${live ? '' : 'disabled'} class="w-full bg-red-950 ${live ? 'hover:bg-red-900' : 'opacity-40'} text-white py-3 rounded font-bold text-[10px] uppercase tracking-widest border border-red-800 font-sans">Neues Spiel</button>
        ${live ? '' : `<p class="${ADMIN_NOTE}">Neues Spiel braucht Live-Sync.</p>`}
        <p class="${ADMIN_NOTE}">Zettel zeigen die gespeicherten Codes. Nach Änderungen erst speichern.</p>`;
}

window.onload = () => {
    lucide.createIcons();
    loadCase().then(() => {
        autoLoginFromUrl();                  // ?c=<Code> vom Zugangszettel hat Vorrang
        if (!currentRole) restoreLogin();    // sonst die zuletzt angemeldete Rolle
    }).catch(err => {
        console.error(err);
        const e = document.getElementById('loginError');
        e.textContent = 'Fall konnte nicht geladen werden';
        e.style.opacity = '1';
    });
};
