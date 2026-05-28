/* ═══════════════════════════════════════════════════════════
   AISOC Dashboard — App Logic
   ═══════════════════════════════════════════════════════════ */

const API = '';

// ── Utilities ──
function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtTokens(n) {
    if (!n || n === 0) return '0';
    if (n >= 1e9) return (n/1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
    return String(n);
}
function fmtTime(ts) {
    if (!ts) return '--';
    const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
    return d.toLocaleString('zh-CN', {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
}
function fmtDur(sec) {
    if (!sec) return '--';
    if (sec < 60) return Math.round(sec) + 's';
    if (sec < 3600) return Math.floor(sec/60) + 'm' + (sec%60 > 0 ? Math.round(sec%60) + 's' : '');
    return Math.floor(sec/3600) + 'h' + Math.floor((sec%3600)/60) + 'm';
}

// ── Counter Animation ──
function animateCounter(el, target, suffix = '') {
    const start = parseInt(el.textContent) || 0;
    if (start === target) return;
    const duration = 600;
    const startTime = performance.now();
    function tick(now) {
        const p = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
        const current = Math.round(start + (target - start) * eased);
        el.textContent = current + suffix;
        if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// ── Clock ──
function updateClock() {
    const now = new Date();
    document.getElementById('clock').textContent = now.toLocaleTimeString('zh-CN', {hour12: false});
}
setInterval(updateClock, 1000);
updateClock();

// ══════ DATA LOADING ══════

async function loadStatus() {
    try {
        const r = await fetch(API + '/api/status');
        const d = await r.json();
        const badge = document.getElementById('status-badge');
        const text = document.getElementById('status-text');
        text.textContent = d.status;
        badge.className = 'status-badge' + (d.status === 'ONLINE' ? '' : ' idle');
        document.getElementById('model-info').textContent = d.model + ' · ' + d.provider;
        const h = Math.floor(d.uptime_seconds / 3600);
        const m = Math.floor((d.uptime_seconds % 3600) / 60);
        document.getElementById('uptime').textContent = `UPTIME: ${Math.floor(h/24)}D ${h%24}H ${m}M`;
    } catch(e) { console.error('status err', e); }
}

async function loadStats() {
    try {
        const r = await fetch(API + '/api/stats');
        const d = await r.json();
        // Animate numbers
        const sessEl = document.getElementById('stat-sessions');
        sessEl.textContent = d.active_sessions;
        document.getElementById('stat-total-sessions').textContent = '/ ' + d.total_sessions + ' total';
        
        const cronEl = document.getElementById('stat-cron');
        animateCounter(cronEl, d.cron_jobs_total);
        document.getElementById('stat-cron-enabled').textContent = '/ ' + d.cron_jobs_enabled + ' 启用';
        
        document.getElementById('stat-memory').textContent = d.memory_percent + '%';
        document.getElementById('memory-fill').style.width = d.memory_percent + '%';
        
        document.getElementById('stat-tokens').textContent = fmtTokens(d.today_tokens);
        document.getElementById('token-detail').textContent = 
            'IN: ' + fmtTokens(d.today_input_tokens) + ' / OUT: ' + fmtTokens(d.today_output_tokens);

        renderSourceChart(d.source_distribution);
    } catch(e) { console.error('stats err', e); }
}

async function loadTrend(days = 7) {
    try {
        const r = await fetch(API + '/api/token-trend?days=' + days);
        const d = await r.json();
        renderTrendChart(d);
    } catch(e) { console.error('trend err', e); }
}

async function loadKeywords() {
    try {
        const r = await fetch(API + '/api/keywords');
        const keywords = await r.json();
        const container = document.getElementById('keywords-cloud');
        const maxCount = Math.max(...keywords.map(k => k.count), 1);
        container.innerHTML = keywords.map(k => {
            const isHot = k.count > maxCount * 0.4;
            const cls = (k.lang === 'zh' ? 'zh' : '') + (isHot ? ' hot' : '');
            return `<span class="kw-tag ${cls}" data-keyword="${esc(k.word)}">${esc(k.word)}<span class="kw-count">${k.count}</span></span>`;
        }).join('');
    } catch(e) { console.error('keywords err', e); }
}

async function loadCronJobs() {
    try {
        const r = await fetch(API + '/api/cronjobs');
        const jobs = await r.json();
        document.getElementById('cron-count').textContent = jobs.length + ' TASKS';
        const tbody = document.getElementById('cron-tbody');
        tbody.innerHTML = jobs.map(j => {
            const status = j.enabled ? '<span class="badge badge-green">ACTIVE</span>' : '<span class="badge badge-gray">OFF</span>';
            const lastRun = j.last_run ? fmtTime(j.last_run.started_at) : '--';
            const tokens = j.last_run ? fmtTokens(j.last_run.tokens) : '--';
            const schedule = typeof j.schedule === 'object' ? (j.schedule.display || j.schedule.expr || '--') : String(j.schedule || '--');
            return `<tr>
                <td>${status}</td>
                <td style="color:var(--text-primary)">${esc(j.name)}</td>
                <td>${esc(schedule)}</td>
                <td>${lastRun}</td>
                <td>${tokens}</td>
                <td>${j.run_count || 0}</td>
                <td><button class="btn-sm" data-action="cron-history" data-job-id="${j.id}" data-job-name="${esc(j.name)}">HIST</button></td>
            </tr>`;
        }).join('');
    } catch(e) { console.error('cron err', e); }
}

// ══════ SECURITY EVENTS (PAGINATED) ══════

let _eventsData = [];
let _eventsPage = 1;
const EVENTS_PER_PAGE = 5;

async function loadSecurityEvents() {
    try {
        const r = await fetch(API + '/api/security-events');
        _eventsData = await r.json();
        _eventsPage = 1;
        renderEventsPage();
    } catch(e) { console.error('events err', e); }
}

function renderEventsPage() {
    const container = document.getElementById('events-list');
    const totalPages = Math.ceil(_eventsData.length / EVENTS_PER_PAGE);
    const start = (_eventsPage - 1) * EVENTS_PER_PAGE;
    const pageData = _eventsData.slice(start, start + EVENTS_PER_PAGE);

    const iconMap = {
        'shield': '🛡', 'sword': '⚔', 'terminal': '💻',
        'mail': '✉', 'report': '📋', 'search': '🔍', 'investigate': '🔬'
    };
    const riskColors = {
        'Critical': '#ff2d55', 'High': '#ff6b35', 'Medium': '#ffb800',
        'Low': '#00d4ff', 'Info': '#6b7b8a'
    };

    const cardsHtml = pageData.map((ev, idx) => {
        const ts = typeof ev.time === 'number' ? new Date(ev.time * 1000) : new Date(ev.time);
        const timeStr = ts.toLocaleDateString('zh-CN', {month:'2-digit', day:'2-digit'}) + ' ' + ts.toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'});
        const icon = iconMap[ev.icon] || '📌';
        const riskColor = riskColors[ev.risk_level] || '#6b7b8a';
        const duration = ev.duration ? fmtDur(ev.duration) : '--';
        const entitiesHtml = (ev.entities || []).slice(0, 4).map(e => `<span class="ev-entity">${esc(e)}</span>`).join('');
        const verdictHtml = ev.verdict ? `<span class="ev-verdict ev-verdict-${ev.verdict.toLowerCase()}">${esc(ev.verdict)}</span>` : '';
        const statusIcon = ev.status === 'completed' ? '✓' : ev.status === 'failed' ? '✗' : '◐';
        const statusClass = ev.status === 'completed' ? 'ok' : ev.status === 'failed' ? 'err' : 'warn';

        return `<div class="ev-row" data-action="session-detail" data-session-id="${ev.session_id}" style="animation-delay:${idx * 0.03}s">
            <div class="ev-indicator" style="background:${riskColor}"></div>
            <div class="ev-icon">${icon}</div>
            <div class="ev-main">
                <div class="ev-title-row">
                    <span class="ev-type">${esc(ev.type_label)}</span>
                    <span class="ev-risk" style="color:${riskColor}">${ev.risk_level}</span>
                    ${verdictHtml}
                </div>
                <div class="ev-summary">${esc(ev.summary)}</div>
                ${entitiesHtml ? `<div class="ev-entities">${entitiesHtml}</div>` : ''}
            </div>
            <div class="ev-meta">
                <div class="ev-time">${timeStr}</div>
                <div class="ev-stats">
                    <span class="ev-status ev-status-${statusClass}">${statusIcon}</span>
                    <span>${duration}</span>
                    <span>${fmtTokens(ev.tokens)}</span>
                </div>
            </div>
            <div class="ev-arrow">▸</div>
        </div>`;
    }).join('');

    // Pagination controls
    const paginationHtml = totalPages > 1 ? `
        <div class="ev-pagination">
            <button class="ev-page-btn" data-action="events-prev" ${_eventsPage <= 1 ? 'disabled' : ''}>◂ PREV</button>
            <span class="ev-page-info">${_eventsPage} / ${totalPages}</span>
            <button class="ev-page-btn" data-action="events-next" ${_eventsPage >= totalPages ? 'disabled' : ''}>NEXT ▸</button>
        </div>
    ` : '';

    container.innerHTML = cardsHtml + paginationHtml;
}

// ══════ CHARTS ══════

function renderTrendChart(data) {
    const canvas = document.getElementById('trend-chart');
    const ctx = canvas.getContext('2d');
    const W = canvas.parentElement.clientWidth;
    const H = 240;
    canvas.width = W * 2; canvas.height = H * 2;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, W, H);

    if (!data || !data.length) return;
    const maxVal = Math.max(...data.map(d => d.total_tokens), 1);
    const pad = { top: 20, right: 16, bottom: 40, left: 56 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;
    const gap = chartW / data.length;
    const barW = Math.min(32, gap * 0.6);

    // Grid
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + (chartH / 4) * i;
        const val = maxVal * (1 - i / 4);
        ctx.fillStyle = '#3A5566';
        ctx.fillText(fmtTokens(val), pad.left - 8, y + 3);
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.05)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
        ctx.setLineDash([]);
    }

    // Bars
    data.forEach((d, i) => {
        const x = pad.left + i * gap + (gap - barW) / 2;
        const hInput = (d.input_tokens / maxVal) * chartH;
        const hOutput = (d.output_tokens / maxVal) * chartH;
        const hTotal = hInput + hOutput;

        // Glow under bar
        const glow = ctx.createRadialGradient(x + barW/2, pad.top + chartH, 0, x + barW/2, pad.top + chartH, barW);
        glow.addColorStop(0, 'rgba(0, 212, 255, 0.12)');
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(x - 4, pad.top + chartH - hTotal - 4, barW + 8, hTotal + 8);

        // Input bar
        if (hInput > 0) {
            const grad = ctx.createLinearGradient(0, pad.top + chartH - hInput - hOutput, 0, pad.top + chartH);
            grad.addColorStop(0, 'rgba(0, 212, 255, 0.9)');
            grad.addColorStop(1, 'rgba(0, 120, 180, 0.3)');
            ctx.fillStyle = grad;
            const by = pad.top + chartH - hTotal;
            ctx.beginPath();
            ctx.roundRect(x, by, barW * 0.55, hInput, [3, 3, 0, 0]);
            ctx.fill();
        }

        // Output bar
        if (hOutput > 0) {
            const grad2 = ctx.createLinearGradient(0, pad.top + chartH - hOutput, 0, pad.top + chartH);
            grad2.addColorStop(0, 'rgba(168, 85, 247, 0.9)');
            grad2.addColorStop(1, 'rgba(100, 40, 180, 0.3)');
            ctx.fillStyle = grad2;
            const by2 = pad.top + chartH - hOutput;
            ctx.beginPath();
            ctx.roundRect(x + barW * 0.55 + 2, by2, barW * 0.4, hOutput, [3, 3, 0, 0]);
            ctx.fill();
        }

        // Top value
        if (hTotal > chartH * 0.12) {
            ctx.fillStyle = 'rgba(0, 212, 255, 0.8)';
            ctx.font = '9px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(fmtTokens(d.total_tokens), x + barW/2, pad.top + chartH - hTotal - 6);
        }

        // X label
        ctx.fillStyle = '#3A5566';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(d.date.slice(5), x + barW/2, H - pad.bottom + 16);
    });

    // Trend line
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    data.forEach((d, i) => {
        const x = pad.left + i * gap + gap/2;
        const y = pad.top + chartH - (d.total_tokens / maxVal) * chartH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Trend dots
    data.forEach((d, i) => {
        const x = pad.left + i * gap + gap/2;
        const y = pad.top + chartH - (d.total_tokens / maxVal) * chartH;
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#00FF88';
        ctx.shadowColor = '#00FF88';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
    });

    // Legend
    const ly = H - 10;
    ctx.textAlign = 'left';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(0, 212, 255, 0.8)';
    ctx.fillRect(pad.left, ly - 7, 10, 3);
    ctx.fillStyle = '#6A8899'; ctx.fillText('INPUT', pad.left + 14, ly - 3);
    ctx.fillStyle = 'rgba(168, 85, 247, 0.8)';
    ctx.fillRect(pad.left + 70, ly - 7, 10, 3);
    ctx.fillStyle = '#6A8899'; ctx.fillText('OUTPUT', pad.left + 84, ly - 3);
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.6)';
    ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.moveTo(pad.left + 148, ly - 5); ctx.lineTo(pad.left + 163, ly - 5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#6A8899'; ctx.fillText('TREND', pad.left + 168, ly - 3);

    // ── Hover Tooltip ──
    canvas._trendData = data;
    canvas._trendLayout = { pad, gap, barW, chartH, maxVal, W, H };
    if (!canvas._hoverBound) {
        canvas._hoverBound = true;
        const tooltip = document.createElement('div');
        tooltip.className = 'chart-tooltip';
        tooltip.style.cssText = 'position:absolute;display:none;pointer-events:none;padding:8px 12px;background:rgba(5,10,15,0.95);border:1px solid var(--cyan);border-radius:4px;font-family:var(--font-mono);font-size:11px;color:var(--text-primary);box-shadow:0 0 12px rgba(0,212,255,0.3);z-index:100;white-space:nowrap;';
        canvas.parentElement.style.position = 'relative';
        canvas.parentElement.appendChild(tooltip);

        canvas.addEventListener('mousemove', function(e) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const d = canvas._trendData;
            const L = canvas._trendLayout;
            if (!d || !L) return;

            const idx = Math.floor((x - L.pad.left) / L.gap);
            if (idx >= 0 && idx < d.length && x > L.pad.left && x < L.W - L.pad.right) {
                const item = d[idx];
                tooltip.style.display = 'block';
                tooltip.innerHTML = `<div style="color:var(--cyan);margin-bottom:4px;font-weight:bold">${item.date}</div>` +
                    `<div>INPUT: <span style="color:var(--cyan)">${fmtTokens(item.input_tokens)}</span></div>` +
                    `<div>OUTPUT: <span style="color:#A855F7">${fmtTokens(item.output_tokens)}</span></div>` +
                    `<div>TOTAL: <span style="color:var(--green)">${fmtTokens(item.total_tokens)}</span></div>` +
                    `<div style="margin-top:4px;color:var(--text-dim)">SESSIONS: ${item.sessions}</div>`;
                // Position tooltip
                let tx = e.clientX - rect.left + 12;
                let ty = e.clientY - rect.top - 10;
                if (tx + 150 > L.W) tx = tx - 170;
                tooltip.style.left = tx + 'px';
                tooltip.style.top = ty + 'px';

                // Highlight column (use overlay canvas to avoid re-render loop)
                if (!canvas._overlayCanvas) {
                    canvas._overlayCanvas = document.createElement('canvas');
                    canvas._overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
                    canvas.parentElement.appendChild(canvas._overlayCanvas);
                }
                const oc = canvas._overlayCanvas;
                oc.width = canvas.width; oc.height = canvas.height;
                oc.style.width = canvas.style.width; oc.style.height = canvas.style.height;
                const ctx2 = oc.getContext('2d');
                ctx2.clearRect(0, 0, oc.width, oc.height);
                ctx2.scale(2, 2);
                const bx = L.pad.left + idx * L.gap;
                ctx2.fillStyle = 'rgba(0, 212, 255, 0.06)';
                ctx2.fillRect(bx, L.pad.top, L.gap, L.chartH);
                ctx2.strokeStyle = 'rgba(0, 212, 255, 0.3)';
                ctx2.lineWidth = 1;
                ctx2.setLineDash([2, 2]);
                ctx2.beginPath();
                ctx2.moveTo(bx + L.gap/2, L.pad.top);
                ctx2.lineTo(bx + L.gap/2, L.pad.top + L.chartH);
                ctx2.stroke();
            } else {
                tooltip.style.display = 'none';
            }
        });
        canvas.addEventListener('mouseleave', function() {
            tooltip.style.display = 'none';
            if (canvas._overlayCanvas) {
                const ctx2 = canvas._overlayCanvas.getContext('2d');
                ctx2.clearRect(0, 0, canvas._overlayCanvas.width, canvas._overlayCanvas.height);
            }
        });
    }
}

function renderSourceChart(dist) {
    const canvas = document.getElementById('source-chart');
    const ctx = canvas.getContext('2d');
    const size = 180;
    canvas.width = size * 2; canvas.height = size * 2;
    canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
    ctx.scale(2, 2);

    if (!dist) return;
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    const colors = [
        { main: '#00D4FF', dark: '#005577' },
        { main: '#A855F7', dark: '#4C1D95' },
        { main: '#00FF88', dark: '#006633' },
        { main: '#FF4D1C', dark: '#7F2600' },
        { main: '#FFD600', dark: '#665500' }
    ];
    const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
    const cx = size/2, cy = size/2, outerR = 72, innerR = 48;

    // Background ring
    ctx.beginPath(); ctx.arc(cx, cy, outerR + 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();

    let startAngle = -Math.PI / 2;
    const segGap = 0.04;

    entries.forEach(([src, count], i) => {
        const angle = (count / total) * Math.PI * 2 - segGap;
        const c = colors[i % colors.length];
        const midA = startAngle + angle / 2;

        // Segment
        const grad = ctx.createLinearGradient(
            cx + Math.cos(startAngle) * innerR, cy + Math.sin(startAngle) * innerR,
            cx + Math.cos(midA) * outerR, cy + Math.sin(midA) * outerR
        );
        grad.addColorStop(0, c.dark);
        grad.addColorStop(1, c.main);

        ctx.beginPath();
        ctx.arc(cx, cy, outerR, startAngle, startAngle + angle);
        ctx.arc(cx, cy, innerR, startAngle + angle, startAngle, true);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.shadowColor = c.main;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Bright outer edge
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, startAngle + 0.02, startAngle + angle - 0.02);
        ctx.strokeStyle = c.main;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.7;
        ctx.stroke();
        ctx.globalAlpha = 1;

        startAngle += angle + segGap;
    });

    // Inner circle
    const igr = ctx.createRadialGradient(cx, cy, 0, cx, cy, innerR);
    igr.addColorStop(0, '#0A1018');
    igr.addColorStop(1, '#050A0F');
    ctx.beginPath(); ctx.arc(cx, cy, innerR - 2, 0, Math.PI * 2);
    ctx.fillStyle = igr; ctx.fill();

    // Center text
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px "JetBrains Mono", monospace';
    ctx.fillStyle = '#E0F7FF';
    ctx.fillText(total, cx, cy + 3);
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#3A5566';
    ctx.fillText('SESSIONS', cx, cy + 16);

    // Legend
    const legend = document.getElementById('source-legend');
    legend.innerHTML = entries.map(([src, count], i) => {
        const pct = ((count/total)*100).toFixed(1);
        const c = colors[i % colors.length];
        const label = src === 'api_server' ? 'API' : src === 'cron' ? 'CRON' : src.toUpperCase();
        return `<div class="legend-item">
            <span class="legend-dot" style="background:${c.main};box-shadow:0 0 6px ${c.main}"></span>
            <span class="legend-label">${label}</span>
            <span class="legend-value">${pct}%</span>
            <span class="legend-count">(${count})</span>
        </div>`;
    }).join('');

    // ── Donut Hover ──
    canvas._sourceData = { entries, total, colors, cx, cy, outerR, innerR };
    if (!canvas._hoverBound) {
        canvas._hoverBound = true;
        const tooltip = document.createElement('div');
        tooltip.style.cssText = 'position:absolute;display:none;pointer-events:none;padding:8px 12px;background:rgba(5,10,15,0.95);border:1px solid var(--cyan);border-radius:4px;font-family:var(--font-mono);font-size:11px;color:var(--text-primary);box-shadow:0 0 12px rgba(0,212,255,0.3);z-index:100;white-space:nowrap;';
        canvas.parentElement.style.position = 'relative';
        canvas.parentElement.appendChild(tooltip);

        canvas.addEventListener('mousemove', function(e) {
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (size / rect.width);
            const y = (e.clientY - rect.top) * (size / rect.height);
            const sd = canvas._sourceData;
            if (!sd) return;

            const dx = x - sd.cx, dy = y - sd.cy;
            const dist2 = Math.sqrt(dx*dx + dy*dy);

            if (dist2 >= sd.innerR && dist2 <= sd.outerR) {
                let angle = Math.atan2(dy, dx);
                if (angle < -Math.PI/2) angle += Math.PI * 2;
                let cumAngle = -Math.PI/2;
                let found = -1;
                for (let i = 0; i < sd.entries.length; i++) {
                    const seg = (sd.entries[i][1] / sd.total) * Math.PI * 2;
                    if (angle >= cumAngle && angle < cumAngle + seg) { found = i; break; }
                    cumAngle += seg;
                }
                if (found >= 0) {
                    const [src, cnt] = sd.entries[found];
                    const pct = ((cnt/sd.total)*100).toFixed(1);
                    const c = sd.colors[found % sd.colors.length];
                    const label = src === 'api_server' ? 'API Server' : src === 'cron' ? 'Cron Tasks' : src.charAt(0).toUpperCase() + src.slice(1);
                    tooltip.style.display = 'block';
                    tooltip.innerHTML = `<div style="color:${c.main};font-weight:bold">${label}</div>` +
                        `<div>${cnt} sessions <span style="color:var(--text-dim)">(${pct}%)</span></div>`;
                    tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
                    tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
                    canvas.style.cursor = 'pointer';
                } else {
                    tooltip.style.display = 'none';
                    canvas.style.cursor = 'default';
                }
            } else {
                tooltip.style.display = 'none';
                canvas.style.cursor = 'default';
            }
        });
        canvas.addEventListener('mouseleave', function() {
            tooltip.style.display = 'none';
            canvas.style.cursor = 'default';
        });
    }
}

// ══════ MODALS ══════

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

async function showCronHistory(jobId, jobName) {
    document.getElementById('modal-cron-title').textContent = jobName + ' — HISTORY';
    const body = document.getElementById('modal-cron-body');
    body.innerHTML = '<div style="color:var(--text-dim);font-family:var(--font-mono)">LOADING...</div>';
    openModal('modal-cron-history');
    try {
        const r = await fetch(API + '/api/cronjobs/' + jobId + '/history');
        const history = await r.json();
        if (!history.length) { body.innerHTML = '<div style="color:var(--text-dim)">暂无执行记录</div>'; return; }
        body.innerHTML = history.map(h => {
            const st = h.status === 'completed' ? '<span class="badge badge-green">OK</span>' : '<span class="badge badge-red">' + esc(h.status) + '</span>';
            return `<div class="history-item" data-action="session-detail" data-session-id="${h.session_id}">
                <div><div class="history-time">${fmtTime(h.started_at)}</div></div>
                <div class="history-meta">
                    <span>${fmtDur(h.duration_seconds)}</span>
                    <span>${fmtTokens(h.tokens)} tkn</span>
                    <span>${h.messages} msg</span>
                    ${st}
                </div>
            </div>`;
        }).join('');
    } catch(e) { body.innerHTML = '<div style="color:var(--orange)">LOAD FAILED</div>'; }
}

async function showSessionDetail(sessionId) {
    document.getElementById('modal-session-title').textContent = 'SESSION DETAIL';
    const body = document.getElementById('modal-session-body');
    body.innerHTML = '<div style="color:var(--text-dim);font-family:var(--font-mono)">LOADING...</div>';
    openModal('modal-session-detail');
    try {
        const r = await fetch(API + '/api/sessions/' + sessionId + '/detail');
        const d = await r.json();
        if (d.error) { body.innerHTML = `<div style="color:var(--orange)">${esc(d.error)}</div>`; return; }
        let header = `<div style="margin-bottom:16px;padding:12px 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;font-family:var(--font-mono);font-size:11px;color:var(--text-secondary)">
            <div>SESSION: ${esc(sessionId)}</div>
            <div>MODEL: ${esc(d.model)} | MSG: ${d.message_count} | TKN: ${fmtTokens(d.tokens)}</div>
            <div>TIME: ${fmtTime(d.started_at)} → ${fmtTime(d.ended_at)}</div>
        </div>`;
        let msgs = d.messages.map(m => {
            let cls = 'msg-' + m.role;
            let label = m.role.toUpperCase();
            if (m.tool_name) label += ' (' + m.tool_name + ')';
            return `<div class="msg-item ${cls}"><div class="msg-role">${esc(label)}</div><div class="msg-content">${esc(m.content)}</div></div>`;
        }).join('');
        body.innerHTML = header + msgs;
    } catch(e) { body.innerHTML = '<div style="color:var(--orange)">LOAD FAILED: ' + esc(e.message) + '</div>'; }
}

async function showKeywordDrilldown(keyword) {
    document.getElementById('modal-keyword-title').textContent = '"' + keyword + '" — RELATED';
    const body = document.getElementById('modal-keyword-body');
    body.innerHTML = '<div style="color:var(--text-dim);font-family:var(--font-mono)">LOADING...</div>';
    openModal('modal-keyword');
    try {
        const r = await fetch(API + '/api/keywords/' + encodeURIComponent(keyword) + '/sessions');
        const sessions = await r.json();
        if (!sessions.length) { body.innerHTML = '<div style="color:var(--text-dim)">NO RESULTS</div>'; return; }
        body.innerHTML = sessions.map(s => {
            return `<div class="history-item" data-action="session-detail" data-session-id="${s.session_id}">
                <div>
                    <div style="color:var(--text-primary);font-size:12px">${esc(s.title)}</div>
                    <div class="history-time">${fmtTime(s.started_at)} · ${esc(s.source)}</div>
                </div>
                <div class="history-meta">
                    <span>${s.messages} msg</span>
                    <span>${fmtTokens(s.tokens)} tkn</span>
                </div>
            </div>`;
        }).join('');
    } catch(e) { body.innerHTML = '<div style="color:var(--orange)">LOAD FAILED</div>'; }
}

// ══════ EVENT DELEGATION ══════

document.addEventListener('click', function(e) {
    if (e.target.matches('[data-close]')) { closeModal(e.target.dataset.close); return; }
    if (e.target.matches('.modal-overlay')) { e.target.classList.remove('active'); return; }
    
    const cronBtn = e.target.closest('[data-action="cron-history"]');
    if (cronBtn) { showCronHistory(cronBtn.dataset.jobId, cronBtn.dataset.jobName); return; }
    
    const prevBtn = e.target.closest('[data-action="events-prev"]');
    if (prevBtn) { _eventsPage = Math.max(1, _eventsPage - 1); renderEventsPage(); return; }
    const nextBtn = e.target.closest('[data-action="events-next"]');
    if (nextBtn) { const tp = Math.ceil(_eventsData.length / EVENTS_PER_PAGE); _eventsPage = Math.min(tp, _eventsPage + 1); renderEventsPage(); return; }

    const detailEl = e.target.closest('[data-action="session-detail"]');
    if (detailEl) { showSessionDetail(detailEl.dataset.sessionId); return; }
    
    const kwTag = e.target.closest('.kw-tag');
    if (kwTag) { showKeywordDrilldown(kwTag.dataset.keyword); return; }
    
    const tab = e.target.closest('.tab');
    if (tab) {
        tab.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        if (tab.dataset.days) {
            loadTrend(parseInt(tab.dataset.days));
        } else if (tab.dataset.cronPeriod) {
            loadCronTokenDist(tab.dataset.cronPeriod);
        }
        return;
    }
});

// ══════ CRON TOKEN DISTRIBUTION ══════

const CRON_COLORS = [
    '#00D4FF', '#00FF88', '#FF4D1C', '#A855F7', '#F59E0B',
    '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1'
];

let _cronTokenChart = null;

async function loadCronTokenDist(period = 'today') {
    try {
        const res = await fetch(`${API}/api/cron-token-dist?period=${period}`);
        const data = await res.json();
        renderCronTokenChart(data);
    } catch (e) { console.error('cron-token-dist error:', e); }
}

function renderCronTokenChart(data) {
    const canvas = document.getElementById('cron-token-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = 280;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2, cy = size / 2;
    const outerR = 115, innerR = 70;
    const jobs = data.jobs || [];
    const total = data.total_cron_tokens || 1;

    // Draw donut segments
    let angle = -Math.PI / 2;
    const gap = 0.03; // gap between segments

    jobs.forEach((job, i) => {
        const pct = job.io_tokens / total;
        const sweep = pct * Math.PI * 2 - gap;
        if (sweep <= 0) return;

        const color = CRON_COLORS[i % CRON_COLORS.length];

        // Gradient from dark to bright
        const midAngle = angle + sweep / 2;
        const gx = cx + Math.cos(midAngle) * outerR;
        const gy = cy + Math.sin(midAngle) * outerR;
        const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
        grad.addColorStop(0, color + '44');
        grad.addColorStop(1, color);

        ctx.beginPath();
        ctx.arc(cx, cy, outerR, angle, angle + sweep);
        ctx.arc(cx, cy, innerR, angle + sweep, angle, true);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // Glow
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.strokeStyle = color + '88';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.shadowBlur = 0;

        angle += sweep + gap;
    });

    // Center text
    ctx.fillStyle = '#0a1628';
    ctx.beginPath();
    ctx.arc(cx, cy, innerR - 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 18px "JetBrains Mono", monospace';
    ctx.fillStyle = '#00D4FF';
    ctx.fillText(fmtTokens(data.total_cron_tokens), cx, cy - 10);
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#5a7a9a';
    ctx.fillText('CRON TOTAL', cx, cy + 10);
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#3a5a7a';
    ctx.fillText(`${data.cron_percent || 0}% of all tokens`, cx, cy + 26);

    // Build list
    const listEl = document.getElementById('cron-token-list');
    if (!listEl) return;

    let html = '';
    jobs.forEach((job, i) => {
        const color = CRON_COLORS[i % CRON_COLORS.length];
        html += `
            <div class="cron-token-item">
                <div class="cron-token-dot" style="background:${color}; box-shadow: 0 0 6px ${color}88"></div>
                <div class="cron-token-name">${esc(job.name)}</div>
                <div class="cron-token-value">${fmtTokens(job.io_tokens)}</div>
                <div class="cron-token-pct">${job.percent_of_cron}%</div>
                <div class="cron-token-bar-wrap">
                    <div class="cron-token-bar-fill" style="width:${job.percent_of_cron}%; background: linear-gradient(90deg, ${color}22, ${color})"></div>
                </div>
            </div>`;
    });

    // Add non-cron item
    if (data.non_cron_tokens > 0) {
        const nonCronPct = Math.round(data.non_cron_tokens / (data.grand_total || 1) * 100);
        html += `
            <div class="cron-token-item" style="opacity: 0.6">
                <div class="cron-token-dot" style="background:#3a5a7a"></div>
                <div class="cron-token-name">非 Cron 会话 (API/CLI/Slack)</div>
                <div class="cron-token-value">${fmtTokens(data.non_cron_tokens)}</div>
                <div class="cron-token-pct">${nonCronPct}%</div>
            </div>`;
    }

    // Summary footer
    html += `<div class="cron-token-summary">
        <span>总计 Cron: <strong>${fmtTokens(data.total_cron_tokens)}</strong></span>
        <span>占全部: <strong>${data.cron_percent}%</strong></span>
        <span>Runs: <strong>${jobs.reduce((s, j) => s + j.runs, 0)}</strong></span>
    </div>`;

    listEl.innerHTML = html;
}

// ══════ INIT ══════

async function loadAll() {
    await Promise.all([
        loadStatus(),
        loadStats(),
        loadTrend(7),
        loadKeywords(),
        loadCronJobs(),
        loadSecurityEvents(),
        loadCronTokenDist('today')
    ]);
}

document.addEventListener('DOMContentLoaded', () => {
    loadAll();
    setInterval(loadAll, 30000);
});
