// 상태 엔진: <status> 변화량 → 상태 재계산 · 직접 편집 기록 · 프롬프트 주입
import {
    app, ctx, settings, getMeta, saveMeta, modOn, MOD_IDS, MOD, EMPTY, NORM, normalize, clone, clamp, num, norm, findBy, parseNum, splitBar,
    signed, fmtNum, short, dayIndex, addDays, dateStr, eventsOn, parseDate, nowTick, tickUnit, stamp, esc, TITLE, INJECT_KEY, INJECT_KEY2,
    PROMPT_IN_CHAT, ROLE_SYSTEM, MODULE, uid, diffOf, LOG, CONTACT_MODES,
} from './core.js';
import { P } from './prompts.js';

export const KEYMAP = {
    stat: 'stat', '수치': 'stat', '게이지': 'stat', gauge: 'stat', hp: 'stat',
    attr: 'attr', '능력치': 'attr', '능력': 'attr',
    cond: 'cond', '상태': 'cond', '상태이상': 'cond', buff: 'cond', '버프': 'cond', condition: 'cond',
    cash: 'cash', money: 'cash', '돈': 'cash', '재산': 'cash', '소지금': 'cash', gold: 'cash',
    item: 'item', items: 'item', '아이템': 'item', '소지품': 'item',
    stock: 'stock', '상품': 'stock', '입고': 'stock',
    decor: 'decor', '가구': 'decor', '장식': 'decor',
    room: 'room', '방': 'room',
    loc: 'loc', '위치': 'loc', '장소': 'loc', location: 'loc',
    place: 'place', '발견장소': 'place', '새장소': 'place',
    aff: 'aff', '호감': 'aff', '호감도': 'aff', trust: 'trust', '신뢰': 'trust', '신뢰도': 'trust',
    rel: 'rel', '관계': 'rel', pair: 'pair', '인물관계': 'pair',
    date: 'date', '날짜': 'date', day: 'date', '일': 'date', time: 'time', '시간': 'time', '시간대': 'time',
    event: 'event', '일정': 'event',
    ach: 'ach', '업적': 'ach', achievement: 'ach',
    memo: 'memo', '메모': 'memo', note: 'memo',
    msg: 'msg', '연락': 'msg', '문자': 'msg', message: 'msg', '메시지': 'msg', letter: 'msg', '편지': 'msg',
    npc: 'npc', '인물': 'npc', '새인물': 'npc',
    roll: 'roll', '판정': 'roll', '판정요청': 'roll',
    quest: 'quest', '퀘스트': 'quest', '의뢰': 'quest',
    news: 'news', '뉴스': 'news', '소식': 'news',
    rumor: 'rumor', gossip: 'rumor', '소문': 'rumor', '가십': 'rumor',
    post: 'post', '게시글': 'post', '게시판': 'post',
};
export const KEY_MOD = {
    stat: 'stats', attr: 'stats', cond: 'stats', cash: 'wallet', item: 'wallet', stock: 'shop', decor: 'home', room: 'home', loc: 'map', place: 'map',
    aff: 'rel', trust: 'rel', rel: 'rel', pair: 'rel', date: 'calendar', time: 'calendar', event: 'calendar', ach: 'ach', memo: 'memo', msg: 'contact',
    npc: 'profile', roll: 'dice', quest: 'quest', news: 'news', rumor: 'gossip', post: 'board',
};

const BLOCK_RE = /<status>([\s\S]*?)(?:<\/status>|$)/gi;
export function extractOps(text) {
    const ops = [];
    if (!text || !/<status>/i.test(text)) return ops;
    for (const m of String(text).matchAll(BLOCK_RE)) {
        for (const line of m[1].split(/\r?\n/)) {
            const lm = line.match(/^\s*[-*•]?\s*([^:：\n]{1,24}?)\s*[:：]\s*(.+?)\s*$/);
            if (lm) ops.push([lm[1].trim(), lm[2]]);
        }
    }
    return ops;
}
export const stripStatus = (t) => String(t ?? '').replace(/<status>[\s\S]*?(?:<\/status>|$)/gi, '').trim();

function ensure(s, mod) {
    if (!s.data[mod]) s.data[mod] = EMPTY[mod]();
    return s.data[mod];
}
const QSTATUS = { open: 'open', new: 'open', '새': 'open', '등록': 'open', '공고': 'open', active: 'active', '수락': 'active', '진행': 'active', '진행중': 'active', '시작': 'active', done: 'done', '완료': 'done', '성공': 'done', '달성': 'done', failed: 'failed', fail: 'failed', '실패': 'failed', '포기': 'failed' };
const QNAME = { open: '새 의뢰', active: '진행', done: '완료', failed: '실패' };

export function applyOp(s, rawKey, rawVal, info) {
    let key = KEYMAP[String(rawKey).trim().toLowerCase()] ?? (String(rawKey).startsWith('_') ? String(rawKey) : null);
    let val = String(rawVal ?? '').trim();
    if (!key) {
        const nm = String(rawKey).trim();
        if (s.data.stats && findBy(s.data.stats.bars, nm)) { key = 'stat'; val = `${nm} ${val}`; }
        else if (s.data.stats && findBy(s.data.stats.attrs, nm)) { key = 'attr'; val = `${nm} ${val}`; }
        else if (s.data.wallet && norm(nm) === norm(s.data.wallet.currency)) key = 'cash';
        else return;
    }
    const mod = KEY_MOD[key];
    if (mod && info.mods && info.mods[mod] === false) return;
    if (!val && !key.startsWith('_')) return;
    const L = (t) => info.labels.push(t);
    switch (key) {
        case 'stat': {
            const st = ensure(s, 'stats');
            const m = val.match(/^(.+?)\s*(max|최대)?\s*([=+\-−][\d.,]+|\d[\d.,]*)\s*$/i);
            if (!m) return;
            let bar = findBy(st.bars, m[1]);
            if (!bar) { bar = { name: m[1].trim(), cur: 100, max: 100, color: '', desc: '' }; st.bars.push(bar); }
            const p = parseNum(m[3]);
            if (!p) return;
            if (m[2]) { const b = bar.max; bar.max = Math.max(1, p.mode === 'add' ? bar.max + p.v : p.v); bar.cur = Math.min(bar.cur, bar.max); L(`${bar.name} 최대 ${signed(bar.max - b)}`); return; }
            const before = bar.cur;
            bar.cur = clamp(p.mode === 'add' ? bar.cur + p.v : p.v, 0, bar.max);
            if (bar.cur !== before) L(`${bar.name} ${signed(bar.cur - before)}`);
            if (before > 0 && bar.cur <= 0) info.alerts.push(`${bar.name}이(가) 0이 되었다`);
            return;
        }
        case 'attr': {
            const st = ensure(s, 'stats');
            const m = val.match(/^(.+?)\s*([=+\-−][\d.]+|\d[\d.]*)\s*$/);
            if (!m) return;
            let a = findBy(st.attrs, m[1]);
            if (!a) { a = { name: m[1].trim(), val: 0, desc: '' }; st.attrs.push(a); }
            const p = parseNum(m[2]); if (!p) return;
            const b = a.val; a.val = Math.round(p.mode === 'add' ? a.val + p.v : p.v);
            if (a.val !== b) L(`${a.name} ${signed(a.val - b)}`);
            return;
        }
        case 'cond': {
            const st = ensure(s, 'stats');
            const [n0, desc] = splitBar(val);
            const rm = /^[-−]/.test(n0);
            const name = n0.replace(/^[+\-−]\s*/, '');
            if (!name) return;
            const ex = findBy(st.conds, name);
            if (rm || /^(해제|없음)$/.test(desc ?? '')) { if (ex) { st.conds.splice(st.conds.indexOf(ex), 1); L(`해제: ${ex.name}`); } return; }
            if (ex) { if (desc) ex.desc = desc; return; }
            st.conds.push({ name, desc: desc ?? '' }); L(`상태: ${name}`);
            return;
        }
        case 'cash': {
            const w = ensure(s, 'wallet');
            const p = parseNum(val); if (!p) return;
            const b = w.cash; w.cash = Math.max(0, p.mode === 'add' ? w.cash + p.v : p.v);
            if (w.cash !== b) L(`${w.currency} ${signed(w.cash - b)}`);
            return;
        }
        case 'item': {
            const w = ensure(s, 'wallet');
            const parts = val.includes('|') ? [val] : val.split(/\s*[,，/]\s*/);
            for (const part of parts) {
                const [head, desc] = splitBar(part);
                const m = head.match(/^([+\-−]?)\s*(.+?)(?:\s*[x×*]?\s*(\d+)\s*(?:개|장|병|권|통)?)?$/);
                if (!m) continue;
                const rm = m[1] === '-' || m[1] === '−';
                const name = m[2].trim(); const q = Math.max(1, parseInt(m[3] || '1', 10));
                if (!name) continue;
                const ex = findBy(w.items, name);
                if (rm) {
                    if (!ex) continue;
                    ex.qty -= q; if (ex.qty <= 0) w.items.splice(w.items.indexOf(ex), 1);
                    L(`−${ex.name}${q > 1 ? `×${q}` : ''}`);
                } else {
                    if (ex) { ex.qty += q; if (desc) ex.desc = desc; } else w.items.push({ name, qty: q, desc: desc ?? '' });
                    L(`+${name}${q > 1 ? `×${q}` : ''}`);
                }
            }
            return;
        }
        case 'stock': {
            const sh = ensure(s, 'shop');
            const [sn, iname, price, desc] = splitBar(val);
            if (!sn || !iname) return;
            let shop = findBy(sh.shops, sn);
            if (!shop) { shop = { name: sn, desc: '', place: '', items: [] }; sh.shops.push(shop); }
            const rm = /^[-−]/.test(iname); const nm = iname.replace(/^[+\-−]\s*/, '');
            const ex = findBy(shop.items, nm);
            if (rm) { if (ex) { shop.items.splice(shop.items.indexOf(ex), 1); L(`🏪 ${shop.name} −${ex.name}`); } return; }
            const pr = parseNum(price)?.v;
            if (ex) { if (pr !== undefined) ex.price = Math.abs(pr); if (desc) ex.desc = desc; }
            else shop.items.push({ name: nm, price: Math.abs(pr ?? 0), desc: desc ?? '', kind: /가구|장식|deco/i.test(desc ?? '') ? 'deco' : 'item', stock: -1 });
            L(`🏪 ${shop.name}: ${nm}`);
            return;
        }
        case 'decor': {
            const hm = ensure(s, 'home');
            const [n0, roomName] = splitBar(val);
            const rm = /^[-−]/.test(n0); const nm = n0.replace(/^[+\-−]\s*/, '');
            if (!nm) return;
            if (rm) {
                for (const r of hm.rooms) { const k = r.decor.findIndex(x => norm(x) === norm(nm)); if (k >= 0) { r.decor.splice(k, 1); break; } }
                const k = hm.storage.findIndex(x => norm(x) === norm(nm)); if (k >= 0) hm.storage.splice(k, 1);
                L(`🏠 −${nm}`); return;
            }
            const room = roomName ? findBy(hm.rooms, roomName) : null;
            const si = hm.storage.findIndex(x => norm(x) === norm(nm));
            if (room) {
                if (si >= 0) hm.storage.splice(si, 1);
                else for (const r of hm.rooms) { const k = r.decor.findIndex(x => norm(x) === norm(nm)); if (k >= 0) { r.decor.splice(k, 1); break; } }
                room.decor.push(nm); L(`🏠 ${room.name}에 ${nm}`);
            } else { hm.storage.push(nm); L(`🏠 창고 +${nm}`); }
            return;
        }
        case '_unplace': {
            const hm = ensure(s, 'home');
            for (const r of hm.rooms) { const k = r.decor.findIndex(x => norm(x) === norm(val)); if (k >= 0) { r.decor.splice(k, 1); hm.storage.push(val); return; } }
            return;
        }
        case 'room': {
            const hm = ensure(s, 'home');
            const [n0, desc] = splitBar(val);
            const nm = n0.replace(/^[+]\s*/, '');
            const ex = findBy(hm.rooms, nm);
            if (ex) { if (desc) ex.desc = desc; } else { hm.rooms.push({ name: nm, desc: desc ?? '', decor: [] }); L(`🏠 새 공간: ${nm}`); }
            return;
        }
        case 'loc': {
            const mp = ensure(s, 'map');
            const [nm, desc] = splitBar(val);
            if (!nm) return;
            let p = findBy(mp.places, nm);
            if (!p) {
                const from = findBy(mp.places, mp.here);
                p = { name: nm, desc: desc ?? '', kind: '', x: NaN, y: NaN, links: from ? [from.name] : [], known: true };
                if (from && !from.links.some(l => norm(l) === norm(nm))) from.links.push(nm);
                mp.places.push(p);
            }
            p.known = true;
            if (norm(mp.here) !== norm(p.name)) { mp.here = p.name; L(`📍 ${p.name}`); }
            return;
        }
        case 'place': {
            const mp = ensure(s, 'map');
            const [nm, desc, links] = splitBar(val);
            if (!nm) return;
            let p = findBy(mp.places, nm);
            const lk = String(links ?? '').split(/\s*[,，]\s*/).filter(Boolean);
            if (!p) { p = { name: nm, desc: desc ?? '', kind: '', x: NaN, y: NaN, links: lk, known: true }; mp.places.push(p); L(`🗺️ 새 장소: ${nm}`); }
            else { if (desc) p.desc = desc; if (!p.known) L(`🗺️ 발견: ${p.name}`); p.known = true; for (const l of lk) if (!p.links.some(x => norm(x) === norm(l))) p.links.push(l); }
            for (const l of lk) { const q = findBy(mp.places, l); if (q && !q.links.some(x => norm(x) === norm(p.name))) q.links.push(p.name); }
            return;
        }
        case 'aff': case 'trust': {
            const rl = ensure(s, 'rel');
            const m = val.match(/^(.+?)\s*([=+\-−]\s*[\d.]+|\d[\d.]*)\s*(?:\|\s*(.*))?$/);
            if (!m) return;
            const nm = m[1].trim();
            let r = findBy(rl.user, nm);
            if (!r) { r = { name: nm, label: '', aff: 0, trust: 0, memo: '' }; rl.user.push(r); }
            const p = parseNum(m[2].replace(/\s+/g, '')); if (!p) return;
            const b = r[key]; r[key] = clamp(Math.round(p.mode === 'add' ? b + p.v : p.v), -100, 100);
            if (m[3]) r.memo = m[3];
            if (r[key] !== b) L(`${key === 'aff' ? '♥' : '🤝'} ${r.name} ${signed(r[key] - b)}`);
            return;
        }
        case 'rel': {
            const rl = ensure(s, 'rel');
            let nm, label, memo;
            if (val.includes('=')) { [nm, label] = val.split('=').map(x => x.trim()); [label, memo] = splitBar(label); }
            else [nm, label, memo] = splitBar(val);
            if (!nm) return;
            let r = findBy(rl.user, nm);
            if (!r) { r = { name: nm, label: '', aff: 0, trust: 0, memo: '' }; rl.user.push(r); }
            if (label && label !== r.label) { r.label = label; L(`💞 ${r.name} = ${label}`); }
            if (memo) r.memo = memo;
            return;
        }
        case 'pair': {
            const rl = ensure(s, 'rel');
            const m = val.match(/^(.+?)\s*(?:&|와|과|,|↔|-)\s*(.+?)\s*[=|]\s*(.+)$/);
            if (!m) return;
            const [label, memo] = splitBar(m[3]);
            const ex = rl.pairs.find(p => (norm(p.a) === norm(m[1]) && norm(p.b) === norm(m[2])) || (norm(p.a) === norm(m[2]) && norm(p.b) === norm(m[1])));
            if (ex) { ex.label = label; if (memo) ex.memo = memo; } else rl.pairs.push({ a: m[1].trim(), b: m[2].trim(), label, memo: memo ?? '' });
            L(`💞 ${m[1].trim()}↔${m[2].trim()}: ${label}`);
            return;
        }
        case 'date': {
            const cal = ensure(s, 'calendar');
            const p = /^[+\-−]\s*\d/.test(val) ? parseNum(val.replace(/일.*$/, '')) : null;
            const before = dayIndex(cal);
            if (p) addDays(cal, p.v);
            else {
                const dt = parseDate(cal, val); if (!dt) return;
                cal.y = dt.y ?? cal.y;
                if (dt.y === null && (dt.m < cal.m || (dt.m === cal.m && dt.d < cal.d))) cal.y++;
                cal.m = clamp(dt.m, 1, cal.months.length); cal.d = clamp(dt.d, 1, cal.months[cal.m - 1].days);
            }
            const diff = dayIndex(cal) - before;
            if (diff) {
                L(`📅 ${diff > 0 ? `+${diff}일` : `${diff}일`}`);
                const ev = eventsOn(cal, cal.y, cal.m, cal.d);
                if (ev.length) info.alerts.push(`오늘의 일정: ${ev.map(e => e.title).join(', ')}`);
            }
            return;
        }
        case 'time': {
            const cal = ensure(s, 'calendar');
            if (val !== cal.time) { cal.time = val; L(`🕐 ${val}`); }
            return;
        }
        case 'event': {
            const cal = ensure(s, 'calendar');
            const [when, title, desc] = splitBar(val);
            const dt = parseDate(cal, when);
            if (!dt || !title) return;
            const rm = /^[-−]/.test(title); const tt = title.replace(/^[+\-−]\s*/, '');
            const k = cal.events.findIndex(e => norm(e.title) === norm(tt));
            if (rm) { if (k >= 0) cal.events.splice(k, 1); return; }
            const e = { y: dt.y ?? (dt.m < cal.m || (dt.m === cal.m && dt.d < cal.d) ? cal.y + 1 : cal.y), m: dt.m, d: dt.d, title: tt, desc: desc ?? '', repeat: 'once' };
            if (k >= 0) cal.events[k] = { ...cal.events[k], ...e }; else cal.events.push(e);
            L(`📅 일정: ${tt}`);
            return;
        }
        case 'ach': {
            const ac = ensure(s, 'ach');
            const [nm, desc] = splitBar(val);
            const rm = /^[-−]/.test(nm); const n = nm.replace(/^[+\-−]\s*/, '');
            let a = findBy(ac.list, n);
            if (rm) { if (a) a.done = false; return; }
            if (!a) { a = { name: n, desc: desc ?? '', done: false, hidden: false, at: '' }; ac.list.push(a); }
            if (!a.done) {
                a.done = true; a.at = stamp(s);
                L(`🏆 ${a.name}`); info.alerts.push(`업적 달성 — ${a.name}`);
            }
            return;
        }
        case 'memo': {
            const mm = ensure(s, 'memo');
            mm.list.push({ id: `${info.seed}:${mm.list.length}`, text: val, by: 'ai', inject: true, pin: false });
            if (mm.list.length > 40) { const k = mm.list.findIndex(x => x.by === 'ai' && !x.pin); if (k >= 0) mm.list.splice(k, 1); }
            L('📝 메모');
            return;
        }
        case 'msg': {
            const ct = ensure(s, 'contact');
            const [nm, ...rest] = splitBar(val);
            const text = rest.join(' | ');
            if (!nm || !text) return;
            const who = findBy(ct.contacts, nm)?.name ?? nm.trim();
            if (!findBy(ct.contacts, who)) ct.contacts.push({ name: who, handle: '', status: '', courier: '' });
            const t = nowTick(s, info.meta);
            const letter = ct.mode === 'letter';
            const cour = letter ? (findBy(ct.couriers, findBy(ct.contacts, who)?.courier)?.name ?? ct.couriers[0]?.name ?? '') : '';
            (ct.threads[who] ??= []).push({ id: `${info.seed}:m${ct.threads[who].length}`, from: 'them', text, date: stamp(s), at: t, arrive: t, courier: cour, express: false, rush: false, pending: false, fee: 0, edited: false, ping: true });
            if (ct.threads[who].length > 80) ct.threads[who] = ct.threads[who].slice(-80);
            ct.unread[who] = (ct.unread[who] ?? 0) + 1;
            L(`${letter ? '✉️ 편지' : '💬'} ${who}`);
            info.alerts.push(`${letter ? `📬 ${who}의 편지가 도착했다` : `${ct.app} — ${who}`}: ${short(text, 40)}`);
            return;
        }
        case '_read': {
            const ct = s.data.contact; if (ct) delete ct.unread[val];
            return;
        }
        case 'npc': {
            const pf = ensure(s, 'profile');
            const [nm, summary] = splitBar(val);
            if (!nm) return;
            const ex = findBy(pf.list, nm);
            if (ex) { if (summary && !ex.summary) ex.summary = summary; return; }
            pf.list.push({ name: nm.trim(), role: 'npc', summary: summary ?? '', fields: [] });
            L(`👤 ${nm.trim()}`);
            return;
        }
        case 'roll': {
            const [label, dc] = splitBar(val);
            info.roll = { label: label.trim(), dc: num(parseNum(dc)?.v, 0) };
            L(`🎲 판정 요청: ${label.trim()}`);
            return;
        }
        case '_roll': {
            const dc = ensure(s, 'dice');
            try { dc.log.push(JSON.parse(val)); } catch { /* ignore */ }
            if (dc.log.length > 30) dc.log = dc.log.slice(-30);
            return;
        }
        case 'quest': {
            const qs = ensure(s, 'quest');
            const [title, st0, desc] = splitBar(val);
            if (!title) return;
            const st = QSTATUS[norm(st0)] ?? (st0 ? null : 'open');
            let q = findBy(qs.list, title, 'title');
            if (!q) {
                q = { id: `${info.seed}:q${qs.list.length}`, title: title.trim(), giver: '', desc: desc ?? (st ? '' : st0 ?? ''), place: '', deadline: '', reward: '', cash: 0, items: [], status: st ?? 'open', steps: [], paid: false };
                qs.list.push(q);
                L(`📜 ${QNAME[q.status]}: ${q.title}`);
                if (q.status === 'open' || q.status === 'active') info.alerts.push(`퀘스트 — ${q.title}`);
            } else if (st && st !== q.status) {
                q.status = st; L(`📜 ${q.title}: ${QNAME[st]}`);
            } else if (!st && st0) {
                q.steps.push({ text: st0, done: false }); L(`📜 ${q.title}: ${short(st0, 20)}`);
            }
            if (desc && st) q.desc ||= desc;
            if (q.status === 'done' && !q.paid) payQuest(s, q, info);
            return;
        }
        case '_questpay': {
            const q = s.data.quest?.list.find(x => x.id === val);
            if (q) { q.status = 'done'; if (!q.paid) payQuest(s, q, info); }
            return;
        }
        case 'news': {
            const nw = ensure(s, 'news');
            const [title, body, tag] = splitBar(val);
            if (!title) return;
            nw.items.push({ id: `${info.seed}:n${nw.items.length}`, title, body: body ?? '', tag: tag ?? '', date: stamp(s), read: false });
            if (nw.items.length > 40) nw.items.shift();
            L(`📰 ${short(title, 18)}`);
            return;
        }
        case 'rumor': {
            const gs = ensure(s, 'gossip');
            const [title, body, about] = splitBar(val);
            if (!title) return;
            gs.issues.push({ id: `${info.seed}:g${gs.issues.length}`, title, body: body ?? '', about: String(about ?? '').split(/\s*[,，]\s*/).filter(Boolean), heat: 2, date: stamp(s), read: false });
            if (gs.issues.length > 30) gs.issues.shift();
            L(`🍷 소문: ${short(title, 16)}`);
            return;
        }
        case 'post': {
            const bd = ensure(s, 'board');
            const [author, title, body] = splitBar(val);
            if (!title) return;
            bd.posts.push({ id: `${info.seed}:p${bd.posts.length}`, author: author || '익명', title, body: body ?? '', date: stamp(s), mine: false, tag: '', replies: [] });
            if (bd.posts.length > 40) bd.posts.shift();
            L(`📋 ${short(title, 18)}`);
            return;
        }
        case '_memo': {
            const mm = ensure(s, 'memo');
            const [op, a, b] = splitBar(val);
            if (op === 'add') mm.list.push({ id: `${info.seed}`, text: a, by: 'user', inject: true, pin: false });
            const it = mm.list.find(x => x.id === a);
            if (op === 'del' && it) mm.list.splice(mm.list.indexOf(it), 1);
            if (op === 'tog' && it && (b === 'inject' || b === 'pin')) it[b] = !it[b];
            return;
        }
        case '_achtog': {
            const ac = ensure(s, 'ach');
            const a = findBy(ac.list, val);
            if (a) { a.done = !a.done; a.at = a.done ? stamp(s) : ''; }
            return;
        }
        default: return;
    }
}
function payQuest(s, q, info) {
    q.paid = true;
    if (q.cash && s.data.wallet) applyOp(s, 'cash', `+${q.cash}`, info);
    for (const it of q.items) if (s.data.wallet) applyOp(s, 'item', `+${it}`, info);
    info.alerts.push(`퀘스트 완료 — ${q.title}${q.reward ? ` (${q.reward})` : ''}`);
}

export function freshState(base) {
    const data = {};
    for (const id of MOD_IDS) data[id] = base?.data?.[id] ? clone(base.data[id]) : null;
    return { core: clone(base?.core ?? EMPTY.core()), data, pendingRoll: null, recent: [], turn: 0 };
}
function resolveStart(meta, chat) {
    let st = Math.min(meta.startAt ?? 0, chat.length);
    if (meta.startKey && chat[st - 1]?.send_date !== meta.startKey) {
        const j = chat.findIndex(m => m.send_date === meta.startKey);
        if (j >= 0) st = j + 1;
    }
    return st;
}
function msgOps(m) {
    const ops = extractOps(m.mes);
    const extra = m.extra?.[MODULE]?.bySwipe?.[m.swipe_id ?? 0];
    if (Array.isArray(extra) && !ops.length) ops.push(...extra);
    return ops;
}

const adjEvents = new Map();
export function compute(limit) {
    const c = ctx();
    const meta = getMeta();
    if (!meta?.base) return null;
    const chat = c.chat ?? [];
    const s = freshState(meta.base);
    s.turn = meta.baseTurn ?? 0;
    const snaps = new Map();
    const n = Math.min(limit ?? chat.length, chat.length);
    const start = resolveStart(meta, chat);
    const adj = (meta.adjust ?? []).slice().sort((a, b) => a.at - b.at || a.t - b.t);
    const seed = String(c.getCurrentChatId?.() ?? MODULE);
    let lastAI = -1;
    for (let i = n - 1; i >= start; i--) if (chat[i] && !chat[i].is_user && !chat[i].is_system) { lastAI = i; break; }
    let ai = 0;
    const runAdjust = (a) => {
        const info = { seed: `${seed}:adj:${a.t}`, labels: [], alerts: [], mods: meta.mods, meta };
        if (a.set) {
            if (a.set.mod === 'core') s.core = clone(a.set.data);
            else if (MOD_IDS.includes(a.set.mod)) s.data[a.set.mod] = clone(a.set.data);
        }
        for (const [k, v] of a.ops ?? []) applyOp(s, k, v, info);
        adjEvents.set(a.t, info.alerts);
        if (a.at > lastAI && a.label && !a.silent) s.recent.push(a.label);
    };
    for (let i = start; i < n; i++) {
        while (ai < adj.length && adj[ai].at <= i) runAdjust(adj[ai++]);
        const m = chat[i];
        if (!m || m.is_user || m.is_system) continue;
        s.turn++;
        const ops = msgOps(m);
        if (!ops.length) continue;
        const info = { seed: `${seed}:${i}`, labels: [], alerts: [], mods: meta.mods, roll: null, meta };
        for (const [k, v] of ops) applyOp(s, k, v, info);
        snaps.set(i, { labels: info.labels, alerts: info.alerts, roll: info.roll });
        if (i === lastAI && info.roll) s.pendingRoll = info.roll;
    }
    while (ai < adj.length) runAdjust(adj[ai++]);
    return { state: s, snaps, lastAI };
}

// 직접 편집·구매·추가 지시 기록
export async function addAdjust(entry) {
    const meta = getMeta(true);
    meta.adjust ??= [];
    const a = { at: ctx().chat?.length ?? 0, t: Date.now() + Math.random(), ...entry };
    meta.adjust.push(a);
    if (meta.adjust.length > 80) squash(meta);
    await saveMeta();
    app.refreshNow?.();
    for (const t of adjEvents.get(a.t) ?? []) toastr.info(esc(t), TITLE);
}
export function commit(mod, data, label, extra = {}) {
    return addAdjust({ set: { mod, data: mod === 'core' ? NORM.core(data) : normalize(mod, data) }, label, ...extra });
}
export function squash(meta) {
    const r = compute();
    if (!r) return;
    const chat = ctx().chat ?? [];
    meta.base = { core: r.state.core, data: r.state.data };
    meta.baseTurn = r.state.turn;
    meta.startAt = chat.length;
    meta.startKey = chat.at(-1)?.send_date ?? null;
    meta.adjust = [];
}

// ───── 편지 계산 ─────
export function dueLetters(s, meta = getMeta()) {
    const ct = s?.data?.contact;
    if (!ct) return [];
    const now = nowTick(s, meta);
    const out = [];
    for (const [who, th] of Object.entries(ct.threads)) for (const m of th) if (m.pending && (m.arrive ?? 0) <= now) out.push({ who, m });
    return out;
}
export function inTransit(s, meta = getMeta()) {
    const ct = s?.data?.contact;
    if (!ct || ct.mode !== 'letter') return [];
    const now = nowTick(s, meta);
    const out = [];
    for (const [who, th] of Object.entries(ct.threads)) for (const m of th) if ((m.arrive ?? -Infinity) > now) out.push({ who, m, left: m.arrive - now });
    return out;
}
export function unreadCount(s, meta = getMeta()) {
    const ct = s?.data?.contact;
    if (!ct || !modOn('contact', meta)) return 0;
    return Object.values(ct.unread ?? {}).reduce((a, b) => a + b, 0) + dueLetters(s, meta).length;
}

// ───── 프롬프트 주입 ─────
export function tagKeysFor(meta) {
    const K = [];
    const on = (id) => modOn(id, meta);
    if (on('stats')) K.push('stat (게이지이름 ±N, e.g. 체력 -12 · 체력 max +10) · attr (능력치 ±1, only after real growth) · cond (+이름 | 효과 / -이름)');
    if (on('wallet')) K.push('cash (±N) · item (+이름 2 | 설명 / -이름 1)');
    if (on('shop')) K.push('stock (상점 | 상품 | 가격 | 설명 — when the story adds goods; 상점 | -상품 removes)');
    if (on('home')) K.push('decor (+가구 | 방 — when {{user}} gets/places furniture) · room (+새 공간 | 설명)');
    if (on('map')) K.push('loc (장소 — whenever {{user}} moves) · place (이름 | 설명 | 이어진곳 — newly discovered place)');
    if (on('rel')) K.push('aff (이름 ±N — affection) · trust (이름 ±N) · rel (이름 = 관계 이름, when it truly changes) · pair (A & B = 관계)');
    if (on('calendar')) K.push('date (+1 when days pass / 3월 14일 to jump) · time (one of the time slots) · event (날짜 | 제목 | 설명 — a new appointment)');
    if (on('quest')) K.push('quest (제목 | 새/수락/완료/실패 | 설명 — a new request appears, {{user}} accepts, or it ends; 제목 | 진행 내용 = progress)');
    if (on('news')) K.push('news (헤드라인 | 내용 — only for big public events)');
    if (on('gossip')) K.push('rumor (제목 | 내용 | 관련 인물 — when people start whispering about something)');
    if (on('board')) K.push('post (작성자 | 제목 | 내용 — rarely, a public notice/post appears)');
    if (on('ach')) K.push('ach (업적 이름 — only when its condition is truly met)');
    if (on('memo')) K.push('memo (a short note worth keeping: promise, clue, goal — rarely)');
    if (on('contact')) K.push('msg (이름 | 내용 — someone sends {{user}} a message/letter from afar; occasionally, not every turn)');
    if (on('profile')) K.push('npc (이름 | 한 줄 소개 — a new named character who will matter)');
    if (on('dice')) K.push('roll (판정 이름 | 난이도 — ask {{user}} to roll instead of deciding a risky outcome yourself)');
    return K;
}

export function buildInjection(r) {
    if (!r) return { main: '', people: '' };
    const s = r.state, d = s.data, meta = getMeta(), set = settings(), lite = set.injectMode === 'lite';
    const on = (id) => modOn(id, meta) && d[id];
    const L = [];
    const PP = [];
    L.push(P('inj.header'));
    L.push(P(`diff.${diffOf(meta)}`));
    if (set.genLang === 'en') L.push(P('inj.lang'));
    if (s.core.title || s.core.summary) {
        L.push(`World: ${s.core.title}${s.core.genre ? ` (${s.core.genre})` : ''}${s.core.canon ? ` · canon: ${s.core.canon}` : ''}${s.core.tone ? ` · tone: ${s.core.tone}` : ''}`);
        if (s.core.summary && !lite) L.push(`Setting: ${short(s.core.summary, 600)}`);
        if (s.core.userRole) L.push(`{{user}}: ${s.core.userRole}`);
        if (s.core.rules) L.push(`World rules: ${short(s.core.rules, lite ? 200 : 500)}`);
    }
    if (on('calendar')) {
        const c = d.calendar;
        const ev = eventsOn(c, c.y, c.m, c.d);
        const soon = [];
        const tmp = { ...c };
        for (let k = 1; k <= 7; k++) { addDays(tmp, 1); for (const e of eventsOn(c, tmp.y, tmp.m, tmp.d)) soon.push(`${e.title}(${k}일 후)`); }
        L.push(`Date: ${dateStr(c)} · ${c.time}${ev.length ? ` · TODAY: ${ev.map(e => e.title + (e.desc ? ` — ${e.desc}` : '')).join('; ')}` : ''}${soon.length ? ` · coming: ${soon.slice(0, 4).join(', ')}` : ''}`);
    }
    if (on('map')) {
        const m = d.map, p = findBy(m.places, m.here);
        if (m.here) L.push(`Location: ${m.here}${p?.desc ? ` — ${short(p.desc, 120)}` : ''}${p?.links?.length ? ` · nearby: ${p.links.join(', ')}` : ''}`);
    }
    if (on('stats')) {
        const st = d.stats;
        if (st.bars.length) L.push(`{{user}} gauges: ${st.bars.map(b => `${b.name} ${fmtNum(b.cur)}/${fmtNum(b.max)}`).join(' · ')}`);
        if (st.attrs.length) L.push(`{{user}} attributes: ${st.attrs.map(a => `${a.name} ${a.val >= 0 ? '+' : ''}${a.val}`).join(' · ')}`);
        if (st.conds.length) L.push(`Conditions: ${st.conds.map(c => c.name + (c.desc && !lite ? ` (${short(c.desc, 50)})` : '')).join(', ')}`);
    }
    if (on('wallet')) {
        const w = d.wallet;
        L.push(`Money: ${fmtNum(w.cash)} ${w.currency}${w.items.length ? ` · Items: ${w.items.slice(0, 20).map(i => `${i.name}${i.qty > 1 ? `×${i.qty}` : ''}`).join(', ')}` : ''}`);
    }
    if (on('home') && !lite) {
        const hm = d.home;
        if (hm.name) L.push(`Home: ${hm.name} — ${hm.rooms.map(r => `${r.name}${r.decor.length ? `[${r.decor.slice(0, 6).join(', ')}]` : ''}`).join(' / ')}`);
    }
    if (on('shop') && !lite) {
        const m = d.map;
        const here = d.shop.shops.filter(sh => !sh.place || !m || norm(sh.place) === norm(m.here) || norm(m.here).includes(norm(sh.place)));
        if (here.length) L.push(`Shops here: ${here.map(sh => `${sh.name}(${sh.items.slice(0, 6).map(i => `${i.name} ${fmtNum(i.price)}`).join(', ')})`).join(' · ')}`);
    }
    if (on('quest')) {
        const act = d.quest.list.filter(q => q.status === 'active');
        const open = d.quest.list.filter(q => q.status === 'open');
        if (act.length) L.push(`Active quests: ${act.slice(0, 5).map(q => `${q.title}${q.giver ? ` (from ${q.giver})` : ''}${q.deadline ? ` · due ${q.deadline}` : ''}${!lite && q.steps.length ? ` · next: ${q.steps.find(x => !x.done)?.text ?? 'report back'}` : ''}`).join(' / ')}`);
        if (open.length && !lite) L.push(`Requests available (not accepted yet): ${open.slice(0, 4).map(q => q.title).join(', ')}`);
    }
    if (on('news') && d.news.items.length && !lite) L.push(`Recent news (${d.news.name || 'news'}): ${d.news.items.slice(-3).map(x => x.title).join(' / ')}`);
    if (on('gossip') && d.gossip.issues.length && !lite) L.push(`Rumors going around: ${d.gossip.issues.slice(-2).map(x => `${x.title}${x.about.length ? ` (about ${x.about.join(', ')})` : ''}`).join(' / ')}`);
    if (on('rel')) {
        const rl = d.rel;
        for (const x of rl.user.slice(0, 12)) PP.push(`${x.name}${x.label ? ` [${x.label}]` : ''} → {{user}}: 호감 ${x.aff} · 신뢰 ${x.trust}${x.memo && !lite ? ` — ${short(x.memo, 90)}` : ''}`);
        if (rl.pairs.length && !lite) PP.push(`Between others: ${rl.pairs.slice(0, 10).map(p => `${p.a}↔${p.b} ${p.label}`).join(' · ')}`);
    }
    if (on('profile')) {
        const pf = d.profile;
        const list = pf.mode === 'detailed' ? pf.list : pf.list.filter(p => p.role === 'npc');
        for (const p of list.slice(0, pf.mode === 'detailed' ? 12 : 8)) {
            const f = pf.mode === 'detailed' && !lite ? ` | ${p.fields.slice(0, 10).map(x => `${x.k}: ${short(x.v, 80)}`).join(' / ')}` : '';
            PP.push(`Profile ${p.name}${p.role === 'user' ? ' ({{user}})' : ''}: ${short(p.summary, 160)}${f}`);
        }
    }
    if (on('ach')) {
        const a = d.ach.list, done = a.filter(x => x.done);
        if (a.length) L.push(`Achievements ${done.length}/${a.length}${done.length ? ` · recent: ${done.slice(-3).map(x => x.name).join(', ')}` : ''}`);
    }
    if (on('memo')) {
        const ms = d.memo.list.filter(m => m.inject);
        const pick = [...ms.filter(m => m.pin), ...ms.filter(m => !m.pin).slice(-6)];
        if (pick.length) L.push(`Notes: ${pick.map(m => `${m.by === 'user' ? '(user) ' : ''}${short(m.text, 120)}`).join(' / ')}`);
    }
    if (on('contact')) {
        const ct = d.contact;
        if (ct.mode === 'letter') L.push(P('inj.letter', { app: ct.app }));
        const tr = inTransit(s, meta).filter(x => x.m.from === 'me');
        if (tr.length) L.push(`Letters on the way (NOT yet received — the recipients don't know their contents yet): ${tr.map(x => `to ${x.who} (${x.left}${tickUnit(s, meta)} left)`).join(', ')}`);
        if (set.contactInject) {
            const now = nowTick(s, meta);
            const recent = Object.entries(ct.threads).map(([who, th]) => [who, th.filter(m => !m.pending && (m.arrive ?? -Infinity) <= now)]).filter(([, v]) => v.length).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
            for (const [who, th] of recent) PP.push(`${ct.app} with ${who} (latest): ${th.slice(-3).map(m => `${m.from === 'me' ? '{{user}}' : who}: ${short(m.text, 70)}`).join(' / ')}`);
        }
    }
    if (on('dice')) {
        const dc = d.dice;
        if (dc.rules && !lite) L.push(`Dice rules: ${short(dc.rules, 300)}`);
        L.push(P('inj.dice'));
    }
    if (s.recent.length) L.push(`Since the last reply {{user}} did (via the status UI): ${s.recent.slice(-8).join(' / ')}`);
    if (set.sync === 'tag' || set.sync === 'tagPlus') {
        L.push(P('inj.output'));
        L.push(lite ? `Keys (key: value, ±N for numbers, +/-name for lists, name | detail): ${tagKeysFor(meta).map(k => k.match(/(^|· )([a-z]+) \(/g)?.map(x => x.replace(/[·( ]/g, '')).join(' ')).join(' ')}` : `Keys: ${tagKeysFor(meta).join(' · ')}`);
        if (!lite) L.push(P('inj.example'));
    }
    return { main: L.filter(Boolean).join('\n'), people: PP.length ? `[STATUS SIM — PEOPLE (part of the state above)]\n${PP.join('\n')}` : '' };
}

export function setInjection(inj) {
    const c = ctx();
    const depth = clamp(parseInt(settings().injectDepth, 10) || 0, 0, 20);
    c.setExtensionPrompt(INJECT_KEY, inj?.main ?? '', PROMPT_IN_CHAT, depth, true, ROLE_SYSTEM);
    c.setExtensionPrompt(INJECT_KEY2, inj?.people ?? '', PROMPT_IN_CHAT, depth, false, ROLE_SYSTEM);
}

// ───── 생성 재료 ─────
export function chatCharacters() {
    const c = ctx();
    if (c.groupId) {
        const g = c.groups?.find(x => x.id == c.groupId);
        return (g?.members ?? []).map(av => c.characters?.find(ch => ch.avatar === av)).filter(Boolean);
    }
    const ch = c.characters?.[c.characterId];
    return ch ? [ch] : [];
}
export async function loreNames() {
    const c = ctx();
    const names = new Set();
    for (const ch of chatCharacters()) { const w = ch?.data?.extensions?.world; if (w) names.add(w); }
    const cw = c.chatMetadata?.world_info; if (cw) names.add(cw);
    try {
        const wi = await import('/scripts/world-info.js');
        for (const n of wi.selected_world_info ?? []) names.add(n);
        for (const ch of chatCharacters()) {
            const fname = String(ch.avatar ?? '').replace(/\.[^.]+$/, '');
            for (const n of (wi.world_info?.charLore ?? []).find(x => x.name === fname)?.extraBooks ?? []) names.add(n);
        }
    } catch { /* optional */ }
    return [...names];
}
export async function loreText(limit) {
    const c = ctx();
    if (!c.loadWorldInfo || limit <= 0) return '';
    let out = '';
    for (const name of await loreNames()) {
        try {
            const book = await c.loadWorldInfo(name);
            const entries = Object.values(book?.entries ?? {}).filter(e => !e.disable).sort((a, b) => (b.constant ? 1 : 0) - (a.constant ? 1 : 0) || (a.order ?? 0) - (b.order ?? 0));
            for (const e of entries) {
                const head = e.comment || (Array.isArray(e.key) ? e.key.slice(0, 3).join(', ') : '');
                const piece = `• ${head}: ${String(e.content ?? '').replace(/\s+/g, ' ').trim()}\n`;
                if (out.length + piece.length > limit) return out + '…(생략)';
                out += piece;
            }
        } catch (e) { console.warn(LOG, 'lore', name, e); }
    }
    return out;
}
export function recentChat(n) {
    return (ctx().chat ?? []).filter(m => !m.is_system).slice(-n).map(m => `${m.name}: ${short(stripStatus(m.mes), 700)}`).join('\n');
}
export async function gatherSources(opt = {}) {
    const c = ctx(), set = settings();
    const parts = [];
    const persona = c.powerUserSettings?.persona_description ?? '';
    parts.push(`[USER] {{user}} = ${c.name1}${opt.persona !== false && persona ? `\n${short(persona, 2500)}` : ''}`);
    if (opt.card !== false) {
        for (const ch of chatCharacters()) {
            const f = [ch.description, ch.personality && `Personality: ${ch.personality}`, ch.scenario && `Scenario: ${ch.scenario}`].filter(Boolean).join('\n');
            if (f) parts.push(`[CHARACTER CARD: ${ch.name}]\n${short(f, 5000)}`);
        }
    }
    if (opt.lore !== false) { const lt = await loreText(set.loreChars); if (lt) parts.push(`[LOREBOOK]\n${lt}`); }
    if (opt.chat !== false) { const rc = recentChat(set.recentForGen); if (rc) parts.push(`[RECENT CHAT]\n${rc}`); }
    return parts.join('\n\n');
}
export { CONTACT_MODES };
