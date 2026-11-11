// 🌐 후번역: 본편은 원하는 모델·언어로 생성 → 고른 (싼) 모델로 번역해서 화면에만 보여 준다
// 번역은 message.extra.display_text 에 넣는다 (실리 기본 번역 확장과 같은 자리). AI에게 가는 원문(mes)은 그대로.
import { app, ctx, settings, saveSettings, esc, TITLE, LOG, findBy } from './core.js';
import { P, aiGenerate } from './prompts.js';
import { stripStatus } from './engine.js';

const STATUS_RE = /<status>[\s\S]*?(?:<\/status>|$)/gi;
function hash(t) { let h = 0; t = String(t ?? ''); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return String(h); }
const trOf = (m) => m?.extra?.statussim_tr;
export const isTranslated = (m) => !!trOf(m) && trOf(m).src === hash(m.mes);

// 이름 표: 영어 본문에 나오는 이름을 한국어 이름으로 맞추게
function glossary() {
    const s = app.current?.state;
    if (!s) return '';
    const names = new Set();
    for (const p of s.data.profile?.list ?? []) names.add(p.name);
    for (const r of s.data.rel?.user ?? []) names.add(r.name);
    for (const p of s.data.map?.places ?? []) names.add(p.name);
    const list = [...names].filter(Boolean).slice(0, 40);
    return list.length ? `Use these Korean names exactly when they appear (in any language): ${list.join(', ')}` : '';
}

export async function translateMessage(i, { quiet = false } = {}) {
    const c = ctx();
    const m = c.chat?.[i];
    if (!m || m.is_system || !m.mes?.trim()) return false;
    if (m.is_user && !settings().trUser) return false;
    const body = stripStatus(m.mes);
    if (!body) return false;
    const blocks = (m.mes.match(STATUS_RE) ?? []).join('\n');
    const set = settings();
    const sys = P('ai.translate', { lang: set.trLang || '한국어', glossary: glossary() });
    let out;
    try {
        out = await aiGenerate('translate', sys, body, Math.min(8000, Math.max(800, Math.ceil(body.length * 1.5))), { profile: set.trProfile || '' });
    } catch (e) { console.warn(LOG, 'translate', e); if (!quiet) toastr.error(`번역 실패: ${esc(e.message)}`, TITLE); return false; }
    out = String(out ?? '').replace(/^```[a-z]*\s*|```\s*$/g, '').trim();
    if (!out) return false;
    const cur = c.chat[i];
    if (cur !== m) return false; // 그사이 바뀜
    m.extra ??= {};
    m.extra.statussim_tr = { src: hash(m.mes), text: out };
    m.extra.display_text = blocks ? `${out}\n\n${blocks}` : out;
    m.extra.statussim_tr_on = true;
    rerender(i);
    await c.saveChat?.();
    return true;
}
function rerender(i) {
    const c = ctx();
    try { c.updateMessageBlock?.(i, c.chat[i]); } catch (e) { console.warn(LOG, e); }
    app.decorate?.();
}
// 원문 ↔ 번역
export async function toggleMessage(i) {
    const c = ctx(); const m = c.chat?.[i]; const tr = trOf(m);
    if (!tr) return;
    const blocks = (m.mes.match(STATUS_RE) ?? []).join('\n');
    if (m.extra.statussim_tr_on) { delete m.extra.display_text; m.extra.statussim_tr_on = false; }
    else { m.extra.display_text = blocks ? `${tr.text}\n\n${blocks}` : tr.text; m.extra.statussim_tr_on = true; }
    rerender(i);
    await c.saveChat?.();
}
// 원문이 바뀐(수정·스와이프) 메시지의 옛 번역 치우기
export function cleanStale() {
    const c = ctx(); let n = 0;
    (c.chat ?? []).forEach((m, i) => {
        if (trOf(m) && !isTranslated(m)) { if (m.extra.statussim_tr_on) delete m.extra.display_text; delete m.extra.statussim_tr; delete m.extra.statussim_tr_on; rerender(i); n++; }
    });
    return n;
}

let running = false, stop = false;
export async function translateAll(btn) {
    if (running) { stop = true; return; }
    const c = ctx();
    const todo = (c.chat ?? []).map((m, i) => [m, i]).filter(([m]) => !m.is_system && (!m.is_user || settings().trUser) && m.mes?.trim() && !isTranslated(m)).map(([, i]) => i);
    if (!todo.length) { toastr.info('번역할 메시지가 없어요.', TITLE); return; }
    if (!(await c.Popup.show.confirm(TITLE, `번역 안 된 메시지 ${todo.length}개를 번역해요 (번역 모델 ${todo.length}회 호출). 다시 누르면 멈춰요.`))) return;
    running = true; stop = false;
    const old = btn?.innerHTML;
    let k = 0;
    for (const i of todo) {
        if (stop) break;
        if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${k}/${todo.length} · 누르면 멈춤`;
        if (await translateMessage(i, { quiet: true })) k++;
    }
    running = false;
    if (btn) btn.innerHTML = old;
    toastr.success(`${k}개 번역했어요${stop ? ' (멈춤)' : ''}.`, TITLE);
}
export async function clearAll() {
    const c = ctx();
    if (!(await c.Popup.show.confirm(TITLE, '이 채팅의 번역을 모두 지우고 원문으로 볼까요?'))) return;
    (c.chat ?? []).forEach((m, i) => { if (trOf(m)) { if (m.extra.statussim_tr_on) delete m.extra.display_text; delete m.extra.statussim_tr; delete m.extra.statussim_tr_on; rerender(i); } });
    await c.saveChat?.();
}

// 메시지마다 작은 「원문/번역」 단추
export function decorateTranslations() {
    const c = ctx();
    document.querySelectorAll('#chat .mes').forEach(el => {
        const i = Number(el.getAttribute('mesid'));
        const m = c.chat?.[i];
        let bar = el.querySelector('.ss-trbar');
        if (!m || !isTranslated(m)) { bar?.remove(); return; }
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'ss-trbar ss-scope';
            el.querySelector('.mes_text')?.after(bar);
        }
        bar.innerHTML = `<button class="ss-trbtn" data-tr="${i}"><i class="fa-solid fa-language"></i> ${m.extra.statussim_tr_on ? '원문 보기' : '번역 보기'}</button>`;
    });
}
document.addEventListener('click', (e) => {
    const b = e.target.closest('.ss-trbtn'); if (!b) return;
    e.preventDefault(); toggleMessage(Number(b.dataset.tr));
});

// 새 AI 답 자동 번역
const done = new Set();
export function onRendered(id, type) {
    const set = settings();
    if (set.trMode !== 'auto' || type === 'quiet') return;
    const c = ctx();
    const i = Number(id ?? (c.chat?.length ?? 1) - 1);
    const m = c.chat?.[i];
    if (!m || m.is_user || m.is_system || isTranslated(m)) return;
    const key = `${c.getCurrentChatId?.()}:${i}:${hash(m.mes)}`;
    if (done.has(key)) return;
    done.add(key);
    translateMessage(i, { quiet: true });
}
export function onUserRendered(id) {
    const set = settings();
    if (set.trMode !== 'auto' || !set.trUser) return;
    const c = ctx(); const i = Number(id); const m = c.chat?.[i];
    if (m && !isTranslated(m)) translateMessage(i, { quiet: true });
}
export { findBy, saveSettings };
