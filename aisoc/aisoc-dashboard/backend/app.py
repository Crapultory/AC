"""AISOC Dashboard Backend - v3 (all data from state.db)"""
import json, os, time, re, sqlite3
from datetime import datetime, timezone, timedelta
from quart import Quart, jsonify, send_from_directory, request
from quart_cors import cors

app = Quart(__name__)
app = cors(app)

PROFILE_DIR = "/home/amber/.hermes/profiles/aisoc"
STATE_DB = f"{PROFILE_DIR}/state.db"
JOBS_FILE = f"{PROFILE_DIR}/cron/jobs.json"
MEMORY_DIR = f"{PROFILE_DIR}/memories"
FRONTEND_DIR = "/home/amber/aisoc-dashboard/frontend"


def get_db():
    conn = sqlite3.connect(STATE_DB)
    conn.row_factory = sqlite3.Row
    return conn


# --- Static files ---
@app.route("/")
async def index():
    return await send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/<path:path>")
async def static_files(path):
    return await send_from_directory(FRONTEND_DIR, path)


# --- API: System Status ---
@app.route("/api/status")
async def api_status():
    import subprocess
    db = get_db()

    # Check if hermes process is actively running (has a session open)
    # A session is "active" if it started recently and has no ended_at
    row = db.execute("""
        SELECT started_at FROM sessions 
        WHERE ended_at IS NULL 
        ORDER BY started_at DESC LIMIT 1
    """).fetchone()
    last_activity = row["started_at"] if row else 0

    # Also check if any hermes process is running
    try:
        ps = subprocess.run(["pgrep", "-f", "hermes.*aisoc.*gateway"], capture_output=True, text=True)
        hermes_running = ps.returncode == 0
    except:
        hermes_running = False

    # Status logic:
    # ONLINE = hermes process running AND has open sessions (no ended_at) started in last 6h
    # IDLE = hermes process running but no recent activity
    # OFFLINE = no hermes process
    now = time.time()
    has_recent_open = (now - last_activity) < 21600 if last_activity else False  # 6h

    if hermes_running and has_recent_open:
        status = "ONLINE"
    elif hermes_running:
        status = "IDLE"
    else:
        status = "OFFLINE"

    # Uptime from profile start (earliest session in state.db)
    row2 = db.execute("SELECT MIN(started_at) FROM sessions").fetchone()
    first_seen = row2[0] if row2 and row2[0] else now
    uptime_sec = int(now - first_seen)

    db.close()
    return jsonify({
        "status": status,
        "model": "claude-opus-4-6",
        "provider": "custom:claude4.6",
        "profile": "aisoc",
        "uptime_seconds": uptime_sec,
        "last_activity": last_activity
    })


# --- API: Stats ---
@app.route("/api/stats")
async def api_stats():
    db = get_db()

    # Total sessions
    total = db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]

    # Active sessions (started in last 24h, no ended_at = still "alive")
    day_ago = time.time() - 86400
    active = db.execute("SELECT COUNT(*) FROM sessions WHERE started_at > ? AND ended_at IS NULL", (day_ago,)).fetchone()[0]

    # Today's tokens
    today_start = datetime.now().replace(hour=0, minute=0, second=0).timestamp()
    tok = db.execute("SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0) FROM sessions WHERE started_at > ?", (today_start,)).fetchone()
    today_input = tok[0]
    today_output = tok[1]
    today_total = today_input + today_output

    # Sessions by source
    sources = db.execute("SELECT source, COUNT(*) as cnt FROM sessions GROUP BY source").fetchall()
    source_dist = {r["source"]: r["cnt"] for r in sources}

    # Cron jobs
    cron_total = 0
    cron_enabled = 0
    if os.path.exists(JOBS_FILE):
        with open(JOBS_FILE) as f:
            jobs = json.load(f).get("jobs", [])
            cron_total = len(jobs)
            cron_enabled = sum(1 for j in jobs if j.get("enabled", True))

    # Memory usage
    mem_used = 0
    mem_total = 2200 + 1375  # memory + user limits from SOUL.md
    for fname in ["MEMORY.md", "USER.md"]:
        fpath = os.path.join(MEMORY_DIR, fname)
        if os.path.exists(fpath):
            mem_used += len(open(fpath).read())

    db.close()
    return jsonify({
        "total_sessions": total,
        "active_sessions": active,
        "today_tokens": today_total,
        "today_input_tokens": today_input,
        "today_output_tokens": today_output,
        "cron_jobs_total": cron_total,
        "cron_jobs_enabled": cron_enabled,
        "memory_used_chars": mem_used,
        "memory_total_chars": mem_total,
        "memory_percent": round(mem_used / mem_total * 100, 1) if mem_total > 0 else 0,
        "source_distribution": source_dist
    })


# --- API: Token Trend ---
@app.route("/api/token-trend")
async def api_token_trend():
    days = int(request.args.get("days", 7))
    db = get_db()

    now = datetime.now()
    results = []
    for i in range(days - 1, -1, -1):
        day = now - timedelta(days=i)
        day_start = day.replace(hour=0, minute=0, second=0).timestamp()
        day_end = day.replace(hour=23, minute=59, second=59).timestamp()

        row = db.execute("""
            SELECT COALESCE(SUM(input_tokens),0) as inp,
                   COALESCE(SUM(output_tokens),0) as out,
                   COUNT(*) as sessions
            FROM sessions WHERE started_at >= ? AND started_at < ?
        """, (day_start, day_end)).fetchone()

        results.append({
            "date": day.strftime("%m-%d"),
            "input_tokens": row["inp"],
            "output_tokens": row["out"],
            "total_tokens": row["inp"] + row["out"],
            "sessions": row["sessions"]
        })

    db.close()
    return jsonify(results)


# --- API: Security Events (structured summaries) ---
@app.route("/api/security-events")
async def api_security_events():
    db = get_db()
    limit = int(request.args.get("limit", 15))

    # Job ID to event type mapping
    JOB_TYPES = {
        'f721eacc24df': {'type': 'vuln_tracking', 'label': '漏洞追踪', 'icon': 'shield'},
        '172f0e3f08af': {'type': 'attack_sim', 'label': 'AD域攻击模拟', 'icon': 'sword'},
        'ddb63af96737': {'type': 'attack_sim', 'label': '终端攻击模拟', 'icon': 'terminal'},
        'beffcc9eee81': {'type': 'email_security', 'label': '邮件安全', 'icon': 'mail'},
        'e5eccc44d2fa': {'type': 'daily_report', 'label': '安全日报', 'icon': 'report'},
        '614ad4c64bdb': {'type': 'vuln_assessment', 'label': '漏洞研判', 'icon': 'search'},
    }

    def parse_event_from_content(content, event_type_info):
        """Extract structured summary from assistant's final response"""
        if not content or len(content) < 50:
            return None

        ev = {'status': 'completed', 'risk_level': 'Info', 'summary': '', 'entities': [], 'verdict': ''}
        etype = event_type_info['type']

        # Status detection
        has_ok = '\u2705' in content or '成功' in content
        has_fail = '\u274c' in content or '失败' in content or '超时' in content or 'failed' in content.lower()
        if has_fail and has_ok:
            ev['status'] = 'partial'
        elif has_fail:
            ev['status'] = 'failed'

        # Risk level
        score_m = re.search(r'(\d+)/100', content)
        if score_m:
            s = int(score_m.group(1))
            ev['risk_level'] = 'Critical' if s >= 80 else 'High' if s >= 60 else 'Medium' if s >= 40 else 'Low' if s >= 20 else 'Info'
        elif '**High**' in content or '高危' in content:
            ev['risk_level'] = 'High'
        elif '**Critical**' in content:
            ev['risk_level'] = 'Critical'
        elif '**Medium**' in content or '中危' in content:
            ev['risk_level'] = 'Medium'
        elif '**Low**' in content or '低危' in content:
            ev['risk_level'] = 'Low'

        # Entities (CVE, IP, domains)
        cves = list(set(re.findall(r'CVE-\d{4}-\d{4,}', content)))[:3]
        ips = [ip for ip in set(re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', content))
               if not ip.startswith('127.') and not ip.startswith('0.') and ip != '172.18.40.152' and ip != '172.18.35.16'][:3]
        domains = list(set(re.findall(r'`([a-z0-9][-a-z0-9]*(?:\.[a-z0-9][-a-z0-9]*)+)`', content)))[:2]
        ev['entities'] = cves + ips + domains

        # Type-specific summary extraction
        if etype == 'vuln_tracking':
            vuln_rows = re.findall(r'\|\s*(.+?)\s*\|.*?\*\*(\w+)\*\*', content)
            if vuln_rows:
                high_c = sum(1 for _, lvl in vuln_rows if lvl in ('High', 'Critical'))
                ev['summary'] = f"发现 {len(vuln_rows)} 个漏洞，{high_c} 个高危，已推送 Slack 并创建工单"
                ev['risk_level'] = 'High' if high_c > 0 else 'Low'
            elif '未发现新的漏洞' in content:
                ev['summary'] = '近期未发现新的漏洞情报'
            else:
                ev['summary'] = '漏洞情报追踪完成'

        elif etype == 'attack_sim':
            if '连接超时' in content or 'Timeout' in content or '不可达' in content:
                ev['summary'] = '攻击模拟执行失败：目标主机连接超时'
                ev['status'] = 'failed'
                ev['risk_level'] = 'Medium'
            elif '0 条事件' in content or '0条' in content:
                ev['summary'] = '攻击模拟已执行，SIEM 未检测到对应告警（检测缺口）'
                ev['risk_level'] = 'High'
            elif 'Splunk' in content and ('检测' in content or '告警' in content or 'event' in content.lower()):
                ev['summary'] = '攻击模拟已执行，SIEM 成功检测到告警（检测有效）'
                ev['risk_level'] = 'Low'
                ev['verdict'] = '检测有效'
            else:
                ev['summary'] = '攻击模拟工作流执行完成'

        elif etype == 'email_security':
            if 'no_new_emails' in content or '0 unread' in content.lower() or 'no unread' in content.lower():
                ev['summary'] = '未发现新的可疑邮件'
            elif '钓鱼' in content or 'phishing' in content.lower():
                ev['summary'] = '检测到可疑钓鱼邮件，已完成分析'
                ev['risk_level'] = 'High'
            else:
                ev['summary'] = '邮件安全扫描完成'

        elif etype == 'vuln_assessment':
            if '无待处理' in content or '0 issues' in content or '0 results' in content:
                ev['summary'] = '无待研判的漏洞工单'
            elif '【AI研判】' in content and ('skip' in content.lower() or '已有' in content):
                ev['summary'] = 'VMS 工单已完成 AI 研判，无新增'
            elif '处理了' in content:
                count_m = re.search(r'处理了\s*(\d+)', content)
                n = count_m.group(1) if count_m else '若干'
                ev['summary'] = f"完成 {n} 个漏洞工单的 AI 研判与流转"
                ev['risk_level'] = 'Medium'
            else:
                ev['summary'] = '漏洞研判轮询完成'

        elif etype == 'daily_report':
            ev['summary'] = '已生成并推送 AISOC 安全运营日报'

        # Fallback
        if not ev['summary']:
            for line in content.split('\n'):
                line = line.strip().lstrip('#').lstrip('-').lstrip('*').strip()
                if len(line) > 15 and not line.startswith('|') and not line.startswith('```'):
                    ev['summary'] = line[:120]
                    break

        return ev

    def parse_manual_investigation(content, title):
        """Extract summary from manual security investigation"""
        ev = {'status': 'completed', 'risk_level': 'Info', 'summary': '', 'entities': [], 'verdict': ''}

        # Risk score
        score_m = re.search(r'(\d+)/100', content)
        if score_m:
            s = int(score_m.group(1))
            ev['risk_level'] = 'Critical' if s >= 80 else 'High' if s >= 60 else 'Medium' if s >= 40 else 'Low' if s >= 20 else 'Info'

        # Verdict (TP/FP/BTP)
        verdict_m = re.search(r'\*\*(TP|FP|BTP|良性真阳性|恶意|Benign|Malicious).*?\*\*', content)
        if verdict_m:
            v = verdict_m.group(1)
            ev['verdict'] = {'良性真阳性': 'BTP', 'Benign': 'BTP', 'Malicious': 'TP', '恶意': 'TP'}.get(v, v)

        # Entities
        cves = list(set(re.findall(r'CVE-\d{4}-\d{4,}', content)))[:3]
        ips = [ip for ip in set(re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', content))
               if not ip.startswith('127.') and not ip.startswith('0.') and ip != '172.18.40.152'][:3]
        domains = list(set(re.findall(r'`([a-z0-9][-a-z0-9]*(?:\.[a-z0-9][-a-z0-9]*)+)`', content)))[:2]
        ev['entities'] = cves + ips + domains

        # Summary from 调查摘要 section
        summary_m = re.search(r'【调查摘要】\s*\n+(.+?)(?:\n\n|\n---|\n#)', content, re.DOTALL)
        if summary_m:
            ev['summary'] = re.sub(r'\*+', '', summary_m.group(1).strip())[:200]
        elif '结论' in content:
            conclusion_m = re.search(r'结论[：:]\s*\*{0,2}(.+?)\*{0,2}\s*(?:\n|$)', content)
            if conclusion_m:
                ev['summary'] = conclusion_m.group(1).strip()[:200]

        if not ev['summary']:
            ev['summary'] = title

        return ev

    events = []

    # === Part 1: Cron security events ===
    seven_days_ago = time.time() - 7 * 86400
    cron_rows = db.execute("""
        SELECT id, started_at, ended_at, input_tokens + output_tokens as total_tokens
        FROM sessions WHERE id LIKE 'cron_%' AND started_at > ?
        ORDER BY started_at DESC
    """, (seven_days_ago,)).fetchall()

    # Deduplicate: keep only most recent "no findings" per type
    seen_empty = set()
    for r in cron_rows:
        parts = r["id"].split("_")
        if len(parts) < 2:
            continue
        job_prefix = parts[1]
        if job_prefix not in JOB_TYPES:
            continue

        type_info = JOB_TYPES[job_prefix]

        # Get last assistant message (the conclusion)
        msg = db.execute("""
            SELECT content FROM messages
            WHERE session_id = ? AND role = 'assistant' AND content IS NOT NULL AND length(content) > 50
            ORDER BY id DESC LIMIT 1
        """, (r["id"],)).fetchone()

        if not msg:
            continue

        parsed = parse_event_from_content(msg["content"], type_info)
        if not parsed:
            continue

        # Deduplicate empty/info results (keep only 1 per type)
        if parsed['risk_level'] == 'Info' and parsed['summary'] in (
            '未发现新的可疑邮件', '无待研判的漏洞工单', 'VMS 工单已完成 AI 研判，无新增',
            '近期未发现新的漏洞情报', '邮件安全扫描完成'
        ):
            key = f"{type_info['type']}_{parsed['summary']}"
            if key in seen_empty:
                continue
            seen_empty.add(key)

        # Compute duration
        duration = None
        if r["ended_at"] and r["started_at"]:
            duration = int(r["ended_at"] - r["started_at"])
        else:
            last_msg_t = db.execute("SELECT MAX(timestamp) as t FROM messages WHERE session_id=?", (r["id"],)).fetchone()
            if last_msg_t and last_msg_t["t"] and r["started_at"]:
                duration = int(last_msg_t["t"] - r["started_at"])

        events.append({
            "session_id": r["id"],
            "type": type_info["type"],
            "type_label": type_info["label"],
            "icon": type_info["icon"],
            "time": r["started_at"],
            "status": parsed["status"],
            "risk_level": parsed["risk_level"],
            "summary": parsed["summary"],
            "entities": parsed["entities"],
            "verdict": parsed.get("verdict", ""),
            "tokens": r["total_tokens"],
            "duration": duration,
            "source": "cron"
        })

    # === Part 2: Manual security investigations ===
    manual_rows = db.execute("""
        SELECT id, title, source, started_at, ended_at,
               input_tokens + output_tokens as total_tokens
        FROM sessions
        WHERE source != 'cron' AND started_at > ?
        AND (title LIKE '%调查%' OR title LIKE '%威胁%' OR title LIKE '%IOC%'
             OR title LIKE '%恶意%' OR title LIKE '%xred%')
        ORDER BY started_at DESC LIMIT 10
    """, (seven_days_ago,)).fetchall()

    for r in manual_rows:
        msg = db.execute("""
            SELECT content FROM messages
            WHERE session_id = ? AND role = 'assistant' AND content IS NOT NULL AND length(content) > 100
            ORDER BY id DESC LIMIT 1
        """, (r["id"],)).fetchone()
        if not msg:
            continue

        parsed = parse_manual_investigation(msg["content"], r["title"] or "安全调查")

        duration = None
        if r["ended_at"] and r["started_at"]:
            duration = int(r["ended_at"] - r["started_at"])
        else:
            last_msg_t = db.execute("SELECT MAX(timestamp) as t FROM messages WHERE session_id=?", (r["id"],)).fetchone()
            if last_msg_t and last_msg_t["t"] and r["started_at"]:
                duration = int(last_msg_t["t"] - r["started_at"])

        events.append({
            "session_id": r["id"],
            "type": "investigation",
            "type_label": "安全调查",
            "icon": "investigate",
            "time": r["started_at"],
            "status": parsed["status"],
            "risk_level": parsed["risk_level"],
            "summary": parsed["summary"],
            "entities": parsed["entities"],
            "verdict": parsed.get("verdict", ""),
            "tokens": r["total_tokens"],
            "duration": duration,
            "source": r["source"]
        })

    # Sort by time desc, limit
    events.sort(key=lambda x: x["time"] or 0, reverse=True)
    db.close()
    return jsonify(events[:limit])


# --- API: Cron Jobs ---
@app.route("/api/cronjobs")
async def api_cronjobs():
    if not os.path.exists(JOBS_FILE):
        return jsonify([])

    with open(JOBS_FILE) as f:
        data = json.load(f)

    jobs = data.get("jobs", [])
    db = get_db()
    result = []

    for j in jobs:
        job_id = j["id"]
        # Get last run info from sessions
        last_run = db.execute("""
            SELECT id, started_at, ended_at, input_tokens + output_tokens as total_tokens, end_reason
            FROM sessions WHERE id LIKE ? ORDER BY started_at DESC LIMIT 1
        """, (f"cron_{job_id}%",)).fetchone()

        schedule = j.get("schedule", {})
        if isinstance(schedule, dict):
            schedule_str = schedule.get("display", schedule.get("expr", "unknown"))
        else:
            schedule_str = str(schedule)

        result.append({
            "id": job_id,
            "name": j.get("name", "unnamed"),
            "enabled": j.get("enabled", True),
            "schedule": schedule_str,
            "last_run": {
                "session_id": last_run["id"],
                "started_at": last_run["started_at"],
                "ended_at": last_run["ended_at"],
                "tokens": last_run["total_tokens"],
                "status": last_run["end_reason"] or "completed"
            } if last_run else None,
            "run_count": db.execute("SELECT COUNT(*) FROM sessions WHERE id LIKE ?", (f"cron_{job_id}%",)).fetchone()[0]
        })

    db.close()
    return jsonify(result)


# --- API: Cron Job History ---
@app.route("/api/cronjobs/<job_id>/history")
async def api_cron_history(job_id):
    db = get_db()
    rows = db.execute("""
        SELECT id, started_at, ended_at, message_count,
               input_tokens + output_tokens as total_tokens, end_reason
        FROM sessions WHERE id LIKE ?
        ORDER BY started_at DESC LIMIT 20
    """, (f"cron_{job_id}%",)).fetchall()

    history = []
    for r in rows:
        duration = None
        if r["ended_at"] and r["started_at"]:
            duration = int(r["ended_at"] - r["started_at"])
        history.append({
            "session_id": r["id"],
            "started_at": r["started_at"],
            "ended_at": r["ended_at"],
            "duration_seconds": duration,
            "messages": r["message_count"],
            "tokens": r["total_tokens"],
            "status": r["end_reason"] or "completed"
        })

    db.close()
    return jsonify(history)


# --- API: Session Detail (execution messages) ---
@app.route("/api/sessions/<session_id>/detail")
async def api_session_detail(session_id):
    db = get_db()

    # Get session info
    session = db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if not session:
        db.close()
        return jsonify({"error": "Session not found"}), 404

    # Get messages (limit to user + assistant, skip huge tool outputs)
    messages = db.execute("""
        SELECT role, content, tool_name, timestamp
        FROM messages WHERE session_id = ?
        ORDER BY timestamp
    """, (session_id,)).fetchall()

    msg_list = []
    for m in messages:
        content = m["content"] or ""
        # Truncate very long tool outputs
        if m["role"] == "tool" and len(content) > 500:
            content = content[:500] + "...[truncated]"
        # Skip empty assistant messages (thinking turns)
        if m["role"] == "assistant" and not content:
            continue

        msg_list.append({
            "role": m["role"],
            "content": content,
            "tool_name": m["tool_name"],
            "timestamp": m["timestamp"]
        })

    db.close()
    return jsonify({
        "session_id": session_id,
        "source": session["source"],
        "model": session["model"],
        "started_at": session["started_at"],
        "ended_at": session["ended_at"],
        "message_count": session["message_count"],
        "tokens": (session["input_tokens"] or 0) + (session["output_tokens"] or 0),
        "messages": msg_list
    })


# --- API: Keywords ---
@app.route("/api/keywords")
async def api_keywords():
    db = get_db()

    # Get recent session titles and first user messages (exclude auto-generated)
    seven_days_ago = time.time() - 7 * 86400
    rows = db.execute("""
        SELECT s.id, s.title, s.source, (
            SELECT substr(m.content, 1, 200) FROM messages m
            WHERE m.session_id = s.id AND m.role = 'user'
            ORDER BY m.timestamp LIMIT 1
        ) as first_msg
        FROM sessions s
        WHERE s.started_at > ? AND s.message_count >= 4
        ORDER BY s.started_at DESC LIMIT 80
    """, (seven_days_ago,)).fetchall()

    # Extract keywords from titles and first messages
    text_pool = []
    for r in rows:
        title = r["title"] or ""
        # Skip auto-generated sessions
        if '### Task:' in title or 'Suggest 3-5' in title or 'Generate' in title:
            continue
        if title:
            # Clean cron prefixes
            title = re.sub(r'^\[IMPORTANT:.*?\]\s*', '', title)
            title = re.sub(r'^---\s*\n?name:\s*\S+\s*', '', title)
            text_pool.append(title)
        if r["first_msg"]:
            msg = r["first_msg"]
            msg = re.sub(r'^\[IMPORTANT:.*?\]\s*', '', msg)
            msg = re.sub(r'^---\s*\n?name:\s*\S+\s*', '', msg)
            text_pool.append(msg)

    all_text = " ".join(text_pool)

    # English keywords - aggressive stop words
    en_stops = {'the','a','an','is','are','was','were','be','been','being','have','has','had',
                'do','does','did','will','would','could','should','may','might','shall','can',
                'to','of','in','for','on','with','at','by','from','as','into','through','during',
                'before','after','above','below','between','under','again','further','then','once',
                'here','there','when','where','why','how','all','each','every','both','few','more',
                'most','other','some','such','no','nor','not','only','own','same','so','than','too',
                'very','just','because','but','and','or','if','while','about','against','this',
                'that','these','those','it','its','my','your','his','her','their','our','which',
                'what','who','whom','whose','i','you','he','she','we','they','me','him','us','them',
                'up','out','also','new','one','two','well','way','use','used','using','like',
                'make','get','set','run','see','know','need','want','look','find','give','tell',
                'think','say','try','come','go','take','let','put','still','back','even','much',
                'now','already','since','over','any','been','being','must','should','would','could',
                'please','note','however','also','sure','right','left','first','last','next',
                'data','file','system','user','time','name','type','list','help','work','based',
                'current','following','information','provide','check','include','available',
                'conversation','message','messages','session','content','response','prompt',
                'tool','function','parameter','result','output','input','error','status',
                'skill','loaded','invoked','indicating','instructions','full','chat','history',
                'task','suggest','relevant','follow','questions','generate','concise','word',
                'title','emoji','broad','tags','categorizing','themes','guidelines','important',
                'running','scheduled','cron','delivery','final','automatic','automatically',
                'delivered','target','channel','without','confirmation','will','your','below',
                'replying','testing','perform','description','clarify','end-to-e',
                'prior','messages','naturally','deepen','offering','assuming',
                'options','yourself','deliver','send_message','http','https',
                'true','false','none','null','undefined','return'}

    en_words = re.findall(r'\b[A-Za-z][A-Za-z0-9_-]{3,}\b', all_text)
    en_freq = {}
    for w in en_words:
        wl = w.lower()
        if wl not in en_stops and len(w) >= 4 and len(w) <= 30 and not w.startswith('202') and not w.startswith('xn--'):
            en_freq[w] = en_freq.get(w, 0) + 1

    # Chinese keywords (2-8 chars)
    cn_stops = {'的','了','在','是','我','你','他','她','它','们','这','那','有','和','与','或',
                '不','也','都','就','要','会','能','可以','应该','已经','因为','所以','如果',
                '但是','而且','虽然','然后','进行','通过','使用','需要','可能','已经','正在',
                '什么','怎么','哪里','为什么','一个','这个','那个','一些','没有','可以',
                '关于','对于','根据','按照','目前','当前','以下','以上','其他','所有',
                '请','好的','谢谢','帮我','看看','确认','继续','开始','完成',
                '请你','一下','内容','显示','支持','优化','问题','功能','页面',
                '前端','开发','列表','数据','文件','结构','系统','信息'}
    cn_pattern = re.compile(r'[\u4e00-\u9fff]{2,8}')
    cn_words = cn_pattern.findall(all_text)
    cn_freq = {}
    for w in cn_words:
        if w not in cn_stops and len(w) >= 2:
            cn_freq[w] = cn_freq.get(w, 0) + 1

    # Combine top keywords (prefer quality over quantity)
    en_top = sorted(en_freq.items(), key=lambda x: -x[1])[:12]
    cn_top = sorted(cn_freq.items(), key=lambda x: -x[1])[:12]

    keywords = []
    for word, count in en_top:
        if count >= 2:
            keywords.append({"word": word, "count": count, "lang": "en"})
    for word, count in cn_top:
        if count >= 2:
            keywords.append({"word": word, "count": count, "lang": "zh"})

    # Sort by count descending
    keywords.sort(key=lambda x: -x["count"])

    db.close()
    return jsonify(keywords[:20])


# --- API: Keyword Drilldown ---
@app.route("/api/keywords/<keyword>/sessions")
async def api_keyword_sessions(keyword):
    db = get_db()
    seven_days_ago = time.time() - 7 * 86400

    # Search sessions containing keyword in title or first message
    rows = db.execute("""
        SELECT s.id, s.title, s.source, s.started_at, s.message_count,
               s.input_tokens + s.output_tokens as total_tokens
        FROM sessions s
        WHERE s.started_at > ? AND (
            s.title LIKE ? OR s.id IN (
                SELECT session_id FROM messages WHERE content LIKE ? AND role='user'
            )
        )
        ORDER BY s.started_at DESC LIMIT 10
    """, (seven_days_ago, f"%{keyword}%", f"%{keyword}%")).fetchall()

    results = []
    for r in rows:
        title = r["title"]
        if not title:
            msg = db.execute("SELECT substr(content,1,120) as c FROM messages WHERE session_id=? AND role='user' ORDER BY timestamp LIMIT 1", (r["id"],)).fetchone()
            title = msg["c"] if msg else r["id"]
        results.append({
            "session_id": r["id"],
            "title": title,
            "source": r["source"],
            "started_at": r["started_at"],
            "messages": r["message_count"],
            "tokens": r["total_tokens"]
        })

    db.close()
    return jsonify(results)


# --- API: Cron Job Token Distribution ---
@app.route("/api/cron-token-dist")
async def api_cron_token_dist():
    """计划任务 Token 消耗占比 — 支持 today/7d/30d"""
    period = request.args.get("period", "today")  # today, 7d, 30d
    db = get_db()

    now = time.time()
    if period == "today":
        since = datetime.now().replace(hour=0, minute=0, second=0).timestamp()
    elif period == "7d":
        since = now - 7 * 86400
    else:
        since = now - 30 * 86400

    # Get job names mapping
    job_names = {}
    if os.path.exists(JOBS_FILE):
        with open(JOBS_FILE) as f:
            for job in json.load(f).get("jobs", []):
                job_names[job["id"][:12]] = job.get("name", job["id"][:12])

    # Query cron sessions grouped by job_id (first 12 chars after "cron_")
    rows = db.execute("""
        SELECT
            SUBSTR(id, 6, 12) as job_id,
            COUNT(*) as runs,
            COALESCE(SUM(input_tokens), 0) as input_tokens,
            COALESCE(SUM(output_tokens), 0) as output_tokens,
            COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) as io_tokens,
            COALESCE(SUM(cache_read_tokens), 0) as cache_read,
            COALESCE(SUM(cache_write_tokens), 0) as cache_write
        FROM sessions
        WHERE source = 'cron'
          AND id LIKE 'cron_%'
          AND started_at >= ?
        GROUP BY SUBSTR(id, 6, 12)
        ORDER BY io_tokens DESC
    """, (since,)).fetchall()

    # Also get non-cron total for comparison
    non_cron = db.execute("""
        SELECT
            COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) as io_tokens
        FROM sessions
        WHERE source != 'cron'
          AND started_at >= ?
    """, (since,)).fetchone()
    non_cron_tokens = non_cron["io_tokens"] if non_cron else 0

    total_cron = sum(r["io_tokens"] for r in rows)
    grand_total = total_cron + non_cron_tokens

    results = []
    for r in rows:
        name = job_names.get(r["job_id"], r["job_id"])
        results.append({
            "job_id": r["job_id"],
            "name": name,
            "runs": r["runs"],
            "input_tokens": r["input_tokens"],
            "output_tokens": r["output_tokens"],
            "io_tokens": r["io_tokens"],
            "cache_read": r["cache_read"],
            "cache_write": r["cache_write"],
            "percent_of_cron": round(r["io_tokens"] / total_cron * 100, 1) if total_cron > 0 else 0,
            "percent_of_total": round(r["io_tokens"] / grand_total * 100, 1) if grand_total > 0 else 0
        })

    db.close()
    return jsonify({
        "period": period,
        "total_cron_tokens": total_cron,
        "non_cron_tokens": non_cron_tokens,
        "grand_total": grand_total,
        "cron_percent": round(total_cron / grand_total * 100, 1) if grand_total > 0 else 0,
        "jobs": results
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8890)
