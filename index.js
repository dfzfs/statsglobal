// 상태창 시뮬 (StatusSim) v2 — SillyTavern UI extension
// 어떤 카드·세계관에도 붙는 범용 상태창. 모든 칸은 AI가 처음 채우고, 직접 편집 · 추가 지시 · 다시 생성이 된다.
import { app, ctx, settings, saveSettings, getMeta, saveMeta, isActive, ready, modOn, MODS, MOD_IDS, MOD, esc, short, splitBar, findBy, TITLE, LOG, VERSION, MODULE, sub, rand, DIFFS } from './src/core.js';
import { compute, buildInjection, setInjection, addAdjust, KEYMAP, unreadCount } from './src/engine.js';
import { analyzeMessage, instructModule } from './src/ai.js';
import { listProfiles } from './src/prompts.js';
import { diffHTML, confirmPopup, applyTheme } from './src/kit.js';
import { ensureUI, rerenderPanels, openSheet, openWizard, openRoll, openPromptWindow, openThemeWindow, panels, renderHud } from './src/shell.js';
import { receivePing } from './src/contact.js';
import { translateSheet } from './src/translate.js';

const REGEX_IDS = { show: 'b7c1a0e2-5a1d-4f0e-9a51-55a1a0c05501', strip: 'b7c1a0e2-5a1d-4f0e-9a51-55a1a0c05502' };

// ───── 메시지 변동 칩 ─────
function decorateAll() {
    if (!app.current) return;
    const set = settings();
    document.querySelectorAll('#chat .mes').forEach(mesEl => {
        const i = Number(mesEl.getAttribute('mesid'));
        const textEl = mesEl.querySelector('.mes_text');
        if (!textEl || Number.isNaN(i)) return;
        const snap = app.current.snaps.get(i);
        textEl.querySelectorAll('.ss-slot, .custom-ss-slot').forEach((slot, k) => {
            if (k > 0 || !snap || set.msgCard === 'off' || (!snap.labels.length && !snap.roll)) { slot.innerHTML = ''; slot.style.display = 'none'; return; }
            slot.style.display = '';
            const rollBtn = snap.roll && i === app.current.lastAI ? `<button class="ss-mchip roll" data-roll="${esc(snap.roll.label)}|${snap.roll.dc}"><i class="fa-solid fa-dice-d20"></i> ${esc(snap.roll.label)} 굴리기</button>` : '';
            slot.innerHTML = `<div class="ss-msgcard ss-scope">${snap.labels.filter(l => !l.startsWith('🎲')).slice(0, 14).map(l => `<span class="ss-mchip ${/[−-]\d/.test(l) ? 'neg' : /\+\d/.test(l) ? 'pos' : ''}">${esc(l)}</span>`).join('')}${rollBtn}</div>`;
        });
    });
}
document.addEventListener('click', (e) => {
    const b = e.target.closest('.ss-mchip.roll');
    if (!b) return;
    const [label, dc] = splitBar(b.dataset.roll);
    openRoll(label, Number(dc) || 0);
});

let notified = new Set();
function notifyLatest() {
    if (!app.current) return;
    const c = ctx();
    const i = app.current.lastAI;
    const m = c.chat?.[i];
    if (!m) return;
    const key = `${c.getCurrentChatId?.()}:${i}:${m.swipe_id ?? 0}:${m.mes?.length}`;
    if (notified.has(key)) return;
    notified.add(key);
    for (const a of app.current.snaps.get(i)?.alerts ?? []) toastr.info(esc(a), TITLE);
}
app.notifyLatest = notifyLatest;
app.decorate = decorateAll;

// ───── 정규식 ─────
function regexScripts() {
    return [
        { id: REGEX_IDS.show, scriptName: '상태창 시뮬 ① <status> 블록 → 변동 칩', findRegex: '/<status>[\\s\\S]*?(?:<\\/status>|$)/gi', replaceString: '<div class="ss-slot"></div>', trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null },
        { id: REGEX_IDS.strip, scriptName: '상태창 시뮬 ② 오래된 <status> 프롬프트에서 제거', findRegex: '/\\s*<status>[\\s\\S]*?(?:<\\/status>|$)/gi', replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: true, runOnEdit: false, substituteRegex: 0, minDepth: 3, maxDepth: null },
    ];
}
function installRegex(reload = true) {
    const es = ctx().extensionSettings;
    if (!Array.isArray(es.regex)) es.regex = [];
    let changed = false;
    for (const sc of regexScripts()) if (!es.regex.some(x => x.id === sc.id)) { es.regex.push(sc); changed = true; }
    if (changed) { saveSettings(); if (reload) ctx().reloadCurrentChat?.(); }
    return changed;
}
function removeRegex() {
    const es = ctx().extensionSettings;
    if (!Array.isArray(es.regex)) return;
    es.regex = es.regex.filter(x => !Object.values(REGEX_IDS).includes(x.id));
    saveSettings();
    ctx().reloadCurrentChat?.();
}

// ───── 갱신 ─────
let refreshTimer = null;
function refresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshNow, 60); }
function refreshNow() {
    clearTimeout(refreshTimer);
    try {
        if (!isActive() || !ready()) { app.current = null; setInjection(null); }
        else {
            app.current = compute();
            setInjection(getMeta()?.paused ? null : buildInjection(app.current));
            decorateAll();
        }
        ensureUI();
        rerenderPanels();
    } catch (e) { console.error(LOG, e); }
}
app.refreshNow = refreshNow;

// ───── 확장 설정 서랍 ─────
function profileOptions(sel) {
    return `<option value="">메인 연결 그대로</option>${listProfiles().map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
}
function renderSettings() {
    if (document.getElementById('ss-settings')) return;
    const s = settings();
    const o = (k, v, label) => `<option value="${v}" ${String(s[k]) === String(v) ? 'selected' : ''}>${label}</option>`;
    const el = document.createElement('div');
    el.id = 'ss-settings';
    el.className = 'ss-settings';
    el.innerHTML = `<div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header"><b>상태창 시뮬 <small>v${VERSION}</small></b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
        <div class="inline-drawer-content">
            <label class="checkbox_label"><input type="checkbox" data-s="enabled" ${s.enabled ? 'checked' : ''}> 사용</label>
            <div class="ss-set-btns">
                <button class="menu_button" data-s-act="open"><i class="fa-solid fa-gauge-high"></i> 상태창 열기</button>
                <button class="menu_button" data-s-act="wizard"><i class="fa-solid fa-wand-magic-sparkles"></i> 만들기</button>
                <button class="menu_button" data-s-act="prompts"><i class="fa-solid fa-scroll"></i> 프롬프트 · 토큰</button>
                <button class="menu_button" data-s-act="theme"><i class="fa-solid fa-palette"></i> 꾸미기</button>
                <button class="menu_button" data-s-act="chaton">이 채팅에서 켜기</button>
            </div>
            <label>새 채팅 기본 난이도<select class="text_pole" data-s="difficulty">${Object.entries(DIFFS).map(([k, v]) => o('difficulty', k, v.name)).join('')}</select></label>
            <label>스토리 → 상태창 자동 반영<select class="text_pole" data-s="sync">
                ${o('sync', 'tag', 'A. 태그 — 메인 AI가 응답 끝에 &lt;status&gt; (추천 · 추가 호출 없음)')}
                ${o('sync', 'tagPlus', 'A+B. 태그 + 빠졌을 때만 별도 분석')}
                ${o('sync', 'analyze', 'B. 별도 분석 — 매 응답 뒤 AI 1회 더 (정확 · 비용↑)')}
                ${o('sync', 'off', 'C. 끔 — 직접 편집·추가 지시로만')}</select></label>
            <label>규칙 주입<select class="text_pole" data-s="injectMode">${o('injectMode', 'full', '전체 (세계 요약·예시 포함)')}${o('injectMode', 'lite', '간결 (토큰 절약)')}</select></label>
            <label>메시지 변동 칩<select class="text_pole" data-s="msgCard">${o('msgCard', 'compact', '보이기')}${o('msgCard', 'off', '숨기기')}</select></label>
            <b class="ss-set-h">상태창 언어 · 번역</b>
            <small>상태창 칸(프로필·상점·편지·뉴스…)을 만드는 <b>확장 AI 모델</b>과, 그걸 번역하는 <b>번역 모델</b>을 따로 고를 수 있어요. 롤플 본문과는 상관없어요.</small>
            <label>상태창 생성 언어<select class="text_pole" data-s="ssGenLang">${o('ssGenLang', 'ko', '한국어로 바로 생성 (번역 없음)')}${o('ssGenLang', 'en', '영어로 생성 → 번역 모델로 번역 (생성마다 번역 1회 추가)')}</select></label>
            <label>번역 모델 (연결 프로필)<div class="ss-set-inline"><select class="text_pole" data-s="trProfile">${profileOptions(s.trProfile).replace('메인 연결 그대로', '확장 AI 모델 그대로 (없으면 메인)')}</select></div></label>
            <label>번역할 언어<input class="text_pole" data-s="trLang" value="${esc(s.trLang)}"></label>
            <div class="ss-set-btns"><button class="menu_button" data-s-act="trsheet"><i class="fa-solid fa-language"></i> 상태창 전체 번역</button></div>
            <b class="ss-set-h">일시정지 · OOC</b>
            <label class="checkbox_label"><input type="checkbox" data-s="oocDetect" ${s.oocDetect ? 'checked' : ''}> 내 메시지가 OOC로 시작하면 그 턴은 상태창 안 보냄 <small>((, (OOC, [OOC, //</small></label>
            <label class="checkbox_label"><input type="checkbox" data-s="skipQuiet" ${s.skipQuiet ? 'checked' : ''}> 조용한 생성·퀵리플라이(/gen 등)엔 안 보냄</label>
            <small>퀵리플라이에서는 <code>/ss-pause</code> · <code>/ss-resume</code> · <code>/ss-skip</code> (다음 1번만)</small>
            <b class="ss-set-h">연락</b>
            <label class="checkbox_label"><input type="checkbox" data-s="contactInject" ${s.contactInject ? 'checked' : ''}> 최근 연락 내용을 본편 AI에게 알려 주기</label>
            <label class="checkbox_label"><input type="checkbox" data-s="autoPing" ${s.autoPing ? 'checked' : ''}> 자동 선톡 (가끔 누군가 먼저 연락 · 확장 AI 1회)</label>
            <label>자동 선톡 간격 (AI 응답 수)<input type="number" min="2" max="100" class="text_pole" data-s="autoPingEvery" value="${s.autoPingEvery}"></label>
            <label>상대가 웃돈 주고 급행으로 답장할 확률 % (호감이 높을수록 ↑)<input type="number" min="0" max="100" class="text_pole" data-s="rushChance" value="${s.rushChance}"></label>
            <b class="ss-set-h">확장 AI</b>
            <label>확장 AI에 쓸 모델 (연결 프로필)
                <div class="ss-set-inline"><select class="text_pole" data-s="aiProfile">${profileOptions(s.aiProfile)}</select><button class="menu_button" data-s-act="profiles" title="새로고침"><i class="fa-solid fa-rotate"></i></button></div>
                <small>만들기·추가 지시·연락 답장·뉴스 등에만 쓰여요. 롤플 본문은 메인 연결.</small></label>
            <label>확장 AI 최대 출력 토큰<input type="number" min="500" max="32000" class="text_pole" data-s="aiMaxTokens" value="${s.aiMaxTokens}"></label>
            <label>생성 때 읽을 최근 채팅 수<input type="number" min="0" max="100" class="text_pole" data-s="recentForGen" value="${s.recentForGen}"></label>
            <label>생성 때 읽을 로어북 최대 글자 수<input type="number" min="0" max="100000" step="1000" class="text_pole" data-s="loreChars" value="${s.loreChars}"></label>
            <label>상태 주입 깊이 (0 = 맨 끝)<input type="number" min="0" max="20" class="text_pole" data-s="injectDepth" value="${s.injectDepth}"></label>
            <label class="checkbox_label"><input type="checkbox" data-s="autoRegex" ${s.autoRegex ? 'checked' : ''}> &lt;status&gt; 숨김 정규식 자동 설치</label>
            <div class="ss-set-btns">
                <button class="menu_button" data-s-act="defmods">지금 기능 구성을 새 채팅 기본값으로</button>
                <button class="menu_button" data-s-act="regex">정규식 설치</button>
                <button class="menu_button" data-s-act="unregex">정규식 제거</button>
            </div>
        </div></div>`;
    el.addEventListener('change', (e) => {
        const k = e.target.dataset.s;
        if (!k) return;
        settings()[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value;
        saveSettings();
        if (k === 'autoRegex' && e.target.checked) installRegex();
        refreshNow();
    });
    el.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-s-act]')?.dataset.sAct;
        if (!a) return;
        if (a === 'open') openSheet();
        if (a === 'wizard') openWizard();
        if (a === 'prompts') openPromptWindow();
        if (a === 'theme') openThemeWindow();
        if (a === 'chaton') { const m = getMeta(true); m.off = false; await saveMeta(); refreshNow(); toastr.success('이 채팅에서 켰어요.', TITLE); }
        if (a === 'profiles') { el.querySelector('[data-s="trProfile"]').innerHTML = profileOptions(settings().trProfile).replace('메인 연결 그대로', '확장 AI 모델 그대로 (없으면 메인)'); el.querySelector('[data-s="aiProfile"]').innerHTML = profileOptions(settings().aiProfile); toastr.info(`연결 프로필 ${listProfiles().length}개`, TITLE); }
        if (a === 'defmods') { const m = getMeta(); if (!m) return; settings().defaultMods = { ...m.mods }; saveSettings(); toastr.success('저장했어요.', TITLE); }
        if (a === 'regex') installRegex() ? toastr.success('설치했어요.', TITLE) : toastr.info('이미 설치되어 있어요.', TITLE);
        if (a === 'unregex') { removeRegex(); toastr.info('제거했어요.', TITLE); }
        if (a === 'trsheet') translateSheet(e.target.closest('button'));
    });
    document.getElementById('extensions_settings2')?.appendChild(el);
}

// ───── 슬래시 커맨드 ─────
function registerCommands() {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } = ctx();
    if (!SlashCommandParser?.addCommandObject) return;
    const tabs = ['home', ...MOD_IDS, 'manage'];
    const add = (p) => SlashCommandParser.addCommandObject(SlashCommand.fromProps(p));
    add({
        name: 'ss',
        callback: (_n, tab) => {
            const t = String(tab ?? '').trim();
            let id = ['home', '홈'].includes(t) ? 'home' : ['manage', '관리'].includes(t) ? 'manage' : ['base', '본거지'].includes(t) ? 'base' : MOD_IDS.includes(t) ? t : MODS.find(m => m.name === t)?.id;
            if (id === 'home' && !['home', '홈'].includes(t)) id = 'base';
            openSheet(id); return '';
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '탭 (지도, 상점, 연락, 퀘스트 …)', typeList: ARGUMENT_TYPE.STRING, isRequired: false })],
        helpString: '상태창을 연다. 예: /ss 지도',
    });
    add({ name: 'ss-make', callback: () => { openWizard(); return ''; }, helpString: '상태창 만들기 창을 연다.' });
    add({ name: 'ss-prompts', callback: () => { openPromptWindow(); return ''; }, helpString: '프롬프트 · 토큰 창을 연다.' });
    add({ name: 'ss-pause', callback: async () => { const m = getMeta(true); m.paused = true; await saveMeta(); refreshNow(); return ''; }, helpString: '상태창 일시정지 (AI에게 상태를 보내지 않음).' });
    add({ name: 'ss-resume', callback: async () => { const m = getMeta(true); m.paused = false; await saveMeta(); refreshNow(); return ''; }, helpString: '상태창 다시 켜기.' });
    add({ name: 'ss-skip', callback: async () => { const m = getMeta(true); m.skipOnce = true; await saveMeta(); return ''; }, helpString: '다음 생성 1번만 상태창 없이 보낸다 (퀵리플라이 앞에).' });
    add({
        name: 'ss-roll',
        callback: (_n, label) => { openRoll(String(label ?? '').trim(), 0); return ''; },
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '판정 이름', typeList: ARGUMENT_TYPE.STRING, isRequired: false })],
        helpString: '주사위 판정 창을 연다. 예: /ss-roll 은신',
    });
    add({
        name: 'ss-set',
        callback: async (named, text) => {
            if (!ready()) return '';
            const key = String(named.key ?? '').trim();
            if (!KEYMAP[key.toLowerCase()]) { toastr.warning('key가 올바르지 않아요. 예: /ss-set key=cash +500', TITLE); return ''; }
            await addAdjust({ ops: [[key, String(text ?? '')]], label: `${key} ${text}` });
            return '';
        },
        namedArgumentList: [SlashCommandNamedArgument.fromProps({ name: 'key', description: 'stat, cash, item, loc, aff, date, quest, news, msg …', typeList: ARGUMENT_TYPE.STRING, isRequired: true })],
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '값 (<status> 한 줄과 같은 형식)', typeList: ARGUMENT_TYPE.STRING, isRequired: true })],
        helpString: '상태를 직접 바꾼다. 예: /ss-set key=stat 체력 -10',
    });
    add({
        name: 'ss-instruct',
        callback: async (named, text) => {
            if (!ready()) return '';
            const t = String(named.tab ?? '').trim();
            const id = t === 'world' || t === '세계' ? 'core' : MOD_IDS.includes(t) ? t : MODS.find(m => m.name === t)?.id;
            if (!id) { toastr.warning('tab이 올바르지 않아요. 예: /ss-instruct tab=지도 북쪽에 설산 추가', TITLE); return ''; }
            try {
                const after = await instructModule(id, String(text ?? ''), app.current.state);
                const box = document.createElement('div'); box.className = 'ss-root ss-scope ss-preview';
                box.innerHTML = `<h3>바뀌는 내용 — ${esc(id === 'core' ? '세계' : MOD[id].name)}</h3>${diffHTML(id === 'core' ? app.current.state.core : app.current.state.data[id], after)}`;
                if (await confirmPopup(box)) await addAdjust({ set: { mod: id, data: after }, label: `💬 ${id === 'core' ? '세계' : MOD[id].name} 수정: ${short(text, 40)}` });
            } catch (e) { toastr.error(esc(e.message), TITLE); }
            return '';
        },
        namedArgumentList: [SlashCommandNamedArgument.fromProps({ name: 'tab', description: '칸 (세계, 지도, 상점 …)', typeList: ARGUMENT_TYPE.STRING, isRequired: true })],
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '추가 지시', typeList: ARGUMENT_TYPE.STRING, isRequired: true })],
        helpString: '한 칸에 추가 지시. 예: /ss-instruct tab=상점 암시장 추가',
    });
    add({ name: 'ss-get', callback: () => (app.current ? sub(`${buildInjection(app.current).main}\n${buildInjection(app.current).people}`) : ''), helpString: '지금 상태(주입문)를 텍스트로 돌려준다.' });
}

// ───── 이벤트 ─────
function lastUserText() {
    const chat = ctx().chat ?? [];
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i]?.is_user) return String(chat[i].mes ?? '');
    return '';
}
async function onBeforeGenerate(type, _opts, dryRun) {
    if (dryRun || !isActive() || !ready()) return;
    const set = settings(), meta = getMeta();
    let skip = !!meta.paused;
    if (!skip && meta.skipOnce) { skip = true; meta.skipOnce = false; saveMeta(); renderHud(); }
    if (!skip && set.skipQuiet && type === 'quiet') skip = true;
    if (!skip && set.oocDetect && type !== 'quiet' && type !== 'continue') {
        try { if (new RegExp(set.oocPattern, 'i').test(lastUserText())) skip = true; } catch { /* bad pattern */ }
    }
    if (skip) { setInjection(null); return; }
    const chat = ctx().chat ?? [];
    let limit = chat.length;
    const last = chat[chat.length - 1];
    if ((type === 'swipe' || type === 'regenerate') && last && !last.is_user) limit = chat.length - 1;
    try { setInjection(buildInjection(compute(limit))); } catch (e) { console.error(LOG, e); }
}
function onGenEnded() { refresh(); }
const analyzed = new Set();
let pingCounter = 0;
function onCharRendered(id, type) {
    refreshNow();
    notifyLatest();
    if (!isActive() || !ready() || type === 'quiet' || getMeta()?.paused) return;
    const chat = ctx().chat ?? [];
    const i = Number(id ?? chat.length - 1);
    const m = chat[i];
    if (!m || m.is_user || i !== chat.length - 1) return;
    const set = settings();
    // 자동 선톡
    if (set.autoPing && modOn('contact') && app.current?.state.data.contact?.contacts.length) {
        pingCounter++;
        if (pingCounter >= Math.max(2, set.autoPingEvery) && rand(100) <= 50) {
            pingCounter = 0;
            const cs = app.current.state.data.contact.contacts;
            receivePing(cs[rand(cs.length) - 1].name, true).catch(e => console.warn(LOG, 'autoping', e));
        }
    }
    if (set.sync !== 'analyze' && set.sync !== 'tagPlus') return;
    if (set.sync === 'tagPlus' && /<status>/i.test(m.mes)) return;
    if (m.extra?.[MODULE]?.bySwipe?.[m.swipe_id ?? 0]) return;
    const key = `${ctx().getCurrentChatId?.()}:${i}:${m.swipe_id ?? 0}:${m.mes.length}`;
    if (analyzed.has(key)) return;
    analyzed.add(key);
    analyzeMessage(i);
}
function onChatChanged() {
    notified = new Set();
    pingCounter = 0;
    for (const el of panels) if (el._ss) { el._ss.mode = 'view'; el._ss.ui = {}; el._ss.tab = 'home'; }
    refreshNow();
}

function init() {
    const { eventSource, event_types: E } = ctx();
    settings();
    applyTheme();
    renderSettings();
    registerCommands();
    if (settings().autoRegex) installRegex(false);
    const on = (name, fn) => { if (E[name]) eventSource.on(E[name], fn); };
    on('CHAT_CHANGED', onChatChanged);
    on('GENERATION_AFTER_COMMANDS', onBeforeGenerate);
    on('CHARACTER_MESSAGE_RENDERED', onCharRendered);
    for (const ev of ['USER_MESSAGE_RENDERED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MORE_MESSAGES_LOADED', 'GENERATION_STOPPED']) on(ev, refresh);
    on('GENERATION_ENDED', onGenEnded);
    refreshNow();
    console.log(LOG, 'loaded', VERSION);
}

{
    const { eventSource: _es, event_types: _et } = SillyTavern.getContext();
    _es.on(_et.APP_READY, init);
}

if (globalThis.__SS_TEST__) globalThis.__SS_TEST__.api = { refreshNow, decorateAll, onBeforeGenerate, init };
