// 확장 AI가 하는 일 (모두 토큰이 드는 호출)
import { app, ctx, settings, getMeta, MOD, NORM, normalize, short, findBy, norm, dateStr, stamp, MODULE, LOG, DIFFS, diffOf, CONTACT_MODES, uid } from './core.js';
import { P, aiGenerate, parseJSON } from './prompts.js';
import { SCHEMA } from './core.js';
import { compute, buildInjection, tagKeysFor, extractOps, stripStatus, recentChat, chatCharacters } from './engine.js';

const diffLine = () => `Difficulty: ${DIFFS[diffOf()].name} — ${P(`diff.${diffOf()}`)}`;
const contactModeLine = (mode) => (mode && mode !== 'auto' ? `Use mode "${mode}" (${CONTACT_MODES[mode]?.name}).` : 'Choose mode: phone for modern/sci-fi worlds with phones, instant for magic/radio/telepathy, letter for worlds without phones (letters take days).');

export async function genModule(mod, { sources, core, instruction, profileMode, current, extra, contactMode, feature = 'gen' }) {
    const L = [];
    if (sources) L.push(`=== SOURCES ===\n${sources}`);
    if (core && mod !== 'core') L.push(`=== WORLD CORE (already decided) ===\n${JSON.stringify(core)}`);
    if (extra) L.push(extra);
    if (instruction) L.push(`=== USER'S DIRECTION (highest priority) ===\n${instruction}`);
    L.push(`=== TASK ===\nPanel: ${mod === 'core' ? 'world core' : MOD[mod].name} — ${P(`gen.${mod}`, { difficulty: diffLine(), contactMode: contactModeLine(contactMode) })}${mod === 'profile' ? `\nMODE: ${profileMode ?? 'minimal'}` : ''}`);
    if (current) L.push(`=== CURRENT PANEL DATA ===\n${JSON.stringify(current)}`);
    L.push(`=== OUTPUT JSON SHAPE ===\n${SCHEMA[mod]}`);
    const obj = parseJSON(await aiGenerate(feature, P('gen.system'), L.join('\n\n')));
    if (mod === 'profile' && profileMode) obj.mode = profileMode;
    if (mod === 'contact' && contactMode && contactMode !== 'auto') obj.mode = contactMode;
    return mod === 'core' ? NORM.core(obj) : normalize(mod, obj);
}

export async function instructModule(mod, instruction, state) {
    const curData = mod === 'core' ? state.core : state.data[mod];
    const L = [
        `=== WORLD CORE ===\n${JSON.stringify(state.core)}`,
        `=== RECENT STORY ===\n${recentChat(Math.min(settings().recentForGen, 14)) || '(none)'}`,
        `=== PANEL: ${mod === 'core' ? 'world core' : MOD[mod].name} — CURRENT DATA ===\n${JSON.stringify(curData)}`,
        `=== USER'S EDIT INSTRUCTION ===\n${instruction}`,
        `=== RULES ===\n${P('gen.instruct')}`,
        `=== OUTPUT JSON SHAPE ===\n${SCHEMA[mod]}`,
    ];
    const obj = parseJSON(await aiGenerate('instruct', P('gen.system'), L.join('\n\n')));
    return mod === 'core' ? NORM.core(obj) : normalize(mod, obj);
}

export async function analyzeMessage(idx) {
    const c = ctx();
    const m = c.chat?.[idx];
    if (!m || m.is_user) return;
    const r = compute(idx);
    if (!r) return;
    const prevUser = [...c.chat.slice(0, idx)].reverse().find(x => x.is_user);
    const inj = buildInjection(r);
    const prompt = `${inj.main.replace(/\[STATUS OUTPUT\][\s\S]*$/, '')}\n${inj.people}\n\nKeys: ${tagKeysFor(getMeta()).join(' · ')}\n\n=== {{user}} ===\n${short(prevUser?.mes ?? '', 1500)}\n\n=== REPLY ===\n${short(stripStatus(m.mes), 4000)}`;
    try {
        const out = await aiGenerate('analyze', P('ai.analyze'), prompt, 600);
        const ops = extractOps(out.includes('<status>') ? out : `<status>\n${out}\n</status>`);
        m.extra ??= {};
        m.extra[MODULE] ??= { bySwipe: {} };
        m.extra[MODULE].bySwipe ??= {};
        m.extra[MODULE].bySwipe[m.swipe_id ?? 0] = ops;
        await (c.saveChat?.() ?? c.saveChatDebounced?.());
        app.refreshNow?.();
        app.notifyLatest?.();
    } catch (e) { console.warn(LOG, 'analyze failed', e); }
}

// 그 인물에 대해 알고 있는 것
function aboutPerson(who, state) {
    const d = state.data;
    const prof = d.profile ? findBy(d.profile.list, who) : null;
    const card = chatCharacters().find(ch => norm(ch.name) === norm(who));
    const rel = d.rel ? findBy(d.rel.user, who) : null;
    return [
        `World: ${state.core.title} — ${short(state.core.summary, 500)}`,
        d.calendar ? `Now: ${dateStr(d.calendar)} ${d.calendar.time}` : '',
        prof ? `About ${who}: ${prof.summary} ${prof.fields.map(f => `${f.k}: ${f.v}`).join(' / ')}` : card ? `About ${who}: ${short(card.description, 1500)}` : '',
        rel ? `Relationship with {{user}}: ${rel.label || '-'} · 호감 ${rel.aff} · 신뢰 ${rel.trust} · ${rel.memo}` : '',
        `Difficulty: ${DIFFS[diffOf()].name}`,
        `Recent story (for context):\n${recentChat(8)}`,
    ].filter(Boolean);
}
const threadText = (ct, who, n = 14) => (ct.threads[who] ?? []).filter(m => !m.pending).slice(-n).map(m => `${m.from === 'me' ? '{{user}}' : who}: ${m.text}`).join('\n');
const nameRe = (who) => new RegExp(`^\\s*(?:[-*•]\\s*)?(?:${who.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：]\\s*)?`);

// 메신저/즉시 통신 답장 → 말풍선 줄들
export async function phoneReply(who, state) {
    const ct = state.data.contact;
    const sys = P('ai.phone', { who, app: ct.app });
    const out = await aiGenerate('phone', sys, [...aboutPerson(who, state), `Conversation so far:\n${threadText(ct, who)}`].join('\n\n'), 400);
    return stripStatus(out).split(/\r?\n/).map(x => x.replace(nameRe(who), '').replace(/^["“](.*)["”]$/, '$1').trim()).filter(Boolean).slice(0, 4);
}
// 편지 답장 → 본문 하나
export async function letterReply(who, state, { courier, rush }) {
    const ct = state.data.contact;
    const sys = P('ai.letter', { who, app: ct.app, courier: courier || ct.app, rush: rush ? `${who} paid extra for an express courier so it arrives fast — it may show a little in the letter (eagerness).` : '' });
    const out = await aiGenerate('letter', sys, [...aboutPerson(who, state), `Letters so far (oldest first):\n${threadText(ct, who, 8)}`].join('\n\n'), 700);
    return stripStatus(out).replace(/^```\w*\s*|```\s*$/g, '').trim();
}
// 선톡
export async function pingMessage(who, state, auto = false) {
    const ct = state.data.contact;
    const letter = ct.mode === 'letter';
    const sys = P('ai.ping', { who, app: ct.app, format: letter ? 'a short letter: greeting, a paragraph or two, sign-off' : '1-3 short chat bubbles, one per line' });
    const out = await aiGenerate(auto ? 'autoping' : 'ping', sys, [...aboutPerson(who, state), `Earlier messages:\n${threadText(ct, who, 8) || '(none)'}`].join('\n\n'), letter ? 600 : 300);
    const t = stripStatus(out).trim();
    return letter ? [t] : t.split(/\r?\n/).map(x => x.replace(nameRe(who), '').replace(/^["“](.*)["”]$/, '$1').trim()).filter(Boolean).slice(0, 4);
}

// 뉴스 · 가십 · 게시판 · 퀘스트: 새 항목만 받아 온다
async function freshItems(mod, feature, state, extra = '') {
    const cur = state.data[mod];
    const L = [
        `=== WORLD CORE ===\n${JSON.stringify(state.core)}`,
        state.data.calendar ? `=== NOW ===\n${dateStr(state.data.calendar)} ${state.data.calendar.time}` : '',
        state.data.rel ? `=== RELATIONSHIPS ===\n${state.data.rel.user.map(r => `${r.name}: ${r.label} 호감${r.aff}`).join(' / ')}` : '',
        `=== RECENT STORY ===\n${recentChat(Math.min(settings().recentForGen, 16)) || '(none)'}`,
        `=== EXISTING (don't repeat) ===\n${JSON.stringify(cur ?? {}).slice(0, 3000)}`,
        extra,
        `=== TASK ===\n${P(`gen.${mod}`, { difficulty: diffLine() })}\nReturn ONLY new entries.`,
        `=== OUTPUT JSON SHAPE ===\n${SCHEMA[mod]}`,
    ].filter(Boolean);
    return parseJSON(await aiGenerate(feature, P('gen.system'), L.join('\n\n')));
}
export async function newNews(state) {
    const o = normalize('news', await freshItems('news', 'news', state));
    const date = stamp(state);
    return { name: o.name, items: o.items.map(x => ({ ...x, id: uid(), date, read: false })) };
}
export async function newGossip(state) {
    const o = normalize('gossip', await freshItems('gossip', 'gossip', state));
    const date = stamp(state);
    return { name: o.name, issues: o.issues.map(x => ({ ...x, id: uid(), date, read: false })) };
}
export async function newPosts(state) {
    const o = normalize('board', await freshItems('board', 'board', state));
    const date = stamp(state);
    return { name: o.name, posts: o.posts.map(x => ({ ...x, id: uid(), date, mine: false })) };
}
export async function newQuests(state) {
    const o = normalize('quest', await freshItems('quest', 'quest', state));
    return o.list.map(q => ({ ...q, id: uid(), status: 'open', paid: false }));
}
export async function boardReplies(state, post) {
    const L = [
        `=== WORLD CORE ===\n${JSON.stringify(state.core)}`,
        `=== RECENT STORY ===\n${recentChat(8) || '(none)'}`,
        `=== BOARD: ${state.data.board?.name || ''} ===`,
        `=== POST by ${post.mine ? '{{user}}' : post.author} ===\n${post.title}\n${post.body}`,
        post.replies.length ? `=== EXISTING REPLIES ===\n${post.replies.map(r => `${r.mine ? '{{user}}' : r.author}: ${r.text}`).join('\n')}` : '',
    ].filter(Boolean);
    const o = parseJSON(await aiGenerate('boardReply', P('ai.boardReply'), L.join('\n\n'), 700));
    return (Array.isArray(o.replies) ? o.replies : []).filter(r => r?.text).map(r => ({ id: uid(), author: String(r.author || '익명'), text: String(r.text), mine: false })).slice(0, 5);
}
