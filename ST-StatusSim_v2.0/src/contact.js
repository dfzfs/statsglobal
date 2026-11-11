// 📱/✉️ 연락: 메신저 · 즉시 통신 · 편지 (배달 수단 · 도착 시간 · 급행)
import { app, settings, getMeta, modOn, esc, short, clone, findBy, norm, uid, randInt, rand, clamp, num, fmtNum, nowTick, tickUnit, stamp, CONTACT_MODES, TITLE, COURIER_PRESETS } from './core.js';
import { commit, addAdjust, dueLetters, inTransit } from './engine.js';
import { phoneReply, letterReply, pingMessage } from './ai.js';
import { avatar, ai1, emptyBox, askInput, askConfirm, busyBtn } from './kit.js';

const isLetter = (d) => d.mode === 'letter';
const names = (d) => [...new Set([...d.contacts.map(c => c.name), ...Object.keys(d.threads)])];
const courierOf = (d, who) => findBy(d.couriers, findBy(d.contacts, who)?.courier) ?? d.couriers[0] ?? COURIER_PRESETS[0];
const visible = (m, now) => !m.pending && !(m.from === 'them' && (m.arrive ?? -Infinity) > now);

function lastLine(d, who, now) {
    const th = (d.threads[who] ?? []).filter(m => visible(m, now));
    return th.at(-1);
}

// ───── 목록 ─────
function listView(s, d, ui) {
    const now = nowTick(s), unit = tickUnit(s);
    const due = dueLetters(s);
    const transit = inTransit(s);
    const ns = names(d);
    const modeInfo = CONTACT_MODES[d.mode];
    return `<div class="ss-ct">
        <div class="ss-ct-top"><div class="ss-ct-app"><i class="fa-solid ${modeInfo.icon}"></i><b>${esc(d.app)}</b><small>${esc(modeInfo.name)}</small></div>
            <button class="ss-btn sm ghost" data-act="cmode" title="연락 방식 바꾸기"><i class="fa-solid fa-right-left"></i> 방식</button></div>
        ${due.length ? `<div class="ss-callout mail"><i class="fa-solid fa-envelope-open-text"></i><div><b>도착한 편지 ${due.length}통</b><span>${due.map(x => esc(x.who)).join(', ')}${due.some(x => x.m.rush) ? ' · 💨 급행 포함' : ''}</span></div><button class="ss-btn sm pri" data-act="copen" data-arg="${esc(due[0].who)}">열기</button></div>` : ''}
        ${transit.length ? `<div class="ss-card ss-transit"><div class="ss-sec-h"><h4><i class="fa-solid fa-truck-fast"></i> 배달 중</h4></div>${transit.map(x => {
            const total = Math.max(1, (x.m.arrive ?? 0) - (x.m.at ?? 0));
            const pct = clamp(100 - (x.left / total) * 100, 4, 100);
            return `<div class="ss-tr"><span>${x.m.from === 'me' ? `→ ${esc(x.who)}` : `${esc(x.who)} →`}</span><div class="ss-tr-t" style="--x:${pct}%"><i style="width:${pct}%"></i><em>${esc(courierIcon(d, x.m.courier))}</em></div><small>${x.left}${unit} 뒤</small></div>`;
        }).join('')}</div>` : ''}
        <div class="ss-ct-list">${ns.map(n => {
            const c = findBy(d.contacts, n) ?? { name: n };
            const last = lastLine(d, n, now);
            const un = (d.unread[n] ?? 0) + due.filter(x => x.who === n).length;
            return `<div class="ss-ct-row" data-act="copen" data-arg="${esc(n)}">${avatar(n)}
                <div class="ss-ct-b"><b>${esc(n)}</b><small>${esc(last ? short(last.text, 46) : c.status || c.handle || '대화 없음')}</small></div>
                ${un ? `<i class="ss-badge">${un}</i>` : ''}
                <button class="ss-ib" data-act="cmenu" data-arg="${esc(n)}" title="더 보기"><i class="fa-solid fa-ellipsis"></i></button></div>`;
        }).join('') || emptyBox('연락처가 없어요', 'fa-address-book')}</div>
        <div class="ss-inline"><input class="ss-in ss-cnew" placeholder="새 연락처 이름"><button class="ss-btn" data-act="cadd"><i class="fa-solid fa-user-plus"></i> 추가</button></div>
        <div class="ss-row-btns"><button class="ss-btn ghost" data-act="cping" data-arg="">${ai1} 누군가에게서 ${isLetter(d) ? '편지 오게' : '먼저 연락 오게'}</button>${isLetter(d) ? `<button class="ss-btn ghost" data-act="ccour"><i class="fa-solid fa-dove"></i> 배달 수단</button>` : ''}</div>
        <p class="ss-hint">${isLetter(d) ? `편지는 ${unit === '일' ? '날짜가 지나야' : 'AI 응답이 쌓여야'} 도착해요 (지금 ${unit === '일' && s.data.calendar ? esc(stamp(s)) : `${now}턴`}). 답장은 도착한 뒤 「열기」를 눌러야 AI가 씁니다.` : '메시지를 보내면 그 인물이 AI로 답장해요 (1번 = AI 1회). 「답장 받기」를 끄면 토큰이 들지 않아요.'}</p>
    </div>`;
}
const courierIcon = (d, name) => findBy(d.couriers, name)?.icon ?? '✉️';

// ───── 메신저 대화 ─────
function phoneView(s, d, ui) {
    const who = ui.who, th = d.threads[who] ?? [];
    const c = findBy(d.contacts, who) ?? { name: who };
    return `<div class="ss-phone">
        <div class="ss-phone-top"><button class="ss-ib" data-act="cback"><i class="fa-solid fa-chevron-left"></i></button>${avatar(who)}<div class="ss-ct-b"><b>${esc(who)}</b><small>${esc(c.status || d.app)}</small></div>
            <button class="ss-ib" data-act="cmenu" data-arg="${esc(who)}"><i class="fa-solid fa-ellipsis-vertical"></i></button></div>
        <div class="ss-thread">${th.map(m => bubble(m, ui)).join('') || '<div class="ss-hint center">아직 대화가 없어요. 먼저 말을 걸어 보세요.</div>'}</div>
        <div class="ss-phone-in"><textarea class="ss-in ss-cin" rows="1" placeholder="메시지 보내기">${esc(ui.draft ?? '')}</textarea><button class="ss-btn pri ss-send" data-act="csend" title="보내기"><i class="fa-solid fa-paper-plane"></i></button></div>
        <div class="ss-phone-opt"><label class="ss-tog"><input type="checkbox" class="ss-switch ss-creply" ${ui.noReply ? '' : 'checked'}><span>답장 받기 ${ai1}</span></label>
            <button class="ss-btn sm ghost" data-act="creply">${ai1} 지금 답장 받기</button><button class="ss-btn sm ghost" data-act="cping" data-arg="${esc(who)}">${ai1} 선톡 오게</button></div>
    </div>`;
}
function bubble(m, ui) {
    if (ui.editId === m.id) return `<div class="ss-bub ${m.from === 'me' ? 'me' : ''} editing"><textarea class="ss-in ss-bub-ed" rows="2">${esc(m.text)}</textarea><div class="ss-bub-acts"><button class="ss-btn sm pri" data-act="cmsgsave" data-arg="${esc(m.id)}">저장</button><button class="ss-btn sm" data-act="cmsgcancel">취소</button></div></div>`;
    return `<div class="ss-bub ${m.from === 'me' ? 'me' : ''} ${m.ping ? 'ping' : ''}" data-id="${esc(m.id)}"><span>${esc(m.text)}</span>
        <div class="ss-bub-meta">${m.edited ? '수정됨 · ' : ''}${esc(m.date || '')}</div>
        <div class="ss-bub-acts"><button class="ss-ib" data-act="cmsgedit" data-arg="${esc(m.id)}" title="수정"><i class="fa-solid fa-pen"></i></button><button class="ss-ib" data-act="cmsgdel" data-arg="${esc(m.id)}" title="삭제"><i class="fa-solid fa-trash-can"></i></button>${m.from === 'them' ? `<button class="ss-ib" data-act="cmsgre" data-arg="${esc(m.id)}" title="다시 받기 (AI 1회)"><i class="fa-solid fa-rotate"></i></button>` : ''}</div></div>`;
}

// ───── 편지 ─────
function letterView(s, d, ui) {
    const who = ui.who, th = d.threads[who] ?? [];
    const now = nowTick(s), unit = tickUnit(s);
    const mine = courierOf(d, who);
    ui.courier ??= d.couriers[0]?.name ?? '';
    const cur = s.data.wallet?.currency ?? '';
    const cash = s.data.wallet?.cash;
    return `<div class="ss-letters">
        <div class="ss-phone-top"><button class="ss-ib" data-act="cback"><i class="fa-solid fa-chevron-left"></i></button>${avatar(who)}<div class="ss-ct-b"><b>${esc(who)}</b><small>${esc(findBy(d.contacts, who)?.status || `주로 ${mine.icon} ${mine.name}`)}</small></div>
            <button class="ss-ib" data-act="cmenu" data-arg="${esc(who)}"><i class="fa-solid fa-ellipsis-vertical"></i></button></div>
        <div class="ss-letter-list">${th.map(m => letterCard(m, d, ui, now, unit)).join('') || '<div class="ss-hint center">주고받은 편지가 없어요.</div>'}</div>
        <div class="ss-compose">
            <div class="ss-paper"><textarea class="ss-in ss-cin" rows="5" placeholder="${esc(who)}에게…">${esc(ui.draft ?? '')}</textarea><div class="ss-paper-sign">— ${esc(app.userName?.() ?? '')}</div></div>
            <div class="ss-f wide"><span>보내는 방법</span><div class="ss-couriers">${d.couriers.map(c => `<button class="ss-cour ${ui.courier === c.name && !ui.express ? 'on' : ''}" data-act="cpick" data-arg="${esc(c.name)}"><em>${esc(c.icon)}</em><b>${esc(c.name)}</b><small>${c.min === c.max ? c.min : `${c.min}~${c.max}`}${unit}${c.fee ? ` · ${fmtNum(c.fee)}${esc(cur)}` : ''}</small></button>`).join('')}
                <button class="ss-cour express ${ui.express ? 'on' : ''}" data-act="cpick" data-arg="__express"><em>💨</em><b>${esc(d.express.name)}</b><small>오늘 도착 · ${fmtNum(d.express.fee)}${esc(cur)}</small></button></div></div>
            <div class="ss-compose-opt">
                <label class="ss-tog"><input type="checkbox" class="ss-switch ss-lreply" ${ui.noReply ? '' : 'checked'}><span>답장 오게 하기</span></label>
                <label class="ss-tog"><input type="checkbox" class="ss-switch ss-lrush" ${ui.rushPaid ? 'checked' : ''}><span>답장 급행료 동봉 (+${fmtNum(d.express.fee)}${esc(cur)})</span></label>
            </div>
            <div class="ss-row-btns"><button class="ss-btn pri" data-act="csend"><i class="fa-solid fa-envelope"></i> 부치기</button>${cash !== undefined ? `<small class="ss-dim">소지금 ${fmtNum(cash)}${esc(cur)}</small>` : ''}
                <button class="ss-btn ghost" data-act="cping" data-arg="${esc(who)}">${ai1} 이 사람에게서 편지 오게</button></div>
        </div>
    </div>`;
}
function letterCard(m, d, ui, now, unit) {
    const ic = m.rush || m.express ? '💨' : courierIcon(d, m.courier);
    if (m.pending) {
        if ((m.arrive ?? 0) <= now) return `<div class="ss-env due ${m.rush ? 'rush' : ''}">${m.rush ? '<div class="ss-ribbon">💨 웃돈 주고 급행!</div>' : ''}<div class="ss-env-flap"></div><div class="ss-env-b"><b>📬 답장이 도착했어요</b><small>${esc(ic)} ${esc(m.courier || '편지')}</small><button class="ss-btn pri sm" data-act="lopen" data-arg="${esc(m.id)}">${ai1} 뜯어 보기</button></div></div>`;
        return `<div class="ss-env wait"><div class="ss-env-flap"></div><div class="ss-env-b"><b>답장을 기다리는 중</b><small>${esc(ic)} 약 ${(m.arrive ?? 0) - now}${unit} 뒤 도착 예정</small></div></div>`;
    }
    if (m.from === 'them' && (m.arrive ?? -Infinity) > now) return '';
    const left = (m.arrive ?? -Infinity) - now;
    if (ui.editId === m.id) return `<div class="ss-letter ${m.from}"><textarea class="ss-in ss-bub-ed" rows="5">${esc(m.text)}</textarea><div class="ss-bub-acts on"><button class="ss-btn sm pri" data-act="cmsgsave" data-arg="${esc(m.id)}">저장</button><button class="ss-btn sm" data-act="cmsgcancel">취소</button></div></div>`;
    return `<div class="ss-letter ${m.from === 'me' ? 'me' : 'them'}">${m.rush ? '<div class="ss-ribbon">💨 웃돈 주고 급행!</div>' : m.express ? '<div class="ss-ribbon">💨 급행</div>' : ''}
        <div class="ss-letter-meta"><span>${m.from === 'me' ? '보낸 편지' : '받은 편지'}</span><span>${esc(ic)} ${esc(m.courier || '')}${m.fee ? ` · ${fmtNum(m.fee)}` : ''}</span><span>${m.from === 'me' && left > 0 ? `<b class="ss-hl">배달 중 · ${left}${unit} 남음</b>` : esc(m.date)}</span></div>
        <div class="ss-letter-body">${esc(m.text)}</div>
        <div class="ss-bub-acts"><button class="ss-ib" data-act="cmsgedit" data-arg="${esc(m.id)}" title="수정"><i class="fa-solid fa-pen"></i></button><button class="ss-ib" data-act="cmsgdel" data-arg="${esc(m.id)}" title="삭제"><i class="fa-solid fa-trash-can"></i></button></div></div>`;
}

export function contactView(s, d, ui) {
    if (!ui.who) return listView(s, d, ui);
    return isLetter(d) ? letterView(s, d, ui) : phoneView(s, d, ui);
}

// ───── 동작 ─────
const curState = () => app.current?.state;
function findMsg(nd, id) {
    for (const [who, th] of Object.entries(nd.threads)) { const k = th.findIndex(m => m.id === id); if (k >= 0) return { who, th, k, m: th[k] }; }
    return null;
}
async function markRead(who) { if (curState()?.data.contact?.unread?.[who]) await addAdjust({ ops: [['_read', who]], silent: true }); }

async function sendPhone(el, s, who, text) {
    const ui = el._ss.ui;
    const nd = clone(s.data.contact);
    (nd.threads[who] ??= []).push({ id: uid(), from: 'me', text, date: stamp(s), at: nowTick(s), arrive: nowTick(s) });
    if (!findBy(nd.contacts, who)) nd.contacts.push({ name: who, handle: '', status: '', courier: '' });
    await commit('contact', nd, `${nd.app}로 ${who}에게: ${short(text, 30)}`);
    if (!ui.noReply) await getPhoneReply(el, who);
}
async function getPhoneReply(el, who, replaceId = null) {
    const thread = el.querySelector('.ss-thread');
    thread?.insertAdjacentHTML('beforeend', '<div class="ss-bub typing"><span><i></i><i></i><i></i></span></div>');
    if (thread) thread.scrollTop = thread.scrollHeight;
    try {
        const s = curState();
        const lines = await phoneReply(who, s);
        const nd = clone(curState().data.contact);
        if (lines.length === 1 && /읽지 않음/.test(lines[0])) { toastr.info(`${esc(who)}이(가) 아직 읽지 않았어요.`, TITLE); app.renderPanel(el); return; }
        const th = nd.threads[who] ??= [];
        const msgs = lines.map(l => ({ id: uid(), from: 'them', text: l, date: stamp(s), at: nowTick(s), arrive: nowTick(s) }));
        if (replaceId) { const k = th.findIndex(m => m.id === replaceId); if (k >= 0) th.splice(k, 1, ...msgs); else th.push(...msgs); } else th.push(...msgs);
        await commit('contact', nd, `${who}의 답장: ${short(lines.join(' '), 40)}`);
    } catch (e) { console.error(e); toastr.error(`답장을 받지 못했어요: ${esc(e.message)}`, TITLE); app.renderPanel(el); }
}
async function sendLetter(el, s, who, text) {
    const ui = el._ss.ui;
    const nd = clone(s.data.contact);
    const now = nowTick(s);
    const express = !!ui.express;
    const c = express ? { name: nd.express.name, icon: '💨', min: 0, max: 0, fee: nd.express.fee } : (findBy(nd.couriers, ui.courier) ?? nd.couriers[0]);
    const wantReply = !ui.noReply;
    const rushPaid = wantReply && !!ui.rushPaid;
    const fee = (c.fee || 0) + (rushPaid ? nd.express.fee : 0);
    const w = s.data.wallet;
    if (fee && w && modOn('wallet') && w.cash < fee) { toastr.warning(`돈이 모자라요 (${fmtNum(fee)} ${esc(w.currency)} 필요).`, TITLE); return; }
    const arrive = now + (express ? 0 : randInt(c.min, c.max));
    (nd.threads[who] ??= []).push({ id: uid(), from: 'me', text, date: stamp(s), at: now, arrive, courier: c.name, express, fee, rush: false });
    if (!findBy(nd.contacts, who)) nd.contacts.push({ name: who, handle: '', status: '', courier: '' });
    let rushNote = '';
    if (wantReply) {
        const rel = s.data.rel ? findBy(s.data.rel.user, who) : null;
        const chance = clamp(num(settings().rushChance, 15) + Math.max(0, rel?.aff ?? 0) / 3, 0, 70);
        const rush = rushPaid || rand(100) <= chance;
        const theirs = courierOf(nd, who);
        const due = arrive + randInt(0, 1) + (rush ? 0 : randInt(theirs.min, theirs.max));
        nd.threads[who].push({ id: uid(), from: 'them', text: '', pending: true, at: arrive, arrive: due, courier: rush ? nd.express.name : theirs.name, rush, express: rush });
        if (rush && !rushPaid) rushNote = 'rush';
    }
    ui.draft = ''; ui.express = false; ui.rushPaid = false;
    await commit('contact', nd, `${c.icon} ${c.name}(으)로 ${who}에게 편지를 부쳤다${express ? ' — 오늘 도착' : ` — ${arrive - now}${tickUnit(s)} 뒤 도착`}`);
    if (fee && w && modOn('wallet')) await addAdjust({ ops: [['cash', `-${fee}`]], label: `편지 요금 −${fmtNum(fee)} ${w.currency}` });
    toastr.success(`${esc(c.icon)} 편지를 부쳤어요${express ? ' (오늘 도착)' : ` (${arrive - now}${tickUnit(s)} 뒤 도착)`}`, TITLE);
    if (rushNote) setTimeout(() => toastr.info('…어쩐지 답장이 빨리 올 것 같은 예감이 들어요.', TITLE), 600);
}

export const CONTACT_ACTIONS = {
    copen: (el, arg) => { el._ss.tab = 'contact'; el._ss.ui = { who: arg }; app.renderPanel(el); markRead(arg); },
    talk: (el, arg) => CONTACT_ACTIONS.copen(el, arg),
    cback: (el) => { el._ss.ui = {}; app.renderPanel(el); },
    cadd: async (el, arg, btn, s) => {
        const n = el.querySelector('.ss-cnew').value.trim(); if (!n) return;
        const nd = clone(s.data.contact); if (!findBy(nd.contacts, n)) nd.contacts.push({ name: n, handle: '', status: '', courier: '' });
        await commit('contact', nd, '');
    },
    csend: async (el, arg, btn, s) => {
        const ui = el._ss.ui, who = ui.who;
        const text = el.querySelector('.ss-cin')?.value.trim(); if (!text) return;
        ui.noReply = !(el.querySelector('.ss-creply, .ss-lreply')?.checked ?? true);
        ui.rushPaid = !!el.querySelector('.ss-lrush')?.checked;
        ui.draft = '';
        busyBtn(btn, true, '');
        try { if (isLetter(s.data.contact)) await sendLetter(el, s, who, text); else await sendPhone(el, s, who, text); }
        finally { busyBtn(btn, false); }
    },
    creply: (el) => getPhoneReply(el, el._ss.ui.who),
    cpick: (el, arg) => { const ui = el._ss.ui; ui.draft = el.querySelector('.ss-cin')?.value ?? ui.draft; if (arg === '__express') ui.express = !ui.express; else { ui.courier = arg; ui.express = false; } app.renderPanel(el); },
    lopen: async (el, arg, btn, s) => {
        const nd0 = s.data.contact; const f = findMsg(nd0, arg); if (!f) return;
        busyBtn(btn, true, '뜯는 중…');
        try {
            const text = await letterReply(f.who, s, { courier: f.m.courier, rush: f.m.rush });
            const nd = clone(curState().data.contact); const g = findMsg(nd, arg); if (!g) return;
            Object.assign(g.m, { text, pending: false, date: stamp(curState()), edited: false });
            await commit('contact', nd, `${f.who}의 편지를 읽었다${f.m.rush ? ' (웃돈 주고 급행으로 온 편지)' : ''}: ${short(text, 40)}`);
        } catch (e) { console.error(e); toastr.error(`편지를 열지 못했어요: ${esc(e.message)}`, TITLE); busyBtn(btn, false); }
    },
    cping: async (el, arg, btn, s) => {
        const d = s.data.contact;
        let who = arg;
        if (!who) {
            const pool = names(d);
            if (!pool.length) { toastr.info('연락처가 없어요.', TITLE); return; }
            const rel = s.data.rel?.user ?? [];
            pool.sort((a, b) => (findBy(rel, b)?.aff ?? 0) - (findBy(rel, a)?.aff ?? 0));
            who = pool[rand(Math.min(3, pool.length)) - 1];
        }
        busyBtn(btn, true, '기다리는 중…');
        try { await receivePing(who, false); el._ss.ui = { who }; el._ss.tab = 'contact'; app.renderPanel(el); }
        catch (e) { console.error(e); toastr.error(`실패: ${esc(e.message)}`, TITLE); busyBtn(btn, false); }
    },
    cmsgedit: (el, arg) => { el._ss.ui.editId = arg; el._ss.mode = 'typing'; app.renderPanel(el); el.querySelector('.ss-bub-ed')?.focus(); },
    cmsgcancel: (el) => { el._ss.ui.editId = null; el._ss.mode = 'view'; app.renderPanel(el); },
    cmsgsave: async (el, arg, btn, s) => {
        const text = el.querySelector('.ss-bub-ed')?.value.trim() ?? '';
        const nd = clone(s.data.contact); const f = findMsg(nd, arg); if (!f) return;
        el._ss.ui.editId = null; el._ss.mode = 'view';
        if (!text) f.th.splice(f.k, 1); else Object.assign(f.m, { text, edited: true });
        await commit('contact', nd, '');
    },
    cmsgdel: async (el, arg, btn, s) => {
        const nd = clone(s.data.contact); const f = findMsg(nd, arg); if (!f) return;
        f.th.splice(f.k, 1);
        await commit('contact', nd, '');
    },
    cmsgre: async (el, arg, btn, s) => {
        const f = findMsg(s.data.contact, arg); if (!f) return;
        // 이 말풍선과 그 뒤에 이어진 상대 말풍선들을 지우고 다시 받는다
        const nd = clone(s.data.contact); const g = findMsg(nd, arg);
        let end = g.k; while (end + 1 < g.th.length && g.th[end + 1].from === 'them') end++;
        g.th.splice(g.k + 1, end - g.k);
        await commit('contact', nd, '');
        await getPhoneReply(el, f.who, arg);
    },
    cmenu: async (el, arg, btn, s) => {
        const who = arg;
        const box = document.createElement('div');
        box.className = 'ss-root ss-scope ss-menu';
        box.innerHTML = `<h3>${avatar(who)} ${esc(who)}</h3>
            <button class="ss-btn wide" data-m="rename"><i class="fa-solid fa-signature"></i> 이름 바꾸기</button>
            <button class="ss-btn wide" data-m="status"><i class="fa-solid fa-comment-dots"></i> 상태 메시지 · 사는 곳</button>
            ${isLetter(s.data.contact) ? '<button class="ss-btn wide" data-m="courier"><i class="fa-solid fa-dove"></i> 이 사람이 쓰는 배달 수단</button>' : ''}
            <button class="ss-btn wide" data-m="ping">${ai1} ${isLetter(s.data.contact) ? '편지 오게' : '선톡 오게'}</button>
            <button class="ss-btn wide" data-m="clear"><i class="fa-solid fa-broom"></i> 대화 비우기</button>
            <button class="ss-btn wide danger" data-m="remove"><i class="fa-solid fa-user-xmark"></i> 연락처 삭제</button>`;
        let pick = null;
        box.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) { pick = b.dataset.m; box.closest('dialog')?.querySelector('.popup-button-ok')?.click(); } });
        await app.popup(box);
        if (!pick) return;
        const nd = clone(curState().data.contact);
        const c = findBy(nd.contacts, who) ?? (nd.contacts.push({ name: who, handle: '', status: '', courier: '' }), nd.contacts.at(-1));
        if (pick === 'rename') {
            const v = (await askInput(TITLE, '새 이름', who))?.trim(); if (!v || v === who) return;
            c.name = v; if (nd.threads[who]) { nd.threads[v] = nd.threads[who]; delete nd.threads[who]; } if (nd.unread[who]) { nd.unread[v] = nd.unread[who]; delete nd.unread[who]; }
            if (el._ss.ui.who === who) el._ss.ui.who = v;
        }
        if (pick === 'status') { const v = await askInput(TITLE, '상태 메시지 · 사는 곳', c.status); if (v === null) return; c.status = v; }
        if (pick === 'courier') {
            const v = await askInput(TITLE, `배달 수단 이름 (${nd.couriers.map(x => x.name).join(', ')})`, c.courier || nd.couriers[0]?.name); if (v === null) return; c.courier = v.trim();
        }
        if (pick === 'ping') return CONTACT_ACTIONS.cping(el, who, null, curState());
        if (pick === 'clear') { if (!(await askConfirm(`${esc(who)}와의 대화를 모두 지울까요?`))) return; nd.threads[who] = []; delete nd.unread[who]; }
        if (pick === 'remove') {
            if (!(await askConfirm(`${esc(who)}를 연락처에서 지울까요? (대화도 지워져요)`))) return;
            nd.contacts = nd.contacts.filter(x => norm(x.name) !== norm(who)); delete nd.threads[who]; delete nd.unread[who];
            if (el._ss.ui.who === who) el._ss.ui = {};
        }
        await commit('contact', nd, '');
    },
    cmode: async (el, arg, btn, s) => {
        const box = document.createElement('div');
        box.className = 'ss-root ss-scope ss-menu';
        box.innerHTML = `<h3>연락 방식</h3>${['phone', 'instant', 'letter'].map(k => `<button class="ss-btn wide ${s.data.contact.mode === k ? 'pri' : ''}" data-m="${k}"><i class="fa-solid ${CONTACT_MODES[k].icon}"></i> ${CONTACT_MODES[k].name}</button>`).join('')}<p class="ss-hint">이름은 「${esc(s.data.contact.app)}」 그대로예요. 바꾸려면 ✏️ 편집에서 고치세요.</p>`;
        let pick = null;
        box.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) { pick = b.dataset.m; box.closest('dialog')?.querySelector('.popup-button-ok')?.click(); } });
        await app.popup(box);
        if (!pick || pick === s.data.contact.mode) return;
        const nd = clone(s.data.contact); nd.mode = pick;
        if (pick === 'letter' && !nd.couriers.length) nd.couriers = clone(COURIER_PRESETS.slice(0, 3));
        await commit('contact', nd, `연락 방식 → ${CONTACT_MODES[pick].name}`);
    },
    ccour: async (el, arg, btn, s) => {
        const nd = clone(s.data.contact);
        const box = document.createElement('div');
        box.className = 'ss-root ss-scope ss-menu';
        const have = new Set(nd.couriers.map(c => c.name));
        box.innerHTML = `<h3><i class="fa-solid fa-dove"></i> 배달 수단</h3><p class="ss-hint">누르면 넣고 빼요. 일수·요금은 ✏️ 편집에서 바꿀 수 있어요.</p>
            <div class="ss-couriers">${[...COURIER_PRESETS, ...nd.couriers.filter(c => !COURIER_PRESETS.some(p => p.name === c.name))].map(c => `<button class="ss-cour ${have.has(c.name) ? 'on' : ''}" data-c="${esc(c.name)}"><em>${esc(c.icon)}</em><b>${esc(c.name)}</b><small>${c.min}~${c.max}일 · ${esc(c.note)}</small></button>`).join('')}</div>
            <div class="ss-inline"><input class="ss-in" placeholder="직접 추가: 이름 (예: 까마귀)"><input class="ss-in n" type="number" placeholder="일수" value="2"><button class="ss-btn" data-add="1">추가</button></div>`;
        box.addEventListener('click', (e) => {
            const b = e.target.closest('[data-c]');
            if (b) { const n = b.dataset.c; const k = nd.couriers.findIndex(c => c.name === n); if (k >= 0) { if (nd.couriers.length > 1) nd.couriers.splice(k, 1); } else nd.couriers.push(clone(COURIER_PRESETS.find(p => p.name === n))); b.classList.toggle('on', nd.couriers.some(c => c.name === n)); }
            if (e.target.closest('[data-add]')) {
                const [i1, i2] = box.querySelectorAll('input'); const n = i1.value.trim(); if (!n) return;
                const dd = Math.max(0, Number(i2.value) || 1); nd.couriers.push({ name: n, icon: '✉️', min: dd, max: dd, fee: 0, note: '' }); i1.value = '';
                toastr.success(`${esc(n)} 추가`, TITLE);
            }
        });
        await app.popup(box, { okButton: '저장' });
        await commit('contact', nd, '');
    },
};
export const CONTACT_CHANGES = {};

// 선톡(편지 오게): 지금 바로 도착
export async function receivePing(who, auto) {
    const s = curState();
    const lines = await pingMessage(who, s, auto);
    if (!lines.length) return;
    const nd = clone(curState().data.contact);
    const now = nowTick(s);
    const letter = isLetter(nd);
    const c = courierOf(nd, who);
    const th = nd.threads[who] ??= [];
    for (const l of lines) th.push({ id: uid(), from: 'them', text: l, date: stamp(s), at: now, arrive: now, courier: letter ? c.name : '', ping: true });
    if (!findBy(nd.contacts, who)) nd.contacts.push({ name: who, handle: '', status: '', courier: '' });
    nd.unread[who] = (nd.unread[who] ?? 0) + 1;
    await commit('contact', nd, `${who}에게서 ${letter ? `${c.icon} 편지가 왔다` : '먼저 연락이 왔다'}: ${short(lines.join(' '), 40)}`);
    toastr.info(`${letter ? `📬 ${esc(who)}에게서 편지가 왔어요` : `💬 ${esc(who)}: ${esc(short(lines[0], 40))}`}`, TITLE);
}
export { getMeta };
