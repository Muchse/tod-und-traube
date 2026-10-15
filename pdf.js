// PDF-Erzeugung mit jsPDF: Zugangszettel pro Rolle und Ergebnis-Auswertung.
// Nutzt Globals aus app.js (rolesBase, roleContent, appState, votes, caseSolution, caseInvitation, labelOf, ...).

const PDF_RED = [153, 27, 27];
const PDF_DARK = [10, 10, 12];
const PDF_PAPER = [244, 241, 234];
const PDF_GREEN = [22, 101, 52];
const PDF_PAGE_W = 210;
const PDF_MARGIN = 18;
const PDF_CONTENT_W = PDF_PAGE_W - 2 * PDF_MARGIN;

// Standardschriften kennen nur WinAnsi: typografische Zeichen vereinfachen
function pdfSafe(text) {
    return String(text)
        .replace(/[„“”]/g, '"').replace(/[‚‘’]/g, "'")
        .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/→/g, '->').replace(/ /g, ' ');
}

function newPdf() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ unit: 'mm', format: 'a4' });
}

function pdfBanner(doc, title, subtitle) {
    doc.setFillColor(...PDF_DARK);
    doc.rect(0, 0, PDF_PAGE_W, 40, 'F');
    doc.setFillColor(...PDF_RED);
    doc.rect(0, 40, PDF_PAGE_W, 1.6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('courier', 'bold');
    doc.setFontSize(28);
    doc.text(pdfSafe(title).toUpperCase(), PDF_PAGE_W / 2, 21, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(215, 205, 195);
    doc.text(pdfSafe(subtitle), PDF_PAGE_W / 2, 31, { align: 'center' });
}

function pdfFooter(doc, text) {
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
        doc.setPage(p);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(130);
        doc.text(pdfSafe(text), PDF_PAGE_W / 2, 289, { align: 'center' });
    }
}

// Absatz mit Umbruch, gibt das neue y zurueck
function pdfPara(doc, text, x, y, width, lineHeight) {
    const lines = doc.splitTextToSize(pdfSafe(text), width);
    doc.text(lines, x, y);
    return y + lines.length * lineHeight;
}

function pdfHeading(doc, text, y) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...PDF_RED);
    doc.text(pdfSafe(text).toUpperCase(), PDF_MARGIN, y);
    doc.setDrawColor(...PDF_RED);
    doc.setLineWidth(0.3);
    doc.line(PDF_MARGIN, y + 1.8, PDF_PAGE_W - PDF_MARGIN, y + 1.8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40);
    return y + 8;
}

// Neue Seite, falls der Platz nicht reicht
function pdfEnsure(doc, y, needed) {
    if (y + needed <= 280) return y;
    doc.addPage();
    return 22;
}

function pdfQr(doc, text, x, y, size) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const cell = size / n;
    doc.setFillColor(255, 255, 255);
    doc.rect(x - 2, y - 2, size + 4, size + 4, 'F');
    doc.setFillColor(0, 0, 0);
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (qr.isDark(r, c)) doc.rect(x + c * cell, y + r * cell, cell + 0.05, cell + 0.05, 'F');
        }
    }
}

function fileSafe(text) { return String(text).replace(/[^A-Za-z0-9ÄÖÜäöüß]+/g, '-').replace(/^-+|-+$/g, ''); }

// --- Zugangszettel -------------------------------------------------------

function addSlipPage(doc, roleId, first) {
    if (!first) doc.addPage();
    const inv = caseInvitation;
    const role = rolesBase.find(r => r.id === roleId);
    const content = roleContent[roleId];
    const player = playerOf(roleId);
    const code = appState.codes[roleId];
    const base = baseUrl();
    const M = PDF_MARGIN;
    const W = PDF_CONTENT_W;

    pdfBanner(doc, inv.title, inv.subtitle);
    let y = 55;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(30);
    doc.text(pdfSafe(player ? `Hallo ${player}!` : 'Willkommen!'), M, y);
    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(50);
    inv.intro.forEach(p => { y = pdfPara(doc, p, M, y, W, 4.8) + 2.5; });

    // Rollenkarte mit Zugangsnummer und QR-Code
    y += 2;
    const boxH = 50;
    doc.setFillColor(...PDF_PAPER);
    doc.setDrawColor(...PDF_RED);
    doc.setLineWidth(0.6);
    doc.roundedRect(M, y, W, boxH, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_RED);
    doc.text('DEINE ROLLE', M + 6, y + 9);
    doc.setFontSize(17);
    doc.setTextColor(25);
    doc.text(pdfSafe(role.name), M + 6, y + 17);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(90);
    const tagline = (content.intro || []).slice(1).join(' - ');
    if (tagline) doc.text(doc.splitTextToSize(pdfSafe(tagline), W - 56), M + 6, y + 23);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_RED);
    doc.text('ZUGANGSNUMMER', M + 6, y + 33);
    doc.setFont('courier', 'bold');
    doc.setFontSize(30);
    doc.setTextColor(10);
    doc.text(String(code).split('').join(' '), M + 6, y + 44);
    const link = `${base}?c=${code}`;
    pdfQr(doc, link, M + W - 42, y + 8, 34);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(90);
    doc.text('Zum Anmelden scannen', M + W - 25, y + 47, { align: 'center' });
    y += boxH + 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(50);
    doc.text('Adresse:', M, y);
    doc.setTextColor(30, 64, 175);
    doc.textWithLink(pdfSafe(base), M + 17, y, { url: link });
    y += 11;

    y = pdfHeading(doc, "So geht's", y);
    inv.steps.forEach((s, i) => {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...PDF_RED);
        doc.text(`${i + 1}.`, M, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(50);
        y = pdfPara(doc, s, M + 7, y, W - 7, 4.8) + 1.5;
    });

    y = pdfEnsure(doc, y + 5, 40);
    y = pdfHeading(doc, 'Gut zu wissen', y);
    inv.rules.forEach(rule => {
        doc.setTextColor(...PDF_RED);
        doc.text('-', M, y);
        doc.setTextColor(50);
        y = pdfPara(doc, rule, M + 5, y, W - 5, 4.8) + 1.5;
    });

    const info = (appState.eventInfo || '').trim();
    if (info) {
        y = pdfEnsure(doc, y + 5, 30);
        y = pdfHeading(doc, 'Termin und Ort', y);
        info.split('\n').forEach(line => { y = pdfPara(doc, line || ' ', M, y, W, 4.8); });
    }
}

function closeSlipDialog() { document.getElementById('slipDialog').classList.add('step-hidden'); }

function openSlipDialog() {
    if (!caseInvitation || !window.jspdf) { alert('PDF-Erzeugung ist nicht verfügbar (Internetverbindung prüfen).'); return; }
    const rows = activePlayers().map(r => `
        <label class="flex items-center gap-3 p-3 bg-black/40 rounded-lg border border-zinc-800 cursor-pointer">
            <input type="checkbox" class="slip-check" value="${r.id}" checked>
            <span class="text-white text-xs font-bold">${esc(labelOf(r.id))}</span>
            <span class="ml-auto font-mono text-zinc-500 text-xs">${esc(appState.codes[r.id])}</span>
        </label>`).join('');
    document.getElementById('slipDialogBody').innerHTML = `
        <p class="${ADMIN_NOTE} mb-4">Wähle die Rollen, für die ein Zugangszettel erstellt werden soll. Die Zettel nutzen die gespeicherten Codes und Namen, nach Änderungen also erst speichern.</p>
        <div class="space-y-2">${rows}</div>
        <div class="flex gap-4 mt-3 text-[10px] uppercase tracking-widest font-bold">
            <button onclick="toggleSlipChecks(true)" class="text-zinc-400 hover:text-white">Alle</button>
            <button onclick="toggleSlipChecks(false)" class="text-zinc-400 hover:text-white">Keine</button>
        </div>
        <label class="block mt-6 mb-1 text-[9px] uppercase text-zinc-500">Termin, Ort und Hinweise (erscheint auf dem Zettel)</label>
        <textarea id="eventInfoInput" rows="4" placeholder="z. B. Samstag, 20. Juni, 18 Uhr, Weingut Musterhof, Radebeul" class="w-full bg-black border border-zinc-700 p-2 text-white text-sm rounded outline-none focus:border-red-900">${esc(appState.eventInfo || '')}</textarea>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
            <button onclick="downloadSlips(false)" class="${ADMIN_BTN}">Je Rolle eine PDF</button>
            <button onclick="downloadSlips(true)" class="${ADMIN_BTN}">Eine PDF für alle</button>
        </div>
        <p class="${ADMIN_NOTE} mt-3">Bei "Je Rolle eine PDF" lädt der Browser mehrere Dateien nacheinander herunter und fragt eventuell nach einer Erlaubnis.</p>`;
    document.getElementById('slipDialog').classList.remove('step-hidden');
}

function toggleSlipChecks(on) { document.querySelectorAll('.slip-check').forEach(c => { c.checked = on; }); }

function saveEventInfo() {
    const field = document.getElementById('eventInfoInput');
    if (!field) return;
    const value = field.value.trim();
    if (value === (appState.eventInfo || '')) return;
    appState.eventInfo = value;
    if (liveSync()) {
        settingsRef.child('eventInfo').set(value || null);
    } else {
        const { unlocked, ...settings } = appState;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) {}
    }
}

async function downloadSlips(combined) {
    const ids = [...document.querySelectorAll('.slip-check:checked')].map(c => c.value);
    if (!ids.length) { alert('Bitte mindestens eine Rolle auswählen.'); return; }
    saveEventInfo();
    if (combined) {
        const doc = newPdf();
        ids.forEach((id, i) => addSlipPage(doc, id, i === 0));
        pdfFooter(doc, caseInvitation.footer);
        doc.save('Zugangszettel-Tod-und-Traube.pdf');
        return;
    }
    for (const id of ids) {
        const doc = newPdf();
        addSlipPage(doc, id, true);
        pdfFooter(doc, caseInvitation.footer);
        doc.save(`Zugang-${fileSafe(playerOf(id) || nameOf(id))}.pdf`);
        await new Promise(resolve => setTimeout(resolve, 600));
    }
}

// --- Ergebnis-Auswertung -------------------------------------------------

function exportResult() {
    if (!window.jspdf) { alert('PDF-Erzeugung ist nicht verfügbar (Internetverbindung prüfen).'); return; }
    const doc = newPdf();
    const M = PDF_MARGIN;
    const W = PDF_CONTENT_W;
    const players = activePlayers();
    const culprit = caseSolution ? caseSolution.culpritId : null;
    const dateText = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });

    const counts = {};
    let right = 0;
    let cast = 0;
    players.forEach(r => {
        const v = votes[r.id];
        if (!v) return;
        cast++;
        counts[v] = (counts[v] || 0) + 1;
        if (v === culprit) right++;
    });

    pdfBanner(doc, 'Tod & Traube', `Auswertung vom ${dateText}`);
    let y = 54;

    // Täter-Karte
    if (culprit) {
        doc.setFillColor(...PDF_PAPER);
        doc.setDrawColor(...PDF_RED);
        doc.setLineWidth(0.6);
        doc.roundedRect(M, y, W, 26, 2, 2, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...PDF_RED);
        doc.text(pdfSafe((caseSolution.stampLabel || 'TÄTER')).toUpperCase(), M + 6, y + 9);
        doc.setFontSize(19);
        doc.setTextColor(20);
        doc.text(pdfSafe(labelOf(culprit)), M + 6, y + 19);
        y += 33;
    }

    // Kennzahlen
    const tiles = [
        ['Spieler', String(players.length)],
        ['Anklagen', String(cast)],
        ['Richtig', cast ? `${right} (${Math.round(right / cast * 100)} %)` : '-']
    ];
    const tileW = (W - 8) / 3;
    tiles.forEach(([label, value], i) => {
        const x = M + i * (tileW + 4);
        doc.setFillColor(248, 247, 244);
        doc.setDrawColor(215);
        doc.setLineWidth(0.3);
        doc.roundedRect(x, y, tileW, 20, 2, 2, 'FD');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(label.toUpperCase(), x + 5, y + 7);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.setTextColor(25);
        doc.text(pdfSafe(value), x + 5, y + 16);
    });
    y += 27;

    // Anklagen-Tabelle
    y = pdfHeading(doc, 'Anklagen', y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text('SPIELER', M + 2, y);
    doc.text('ANGEKLAGT', M + 82, y);
    doc.text('ERGEBNIS', M + W - 2, y, { align: 'right' });
    y += 7;
    players.forEach((r, i) => {
        y = pdfEnsure(doc, y, 10);
        if (i % 2 === 0) { doc.setFillColor(246, 244, 240); doc.rect(M, y - 4.4, W, 6.4, 'F'); }
        const v = votes[r.id];
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(30);
        doc.text(pdfSafe(labelOf(r.id)), M + 2, y);
        doc.text(pdfSafe(v ? labelOf(v) : '-'), M + 82, y);
        doc.setFont('helvetica', 'bold');
        if (!v) { doc.setTextColor(150); doc.text('keine Anklage', M + W - 2, y, { align: 'right' }); }
        else if (v === culprit) { doc.setTextColor(...PDF_GREEN); doc.text('richtig', M + W - 2, y, { align: 'right' }); }
        else { doc.setTextColor(...PDF_RED); doc.text('falsch', M + W - 2, y, { align: 'right' }); }
        y += 6.4;
    });
    y += 5;

    // Stimmenverteilung als Balken
    const ranking = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (ranking.length) {
        y = pdfEnsure(doc, y, 14 + ranking.length * 8);
        y = pdfHeading(doc, 'Stimmenverteilung', y);
        const max = ranking[0][1];
        const barX = M + 62;
        const barMax = W - 62 - 12;
        ranking.forEach(([id, n]) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9.5);
            doc.setTextColor(30);
            doc.text(pdfSafe(labelOf(id)), M + 2, y);
            if (id === culprit) doc.setFillColor(...PDF_RED); else doc.setFillColor(170, 170, 175);
            doc.rect(barX, y - 4, Math.max(2, barMax * n / max), 5, 'F');
            doc.setFont('helvetica', 'bold');
            doc.text(String(n), barX + Math.max(2, barMax * n / max) + 3, y);
            y += 7;
        });
        y += 3;
    }

    // Fall und Eckdaten
    if (caseSolution) {
        y = pdfEnsure(doc, y, 40);
        y = pdfHeading(doc, 'Der Fall', y);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(50);
        resolveOptional(caseSolution.text).split('\n').forEach(p => {
            const lines = doc.splitTextToSize(pdfSafe(p), W);
            y = pdfEnsure(doc, y, lines.length * 4.6 + 3);
            doc.text(lines, M, y);
            y += lines.length * 4.6 + 2.5;
        });
    }
    y = pdfEnsure(doc, y + 4, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(120);
    const unlocked = [1, 2, 3, 4].filter(isUnlocked).join(', ') || 'keine';
    doc.text(pdfSafe(`Freigeschaltete Runden: ${unlocked}   |   Gisela Fassbinder: ${appState.activeSides.fassbinder ? 'dabei' : 'nicht dabei'}`), M, y);

    pdfFooter(doc, 'Tod & Traube - Auswertung');
    doc.save(`tod-und-traube-auswertung-${new Date().toISOString().slice(0, 10)}.pdf`);
}
