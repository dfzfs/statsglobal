// 프롬프트 템플릿 (모두 사용자가 수정 가능) · 확장 AI 호출 · 사용 기록
import { ctx, settings, saveSettings, LOG, TITLE, esc } from './core.js';

// group: 어느 때 쓰이는지 / cost: 토큰 종류
// inject = 본편(메인 AI) 요청에 매번 붙는 글 · call = 확장이 따로 AI를 부를 때 쓰는 글
export const PROMPT_DEFS = [
    // ── 본편 주입 (매 턴) ──
    { key: 'inj.header', group: 'inject', label: '상태 머리말', when: '본편 생성마다 (주입문 맨 앞)', text: '[STATUS SIM — the live game state of this roleplay. It is authoritative: keep the narration consistent with these numbers, places, dates and relationships. The extension tracks the numbers; you only report changes.]' },
    { key: 'inj.output', group: 'inject', label: '<status> 출력 규칙', when: '본편 생성마다 (자동 반영 A·A+B 모드)', text: '[STATUS OUTPUT] END every reply with a <status> block listing ONLY what changed this turn, one "key: value" per line, numbers signed. Nothing changed → <status></status>. No code fences. Values in Korean, names exactly as above.' },
    { key: 'inj.example', group: 'inject', label: '<status> 예시', when: '본편 생성마다 (규칙 주입: 전체일 때만)', text: 'Example:\n<status>\nstat: 체력 -8\ncash: -120\nitem: +낡은 열쇠\nloc: 항구 창고\naff: 레온 +3\n</status>' },
    { key: 'inj.dice', group: 'inject', label: '주사위 규칙', when: '본편 생성마다 (주사위 켬)', text: "Dice: when {{user}}'s message contains [판정 · …], that result was rolled by the system — narrate exactly that outcome (대성공/성공/실패/대실패). Don't roll dice yourself. For risky actions whose outcome is uncertain, ask for a roll with the roll key instead of deciding." },
    { key: 'inj.letter', group: 'inject', label: '편지 세계 규칙', when: '본편 생성마다 (연락 = 편지)', text: 'Communication: there are no phones. Letters ({app}) take time to arrive (days, by courier). Do not let distant characters react to a letter before it has arrived. A paid express courier can deliver the same day.' },
    { key: 'diff.easy', group: 'inject', label: '난이도: 이지', when: '본편 생성마다 (이 난이도일 때)', text: 'DIFFICULTY: EASY — a forgiving world. Mistakes rarely cost much; money, food and help are easy to find; people warm up quickly (aff +2~8 for a good moment); failures become small setbacks or comedy, never lasting harm.' },
    { key: 'diff.normal', group: 'inject', label: '난이도: 보통', when: '본편 생성마다 (이 난이도일 때)', text: 'DIFFICULTY: NORMAL — fair. Choices have real but recoverable consequences. aff +1~5 for ordinary good moments, +6~10 only for big ones; trust is earned through actions.' },
    { key: 'diff.hard', group: 'inject', label: '난이도: 하드', when: '본편 생성마다 (이 난이도일 때)', text: 'DIFFICULTY: HARD — unforgiving. Resources are scarce and prices high; people are guarded (aff +1~3, trust rises slowly and drops fast; betrayal is possible); failures leave lasting costs (injury, debt, lost items, enemies). Never rescue {{user}} for free; let bad decisions bite.' },
    // ── 확장 AI 호출 ──
    { key: 'gen.system', group: 'call', label: '생성 시스템 프롬프트', when: '상태창 만들기 · 칸 다시 생성 · 추가 지시', text: 'You are the world-builder behind a roleplay status UI (SillyTavern extension). You fill one panel at a time with concrete, story-ready data. Output ONLY one valid JSON object — no prose, no code fences, no comments. All human-readable values in Korean. Use the exact names used in the sources. Keep it playable: specific, not generic; not over-designed. Any genre works: modern, fantasy, magic academy, eastern/wuxia, medieval, early-modern, sci-fi, post-apocalypse or fan-fiction of an existing work (then follow the canon faithfully).' },
    { key: 'gen.core', group: 'call', label: '생성: 세계 핵심', when: '상태창 만들기 (처음 1번)', text: 'Write the world core. If sources exist, summarize THEM faithfully (do not invent a different world). If there are no sources, invent a fresh, coherent world from the instruction. If it is fan-fiction, put the original work\'s name in canon and stay true to it.' },
    { key: 'gen.profile', group: 'call', label: '생성: 프로필', when: '상태창 만들기 · 프로필 칸', text: 'Profiles for {{user}} (role user), the main characters (role main) and a few important NPCs (role npc, at most 4). MODE minimal: summary + at most 4 short fields, because the card/lorebook already has details. MODE detailed: 8-12 rich fields each (나이, 외모, 성격, 말투, 배경, 능력, 좋아하는 것, 싫어하는 것, 비밀 …) so this sheet alone can carry the character.' },
    { key: 'gen.stats', group: 'call', label: '생성: 수치', when: '상태창 만들기 · 수치 칸', text: '2-4 gauges fitting the genre (always a health-like one; e.g. 마나/기력/정신력/배고픔), 4-6 attributes used as dice modifiers (-2~+5) fitting {{user}}, and current conditions if any (may be empty).' },
    { key: 'gen.dice', group: 'call', label: '생성: 주사위', when: '상태창 만들기 · 주사위 칸', text: 'Pick d20 (DC 5~25) or d100 that fits the genre. 4-6 quick checks that this story will often need.' },
    { key: 'gen.wallet', group: 'call', label: '생성: 재산', when: '상태창 만들기 · 재산 칸', text: "Currency that fits the world and {{user}}'s realistic starting money and 3-6 belongings. {difficulty}" },
    { key: 'gen.shop', group: 'call', label: '생성: 상점', when: '상태창 만들기 · 상점 칸', text: '2-4 shops {{user}} can realistically use, 5-8 items each, prices consistent with the currency and starting money. Include at least one shop with kind "deco" furniture/decor for the home.' },
    { key: 'gen.home', group: 'call', label: '생성: 본거지', when: '상태창 만들기 · 본거지 칸', text: "{{user}}'s base/home fitting the world (a room, a house, a ship, a dorm, a sect courtyard…), 2-5 rooms/areas, a few existing decor items." },
    { key: 'gen.rel', group: 'call', label: '생성: 관계', when: '상태창 만들기 · 관계 칸', text: 'Relationships between {{user}} and each main character (realistic starting aff/trust, usually -10~30 unless the sources say otherwise), plus notable relationships between characters.' },
    { key: 'gen.map', group: 'call', label: '생성: 지도', when: '상태창 만들기 · 지도 칸', text: '6-14 places of the area where the story happens, with links forming a sensible graph and spread-out x,y. Set "here" to where {{user}} starts.' },
    { key: 'gen.calendar', group: 'call', label: '생성: 달력', when: '상태창 만들기 · 달력 칸', text: "In-world calendar: realistic start date for the story, the world's own month names/lengths if it has them (else 12 normal months), 3-8 recurring holidays/festivals and story-relevant events." },
    { key: 'gen.contact', group: 'call', label: '생성: 연락', when: '상태창 만들기 · 연락 칸', text: 'The communication method that fits the world and the people {{user}} can contact at the start. {contactMode} If mode is letter, give 2-4 couriers that fit the world (e.g. 배달부, 갈매기, 올빼미, 강아지, 전서구, 파발마, 마법 편지) with realistic days, and an express option that costs money.' },
    { key: 'gen.quest', group: 'call', label: '생성: 퀘스트', when: '상태창 만들기 · 퀘스트 칸 · 「의뢰 찾기」', text: '2-4 quests/requests/goals {{user}} could take now, fitting the world and current story (a mix of small errands and one bigger hook). Status open unless the story already started it (then active). Rewards consistent with the currency. {difficulty}' },
    { key: 'gen.news', group: 'call', label: '생성: 뉴스', when: '상태창 만들기 · 뉴스 칸 · 「새 소식 발행」', text: 'News of this world as of the current date: 3-5 headlines from the medium that fits the world (TV/portal, kingdom gazette, sect notice, broadsheet…). Mix world events with things that echo the recent story (without exposing private scenes). Do not repeat existing headlines.' },
    { key: 'gen.gossip', group: 'call', label: '생성: 가십지', when: '상태창 만들기 · 가십 칸 · 「새 호 발행」', text: 'A tabloid/gossip sheet of this world: 2-4 juicy rumors about the characters (and maybe {{user}}), based on what people could have seen or misheard in the recent story and relationships. Exaggerated, playful, sometimes wrong. Write in a tabloid voice.' },
    { key: 'gen.board', group: 'call', label: '생성: 게시판', when: '상태창 만들기 · 게시판 칸 · 「새 글 불러오기」', text: 'A community board that fits the world (guild board, anonymous forum, school board, sect notice wall…): 3-5 posts by various locals with 0-3 replies each. Everyday life, requests, complaints, rumors, reactions to recent events. Nicknames fitting the world.' },
    { key: 'gen.ach', group: 'call', label: '생성: 업적', when: '상태창 만들기 · 업적 칸', text: '15-25 achievements fitting this story: exploration, relationships, growth, fun, hidden ones (hidden true). All done false.' },
    { key: 'gen.memo', group: 'call', label: '생성: 메모', when: '상태창 만들기 · 메모 칸', text: '1-3 short starting memos by ai (e.g. current goal, a rumor). inject true.' },
    { key: 'gen.instruct', group: 'call', label: '추가 지시 규칙', when: '「AI로 수정」 (추가 지시)', text: 'Apply the instruction to the panel and return the WHOLE updated panel in the same JSON shape. Keep every part the instruction does not touch exactly as it is (same names, numbers, order). If the instruction asks to add things "fitting the story", use the recent story and world core.' },
    { key: 'ai.analyze', group: 'call', label: '별도 분석', when: '자동 반영 B(매 응답) · A+B(태그 빠졌을 때)', text: 'You are the state tracker of a roleplay status UI. Read the latest exchange and output ONLY a <status>…</status> block with what changed in this reply (one "key: value" per line). If nothing changed output <status></status>.' },
    { key: 'ai.phone', group: 'call', label: '연락: 메신저 답장', when: '메시지를 보내고 답장 받을 때 (1번 = 1호출)', text: 'You are {who}, texting {{user}} through "{app}". Reply in character, in Korean, like real messages: 1-3 short bubbles, one per line, no narration, no quotes, no name prefix. If {who} would plausibly not answer right now, output exactly (읽지 않음).' },
    { key: 'ai.letter', group: 'call', label: '연락: 편지 답장', when: '도착한 답장 편지를 열 때 (1통 = 1호출)', text: 'You are {who}, writing a reply letter to {{user}} by {courier}. In character, in Korean, as a real letter: greeting, 1-3 short paragraphs reacting to {{user}}\'s letter and to what happened since, a sign-off with {who}\'s name. No narration outside the letter. {rush}' },
    { key: 'ai.ping', group: 'call', label: '연락: 선톡 (먼저 연락)', when: '「먼저 연락 오게」 버튼 · 자동 선톡', text: 'You are {who}. {who} decides to contact {{user}} first through "{app}" — for a reason that fits {who}\'s personality, the relationship and the recent story (missing them, news, a request, teasing, worry…). Write only the message itself in Korean ({format}). No narration, no name prefix.' },
    { key: 'ai.boardReply', group: 'call', label: '게시판: 댓글 받기', when: '게시판 글에 「댓글 달리기」', text: 'Locals of this world reply to a community post. Write 2-4 replies with fitting nicknames (or known characters if they would plausibly comment). Output ONLY JSON: {"replies":[{"author":"닉네임","text":"댓글"}]}' },
];
export const PROMPT_MAP = Object.fromEntries(PROMPT_DEFS.map(p => [p.key, p]));

// 템플릿 가져오기: 사용자 수정본 → 기본값. {var} 치환 ({{user}} 같은 실리 매크로는 그대로 둔다)
export function P(key, vars = {}) {
    const s = settings();
    const raw = s.prompts?.[key] ?? PROMPT_MAP[key]?.text ?? '';
    return String(raw).replace(/\{([a-z][a-zA-Z0-9_]*)\}/g, (m, k) => (Object.hasOwn(vars, k) ? String(vars[k] ?? '') : m));
}
export function setPrompt(key, text) {
    const s = settings();
    s.prompts ??= {};
    if (text === null || text === undefined || text === PROMPT_MAP[key]?.text) delete s.prompts[key];
    else s.prompts[key] = text;
    saveSettings();
}

// ───── 토큰 세기 ─────
export async function countTokens(text) {
    const t = String(text ?? '');
    if (!t) return 0;
    try { const c = ctx(); if (c.getTokenCountAsync) return await c.getTokenCountAsync(t); } catch { /* ignore */ }
    return estTokens(t);
}
// 한글은 대략 1.6~2자/토큰, 영어는 4자/토큰
export function estTokens(t) {
    t = String(t ?? '');
    const ko = (t.match(/[ㄱ-힝]/g) || []).length;
    return Math.ceil(ko / 1.7 + (t.length - ko) / 3.8);
}

// ───── 사용 기록 ─────
export const FEATURE_NAMES = {
    gen: '칸 생성', wizard: '상태창 만들기', instruct: '추가 지시', analyze: '별도 분석', phone: '메신저 답장', letter: '편지 답장',
    ping: '선톡', autoping: '자동 선톡', news: '뉴스 발행', gossip: '가십 발행', board: '게시판 새 글', boardReply: '게시판 댓글', quest: '의뢰 찾기',
};
function recordUsage(entry) {
    const s = settings();
    s.usage = [...(s.usage ?? []), entry].slice(-120);
    saveSettings();
    try {
        const ledger = globalThis[Symbol.for('blue-lemonade.usage')];
        const c = ctx();
        ledger?.record?.({
            ext: TITLE, feature: FEATURE_NAMES[entry.f] ?? entry.f,
            model: entry.model || '', api: c.chatCompletionSettings?.chat_completion_source ?? c.mainApi ?? '',
            input: entry.inp, output: entry.out, estimated: true, ok: entry.ok, at: entry.t, chatId: c.getCurrentChatId?.(),
        });
    } catch { /* optional */ }
}

// ───── 확장 AI 호출 ─────
export function listProfiles() {
    const es = ctx().extensionSettings ?? {};
    if (es.disabledExtensions?.includes('connection-manager')) return [];
    return es.connectionManager?.profiles ?? [];
}
async function connService() {
    const c = ctx();
    if (c.ConnectionManagerRequestService) return c.ConnectionManagerRequestService;
    try { return (await import('/scripts/extensions/shared.js')).ConnectionManagerRequestService ?? null; } catch { return null; }
}
export async function aiGenerate(feature, systemPrompt, prompt, maxTokens) {
    const c = ctx();
    const subst = (t) => (c.substituteParams ? c.substituteParams(t) : t);
    systemPrompt = subst(systemPrompt); prompt = subst(prompt);
    const max = maxTokens ?? settings().aiMaxTokens ?? 6000;
    const id = settings().aiProfile;
    const entry = { t: Date.now(), f: feature, inp: estTokens(systemPrompt + prompt), out: 0, ok: false, model: '' };
    let text = '';
    try {
        if (id) {
            const prof = listProfiles().find(p => p.id === id);
            const svc = prof ? await connService() : null;
            if (prof && svc?.sendRequest) {
                entry.model = prof.model ?? prof.name ?? '';
                try {
                    let r;
                    try { r = await svc.sendRequest(id, [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }], max); }
                    catch { r = await svc.sendRequest(id, `${systemPrompt}\n\n${prompt}`, max); }
                    text = typeof r === 'string' ? r : (r?.content ?? '');
                } catch (e) {
                    console.warn(LOG, 'profile request failed', e);
                    toastr.warning(`연결 프로필 「${esc(prof.name)}」로 보내지 못해 메인 연결을 씁니다.`, TITLE);
                }
            }
        }
        if (!text) {
            try { entry.model ||= c.getChatCompletionModel?.() ?? ''; } catch { /* ignore */ }
            text = String(await c.generateRaw({ systemPrompt, prompt, responseLength: max }) ?? '');
        }
        entry.ok = !!text;
        entry.out = estTokens(text);
        return text;
    } finally {
        recordUsage(entry);
    }
}

export function parseJSON(text) {
    let t = String(text ?? '').trim();
    t = t.replace(/^[\s\S]*?```(?:json)?\s*/i, (m) => (m.includes('```') ? '' : m)).replace(/```[\s\S]*$/, '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('JSON을 찾지 못했습니다');
    t = t.slice(a, b + 1);
    try { return JSON.parse(t); } catch { /* repair */ }
    const fixed = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/,\s*([}\]])/g, '$1').replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":').replace(/\bNaN\b/g, 'null');
    return JSON.parse(fixed);
}
