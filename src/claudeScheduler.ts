import Anthropic from '@anthropic-ai/sdk';
import { ScheduleData, ScheduleSolution, Appointment, WishRequest, WishSolution, WishOp, FixItOptions } from './types';
import { v4 as uuidv4 } from 'uuid';
import {
  buildAnonymizationMap,
  anonymizeAppointment,
  anonymizeSchedule,
  scrubText,
  deAnonymizeText,
  resolveClientReferences,
  containsEntityName,
  EntityResolution,
  AnonymizationMap,
} from './anonymizer';
import { summarizeWish } from './wish';
import { parseWishSolutions, parseChatTurn, parseToolTurn } from './wish';
import { allowedStrategies } from './fixit';
import { computeClientCompliance, computeTechCompliance, monthPeriod } from './compliance';
import { resolveUtilization } from './utilization';
import { buildFillContext, buildComplianceFillContext, buildBcbaWeekFillContext, buildSupervisableWindows, buildFeasibilityDiagnostics } from './fillSchedule';
import { buildSchedule, defaultBuilderConfig, BuildResult } from './scheduleBuilder';
import { startOfWeek } from 'date-fns';

export type ClaudeModel = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001';

export const DEFAULT_MODEL: ClaudeModel = 'claude-sonnet-4-6';

// ── sAssI conversation ───────────────────────────────────────────────────────
// One message of the multi-turn scheduling chat, kept in TOKEN space (client/tech
// names already scrubbed to CLIENT_n/TECH_n) so PII never rides in the history we
// replay to the API. The UI keeps its own de-anonymized copy for display.
export interface SassiMessage {
  role: 'user' | 'assistant';
  content: string;
}

// One tappable answer in a clarify turn (or a local disambiguation prompt):
// `label` is shown on the chip; `value` is the message sent when it's tapped.
export interface ClarifyOption {
  label: string;
  value: string;
}

// The result of one chat turn: `raw` is the model's token-space reply (stored
// back into history), `reply` is de-anonymized for display, `ops` is the complete
// current proposal (empty on a pure explanation turn). `questions` is present only
// on a clarify turn — render its options as chips instead of staging a proposal.
export interface SassiChatResult {
  raw: string;
  reply: string;
  ops: WishOp[];
  questions?: ClarifyOption[];
  // Present when Claude routed a "build my month" intent to the deterministic
  // builder. The caller runs runBuild() locally and stages the result — Claude
  // never places appointments, so ops stays empty on a build turn.
  build?: boolean;
}

// sAssI answers through exactly one of these two tools every turn (tool_choice
// 'any', parallel disabled), which structurally prevents the old prose-dump:
// `respond` carries the reply plus the COMPLETE proposal as ops; `clarify` asks a
// question with tappable options when a decision is needed before acting. The
// schemas are static so they stay behind the prompt cache.
const RESPOND_TOOL = {
  name: 'respond',
  description: 'Reply to the BCBA and, when proposing schedule changes, return the COMPLETE current set of proposed ops (not a delta). Use ops:[] when only explaining.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reply: { type: 'string', description: 'Short, plain-language message to the BCBA — what changed and why, with a follow-up question when useful.' },
      ops: {
        type: 'array',
        description: 'The COMPLETE proposal every time it changes. Empty when only explaining.',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['add', 'move', 'remove', 'setFixed', 'complete', 'cancel', 'blackout'] },
            apt: { type: 'string', description: 'APT_n token of the target (move/remove/setFixed/complete/cancel).' },
            type: { type: 'string', description: 'add: appointment type (supervision|parent-training|case-planning|client-session|reassessment|other).' },
            client: { type: 'string', description: 'add: CLIENT_n token.' },
            tech: { type: 'string', description: 'add/supervision: TECH_n token of the BT being observed.' },
            start: { type: 'string', description: 'add/move: local ISO start (YYYY-MM-DDTHH:mm:ss), must be ≥ NOW.' },
            end: { type: 'string', description: 'add/move: local ISO end.' },
            isFixed: { type: 'boolean', description: 'setFixed: true locks (non-movable), false unlocks.' },
            source: { type: 'string', enum: ['bt', 'bcba', 'admin', 'family'], description: 'cancel: who initiated it.' },
            reason: { type: 'string', description: 'cancel: reason code (e.g. sick, pto, holiday, weather).' },
            unplanned: { type: 'boolean', description: 'cancel: unplanned (callout/sick) vs planned.' },
          },
          required: ['op'],
        },
      },
    },
    required: ['reply', 'ops'],
  },
};

const CLARIFY_TOOL = {
  name: 'clarify',
  description: 'Ask the BCBA a single question when you need a decision before acting (which client, which time, which session). Offer the likely answers as tappable options.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reply: { type: 'string', description: 'The question to ask the BCBA.' },
      options: { type: 'array', items: { type: 'string' }, description: 'Tappable answers — tapping one sends it back as the BCBA’s reply.' },
    },
    required: ['reply', 'options'],
  },
};

// A whole-caseload build ("build my month", "fill everyone's direct hours") is
// handed to the deterministic engine — NOT placed op-by-op by the model. Choose
// this tool ONLY for that broad intent; use `respond` for targeted edits. The
// engine runs locally, places the recurring direct backbone, and reports which
// cases it couldn't fill; you only frame the outcome in `reply`.
const BUILD_TOOL = {
  name: 'build',
  description: 'Run the deterministic scheduler to build the recurring direct backbone for the whole caseload this month. Use ONLY for broad "build/fill my schedule" requests — never for a single-appointment change (use respond for those). You do not place anything; the engine does and reports blocks.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reply: { type: 'string', description: 'Short framing message to the BCBA — that you are building the recurring direct schedule and will report what couldn’t be filled.' },
    },
    required: ['reply'],
  },
};

export class ClaudeScheduler {
  private client: Anthropic;
  private data: ScheduleData;
  private model: ClaudeModel;
  private anonMap: AnonymizationMap;

  constructor(apiKey: string, data: ScheduleData, model: ClaudeModel = DEFAULT_MODEL) {
    // The native iOS WebView has no server, so solutions are generated by
    // calling Anthropic directly from the client. The key is the user's own and
    // never leaves the device except in this request; the anonymizer guarantees
    // no client/tech names are included in the prompt (see generateSolutions).
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    this.data = data;
    this.model = model;
    // Build anonymization map once per request - tokens stay consistent within a single Claude call.
    this.anonMap = buildAnonymizationMap(data);
  }

  async generateSolutions(
    changedAppointment: Appointment,
    currentConflicts: string[]
  ): Promise<ScheduleSolution[]> {
    const prompt = this.buildPrompt(changedAppointment, currentConflicts);

    // SAFETY ASSERTION: prompt should not contain any client/tech original names.
    // If it does, the anonymizer has a bug — don't send the request.
    if (this.containsRawNames(prompt)) {
      throw new Error('Anonymization check failed: prompt would leak PII. Aborting Claude call.');
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      return [];
    }

    // De-anonymize tokens in the reply before parsing structured fields.
    const deanon = deAnonymizeText(content.text, this.anonMap);
    return this.parseSolutions(deanon, changedAppointment);
  }

  // "Wish It": a goal-driven rework. Returns up to 3 WishSolutions whose ops
  // (move/add/remove/blackout) the caller stages into the draft or applies.
  async generateWishSolutions(wish: WishRequest): Promise<WishSolution[]> {
    const prompt = this.buildWishPrompt(wish);
    if (this.containsRawNames(prompt)) {
      throw new Error('Anonymization check failed: prompt would leak PII. Aborting Claude call.');
    }
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = response.content[0];
    if (!content || content.type !== 'text') return [];
    // Parse tokens out of the JSON via the reverse map (don't string-replace the
    // whole reply — that would corrupt ISO timestamps that contain digits).
    return parseWishSolutions(content.text, token => this.anonMap.reverse.get(token));
  }

  // "Fix It": compliance remediation. Hands the model the under-target cases and
  // techs plus the BCBA's chosen strategies, and asks for up to 3 compliant ways
  // to close the gaps. Output reuses the WishSolution op shape.
  async generateFixSolutions(options: FixItOptions, conflicts: string[]): Promise<WishSolution[]> {
    const prompt = this.buildFixItPrompt(options, conflicts);
    if (this.containsRawNames(prompt)) {
      throw new Error('Anonymization check failed: prompt would leak PII. Aborting Claude call.');
    }
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = response.content[0];
    if (!content || content.type !== 'text') return [];
    return parseWishSolutions(content.text, token => this.anonMap.reverse.get(token));
  }

  // ── sAssI: multi-turn conversational scheduling ────────────────────────────
  // One turn of the back-and-forth "fill my week" assistant. The big, stable
  // context (instructions + anonymized schedule + compliance/availability) lives
  // in a `system` block tagged for ephemeral prompt caching; only the growing
  // message tail is uncached, so follow-up turns in a session pay ~10% cache-read
  // on the prefix instead of re-billing it. History is replayed in token space;
  // the model's reply is de-anonymized before it reaches the UI.
  async chat(history: SassiMessage[]): Promise<SassiChatResult> {
    const system = this.buildSassiSystem();
    if (this.containsRawNames(system)) {
      throw new Error('Anonymization check failed: system prompt would leak PII. Aborting Claude call.');
    }
    // Fail-closed backstop on the free-text path: the caller scrubs each user turn,
    // but if any roster name (or name component) survived scrubbing, abort rather
    // than transmit it. Only the newest user turn (the last message) is checked —
    // earlier user turns were already guarded when new, and assistant turns are the
    // model's own token-space words, where a common English word can legitimately
    // collide with a client's name component (e.g. a client "May" vs. the month).
    const lastMsg = history[history.length - 1];
    if (lastMsg && lastMsg.role === 'user' && containsEntityName(lastMsg.content, this.data)) {
      throw new Error('Anonymization check failed: an outgoing message would leak PII. Aborting Claude call.');
    }
    const lastIdx = history.length - 1;
    const messages = history.map((m, i) =>
      i === lastIdx
        ? { role: m.role, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] }
        : { role: m.role, content: m.content },
    );
    const response = await this.client.messages.create({
      model: this.model,
      // Roomy enough that a full-month proposal's tool JSON isn't truncated
      // (a max_tokens cutoff would leave partial, unparseable tool input).
      max_tokens: 8000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] as any,
      // Force exactly one structured tool call — no free-form prose can leak out.
      // (Tools render before the system block, so the system cache breakpoint
      // already covers them; no separate tool-level breakpoint is needed.)
      tools: [RESPOND_TOOL, CLARIFY_TOOL, BUILD_TOOL] as any,
      tool_choice: { type: 'any', disable_parallel_tool_use: true } as any,
      messages: messages as any,
    });
    const reverse = (token: string) => this.anonMap.reverse.get(token);
    const toolUse = response.content.find((c: any) => c.type === 'tool_use') as any;
    if (toolUse && toolUse.name === 'clarify') {
      const input = toolUse.input || {};
      const opts: any[] = Array.isArray(input.options) ? input.options : [];
      const questions: ClarifyOption[] = opts.map((o) => {
        const label = deAnonymizeText(String(o), this.anonMap);
        return { label, value: label };
      });
      const reply = deAnonymizeText(typeof input.reply === 'string' ? input.reply : '', this.anonMap);
      return { raw: JSON.stringify(input), reply, ops: [], questions };
    }
    if (toolUse && toolUse.name === 'build') {
      const input = toolUse.input || {};
      const reply = deAnonymizeText(typeof input.reply === 'string' ? input.reply : '', this.anonMap);
      // ops stays empty — the caller runs runBuild() locally and stages those ops.
      return { raw: JSON.stringify(input), reply, ops: [], build: true };
    }
    if (toolUse && toolUse.name === 'respond') {
      const turn = parseToolTurn(toolUse.input, reverse);
      return { raw: JSON.stringify(toolUse.input || {}), reply: deAnonymizeText(turn.reply, this.anonMap), ops: turn.ops };
    }
    // Defensive fallback: tool_choice:'any' should always yield a tool call, but if
    // the model somehow returned a text block, parse it the old way rather than blank.
    const textBlock = response.content.find((c: any) => c.type === 'text') as any;
    const raw = textBlock && typeof textBlock.text === 'string' ? textBlock.text : '';
    const turn = parseChatTurn(raw, reverse);
    return { raw, reply: deAnonymizeText(turn.reply, this.anonMap), ops: turn.ops };
  }

  // Scrub a user's typed message to token space before it enters the history —
  // the anonymizer guarantees no client/tech names ride to the API.
  scrub(text: string): string {
    return scrubText(text, this.data, this.anonMap);
  }

  // Map an appointment id to its anonymized APT_n token (null if it isn't in the
  // session's base). Lets the dock inject a deictic "this appointment = APT_n" note
  // for the focused session into the outgoing user turn.
  aptToken(id: string): string | null {
    return this.anonMap.appointments.get(id) ?? null;
  }

  // Resolve short client references ("SB", "Sammy") the user typed to full names
  // locally and report any that match more than one client. Runs BEFORE scrub, so
  // Claude only ever sees tokens — never names.
  resolveEntities(text: string): EntityResolution {
    return resolveClientReferences(text, this.data);
  }

  // Run the deterministic month-builder over this session's schedule. Invoked when
  // the model picks the `build` tool: placement is entirely local and deterministic
  // (buildSchedule on the REAL schedule — never the anonymized one, never Claude),
  // so its ops are staged straight into the draft, and its blocks report locally.
  runBuild(now: Date): BuildResult {
    return buildSchedule(this.data, defaultBuilderConfig(this.data, now), now);
  }

  // Let a live session switch models (Sonnet ⇄ Haiku) without rebuilding the
  // anonymization map, so the token history stays valid across the switch.
  setModel(model: ClaudeModel): void {
    this.model = model;
  }

  // The cached system prefix for the sAssI chat: instructions + guardrails +
  // anonymized schedule + the "fill my week" compliance/availability context.
  buildSassiSystem(): string {
    const now = new Date();
    const period = monthPeriod(now);
    const ctx = buildBcbaWeekFillContext(this.data, period, now);
    const anon = anonymizeSchedule(this.data, this.anonMap);
    const s = this.data.settings;

    const tok = (m: Map<string, string>, id: string, name: string) => m.get(id) || m.get(name) || name;
    const aptTok = (id: string) => this.anonMap.appointments.get(id) || id;

    const inScope = anon.appointments
      .filter((a: any) => {
        const t = new Date(a.startTime).getTime();
        return t >= now.getTime() && t <= period.end.getTime();
      })
      .map((a: any) => ({
        id: a.id, tech: a.technician || undefined, client: a.client || undefined,
        start: a.startTime, end: a.endTime, type: a.type,
        fixed: a.isFixed || undefined,
        recur: a.isRecurring ? (a.recurringPattern || true) : undefined,
      }));

    const clinicianAvail = s.clinicianAvailability
      ? Object.entries(s.clinicianAvailability).map(([d, ws]) => `${d}: ${(ws as any[]).map(w => `${w.start}-${w.end}`).join(', ')}`).join('; ')
      : 'not specified';

    const caseLines = ctx.cases.map(c => {
      const clientTok = tok(this.anonMap.clients, c.clientId, c.clientName);
      return `  ${clientTok}: ${c.supPct}% supervision (${c.supHrs}h / ${c.directHrs}h direct), +${c.gapToIdealHrs}h to ${ctx.idealMinPct}% ideal (soft cap ${c.idealMaxHrs}h)`;
    });
    const windowLines = ctx.directWindows.map(w => {
      const clientTok = tok(this.anonMap.clients, w.clientId, w.clientName);
      const techPart  = w.techName ? ` [${tok(this.anonMap.technicians, w.techId || '', w.techName)}]` : '';
      return `  ${clientTok} ${aptTok(w.appointmentId)} ${w.start.slice(0, 16).replace('T', ' ')}–${w.end.slice(11, 16)}${techPart}`;
    });
    const blockerLines = ctx.blockers.map(b => `  ${tok(this.anonMap.clients, b.clientId, b.clientName)}: ${b.blocker}`);

    return `You are sAssI — a scheduling assistant helping a BCBA fill out and refine their OWN calendar through conversation. All people are opaque tokens (CLIENT_n, TECH_n, APT_n); use exact tokens, never invent names.

NOW: ${now.toISOString()}
PERIOD: ${ctx.periodLabel} (through ${period.end.toISOString().slice(0, 10)})
BCBA availability: ${clinicianAvail}

YOUR JOB — help the BCBA fill and refine their OWN calendar across the period above, COMPLIANCE-FIRST, and carry out the everyday edits they ask for.
- The BCBA already has ~${ctx.bcbaScheduledHrs}h of their own billable work (supervision / parent-training / case-planning / reassessment) scheduled this period. They tell you their weekly-hours target in chat (e.g. "fill my week to 25 hours") — work toward it week over week across the period.
- Every session you add must move a case toward its ideal supervision range (${ctx.idealMinPct}%–${ctx.idealMaxPct}% of direct hours) or otherwise advance compliance. Prioritize the cases most behind.
- This is a back-and-forth. Propose a plan, then adjust it as the BCBA reacts ("I have parent training Tuesday", "move that earlier", "why did you pick that slot?"). Explain your moves plainly so they can fine-tune with you.

HARD RULES — verify every op:
1. Default to ADDING sessions. Move, remove, lock (setFixed), complete, or cancel an existing session only when the BCBA explicitly asks for that edit.
2. Every op's start must be ≥ NOW. Never propose, add, or move a session into the past — the BCBA cannot perform an appointment that already happened.
3. The BCBA runs EVERY supervision/parent-training/case-planning/reassessment item and can be in only one at a time. No two such items (your new ops AND existing schedule rows) may overlap in time.
4. Supervision earns credit only when placed INSIDE an existing direct (client-session) window for the same client — name that BT in the tech field.
5. Parent Training must fall WITHIN an existing direct session's time span for the same client — never a standalone window.
6. Stay within BCBA availability. Respect fixed sessions, blackout days, and time off.
7. "add" ops must NOT include an "id" — the app assigns them.
8. A 15–20% overage above the ideal cap is fine as a cancellation buffer; don't refuse to add sessions just to stay under it — flag overages in your reply.

UNDERSERVED CASES (token: sup%, gap to ideal, soft cap):
${caseLines.length ? caseLines.join('\n') : '  (none — every case is already at or above its ideal supervision range)'}

FUTURE DIRECT SESSIONS — valid windows to place supervision/PT (token apt date start–end [BT]):
${windowLines.length ? windowLines.join('\n') : '  (none remaining this period)'}
${blockerLines.length ? `\nBLOCKERS (why some cases can't be supervised — use these to explain, never dead-end):\n${blockerLines.join('\n')}` : ''}

SCHEDULE IN PERIOD (compact JSON): ${JSON.stringify(inScope)}
CLIENTS: ${JSON.stringify(anon.clients)}
TECHNICIANS: ${JSON.stringify(anon.technicians)}
${anon.blackouts.length ? `BLACKOUT DAYS (each blocks only the named entity): ${JSON.stringify(anon.blackouts)}` : ''}
${anon.timeOff.length ? `BCBA TIME OFF: ${JSON.stringify(anon.timeOff)}` : ''}

HOW TO REPLY — call exactly ONE tool every turn:
- respond({reply, ops}) — reply is a short, plain-language message (what changed and WHY, clinical-but-friendly, with a follow-up when useful). ops is the COMPLETE current proposal, not a delta — the calendar preview is replaced with your ops each turn. Use ops:[] when you're only answering/explaining (e.g. the BCBA asked "why?").
- clarify({reply, options}) — when you need a decision before acting (which client, which time, which session), ask ONE question and offer the likely answers as options.
- build({reply}) — ONLY for a broad "build/fill my whole schedule this month" request. The deterministic engine (not you) then places the recurring direct backbone across the caseload and reports which cases it couldn't fill; you just frame it in reply. Never use build for a single-appointment change — use respond with ops for those.
- op shapes: add {op:"add",type,client:"CLIENT_n",tech:"TECH_n"|null,start,end}; move {op:"move",apt:"APT_n",start,end}; lock {op:"setFixed",apt:"APT_n",isFixed:true|false}; complete {op:"complete",apt:"APT_n"}; cancel {op:"cancel",apt:"APT_n",source:"bt|bcba|admin|family",reason,unplanned:true|false}. "add" ops must NOT include an id.
- If nothing can be added compliantly, DON'T say "no options": explain the specific blocker per case (from BLOCKERS) and suggest what the BCBA could change (add availability, free a slot, relax the cap).
- When the BCBA says "this appointment"/"that one", resolve it to the APT token given in a [context: this appointment = APT_n] note on the latest message.
ISO times are local (no timezone suffix). Verify: every op start ≥ NOW; no two BCBA items overlap; tokens exist in CLIENTS/TECHNICIANS; skip malformed tokens.`;
  }

  buildFixItPrompt(options: FixItOptions, conflicts: string[]): string {
    const now = new Date();
    const horizonWeeks = options.horizonWeeks && options.horizonWeeks > 0 ? options.horizonWeeks : 4;
    const horizonEnd = new Date(now.getTime() + horizonWeeks * 7 * 86400000);
    const period = monthPeriod(now);
    const anon = anonymizeSchedule(this.data, this.anonMap);
    const s = this.data.settings;
    const u = resolveUtilization(s.utilization);

    const excluded = new Set(options.excludedClientIds);
    // Per-case scoping: narrow every section to a single client when set.
    const focusClientId = options.focusClientId;
    const focusClient = focusClientId
      ? this.data.clients.find(c => c.id === focusClientId)
      : undefined;
    const focusTechIds = focusClient
      ? new Set(this.data.technicians
          .filter(t => (t.assignments || []).some(a => a.clientId === focusClient.id || a.clientId === focusClient.name))
          .map(t => t.id))
      : null;
    const focusTok = focusClient
      ? (this.anonMap.clients.get(focusClient.id) || this.anonMap.clients.get(focusClient.name) || 'CLIENT_?')
      : undefined;

    const clientGaps = computeClientCompliance(this.data, period)
      .filter(r => !excluded.has(r.client.id))
      .filter(r => !focusClientId || r.client.id === focusClientId)
      .filter(r => r.projected.hoursToGo > 0 || r.actual.hoursToGo > 0)
      .sort((a, b) => b.projected.hoursToGo - a.projected.hoursToGo) // most behind first
      .map(r => {
        const token = this.anonMap.clients.get(r.client.id) || this.anonMap.clients.get(r.client.name) || 'CLIENT_?';
        const pct = r.projected.directHours > 0
          ? (r.projected.supervisionHours / r.projected.directHours * 100).toFixed(0)
          : '0';
        return `${token}: direct ${r.actual.directHours.toFixed(1)}h, supervision ${r.actual.supervisionHours.toFixed(1)}h (${pct}%), needs ~${r.projected.hoursToGo.toFixed(1)}h more to reach target`;
      });

    const techGaps = computeTechCompliance(this.data, period)
      .filter(r => !focusTechIds || focusTechIds.has(r.tech.id))
      .filter(r => r.projected.companyHoursToGo > 0 || (r.projected.bacbHoursToGo ?? 0) > 0)
      .map(r => {
        const token = this.anonMap.technicians.get(r.tech.id) || this.anonMap.technicians.get(r.tech.name) || 'TECH_?';
        const bacb = r.projected.bacbHoursToGo ? `, BACB to-go ${r.projected.bacbHoursToGo.toFixed(1)}h` : '';
        return `${token}: direct ${r.actual.directHours.toFixed(1)}h, supv ${r.actual.supervisionHours.toFixed(1)}h, company to-go ${r.projected.companyHoursToGo.toFixed(1)}h${bacb}`;
      });

    // Compact appointment payload: only fields the model needs.
    const inScope = anon.appointments
      .filter((a: any) => {
        const t = new Date(a.startTime).getTime();
        return t >= now.getTime() && t <= horizonEnd.getTime();
      })
      .map((a: any) => ({
        id: a.id, tech: a.technician, client: a.client,
        start: a.startTime, end: a.endTime, type: a.type,
        fixed: a.isFixed || undefined,
        recur: a.isRecurring ? (a.recurringPattern || true) : undefined,
      }));

    // Precomputed supervisable windows: direct sessions where the BCBA is
    // available and not already double-booked. Giving the model these concrete
    // slots is much more reliable than asking it to derive them from raw JSON.
    const supWindows = buildSupervisableWindows(this.data, now, horizonEnd)
      .filter(w => !focusClientId || w.clientId === focusClientId);
    const tok = (m: Map<string, string>, id: string, name: string) => m.get(id) || m.get(name) || name;
    const aptTok = (id: string) => this.anonMap.appointments.get(id) || id;
    const supWindowLines = supWindows.map(w => {
      const ct = tok(this.anonMap.clients, w.clientId, w.clientName);
      const tt = w.techName ? ` [BT:${tok(this.anonMap.technicians, w.techId || '', w.techName)}]` : '';
      return `${ct} ${aptTok(w.appointmentId)} ${w.date} ${w.sessionStart.slice(11, 16)}–${w.sessionEnd.slice(11, 16)}${tt}`;
    });

    // Feasibility diagnostics: per-client explanation of why BCBA can't supervise
    // (only include clients with gaps that have no free windows)
    const diagnostics = buildFeasibilityDiagnostics(this.data, now, horizonEnd);
    const blockedDiagLines = diagnostics
      .filter(d => !focusClientId || d.clientId === focusClientId)
      .filter(d => d.blocker !== null && d.futureDirects > 0)
      .map(d => {
        const ct = tok(this.anonMap.clients, d.clientId, d.clientName);
        return `${ct}: ${d.blocker}`;
      });

    const strategies = allowedStrategies(options);
    const scrubbedConflicts = conflicts.map(c => scrubText(c, this.data, this.anonMap));
    const scrubbedGuidance = options.guidance && options.guidance.trim()
      ? scrubText(options.guidance.trim(), this.data, this.anonMap)
      : '';
    const billableMin = u.bcbaWeeklyBillableMin ?? u.bcbaWeeklyBillableHours;

    const priorityLines = [
      options.prioritizeBtSupervision ? 'PRIORITY: Prefer adding BT supervision (named-BT direct + supervision overlap).' : '',
      options.prioritizeParentTraining ? 'PRIORITY: Prefer adding parent-training sessions.' : '',
    ].filter(Boolean);

    return `You are an ABA compliance assistant. Fix supervision gaps for the BCBA. All people are opaque tokens — use exact tokens, never invent names.

NOW: ${now.toISOString()}
HORIZON: ${horizonEnd.toISOString().slice(0, 10)}
${focusTok ? `FOCUS: Address ONLY case ${focusTok}. Ignore every other case; propose sessions for this case only.\n` : ''}
FITNESS FUNCTION: Maximize (1) cases reaching the target supervision %, (2) techs hitting BACB 5% + company target, (3) BCBA billable ≈ ${billableMin ?? 'goal'}h/week. A 15-20% overage is acceptable as a cancellation buffer — DO NOT refuse to add sessions solely because they push billable slightly over the weekly goal.

GAPS TO CLOSE (sorted most behind first):
Case supervision (target ${s.supervisionDirectHoursPercent}% of direct hours):
${clientGaps.length ? clientGaps.map(g => `  ${g}`).join('\n') : '  (none — all cases at target)'}
Tech supervision (company ${s.supervisionRBTHoursPercent}%; RBTs also need BACB ≥5%):
${techGaps.length ? techGaps.map(g => `  ${g}`).join('\n') : '  (none)'}
${scrubbedConflicts.length ? `\nEXISTING WARNINGS:\n${scrubbedConflicts.map(c => `  ${c}`).join('\n')}` : ''}

SUPERVISABLE WINDOWS — direct sessions where BCBA is available and not yet booked (add supervision here):
${supWindowLines.length ? supWindowLines.join('\n') : '  (none in horizon — see BLOCKERS below)'}
${blockedDiagLines.length ? `\nBLOCKERS (why BCBA cannot supervise these clients):\n${blockedDiagLines.map(l => `  ${l}`).join('\n')}` : ''}

ALLOWED STRATEGIES: ${strategies.length ? strategies.join(', ') : '(none selected — return one solution with empty ops explaining why)'}
${priorityLines.length ? '\n' + priorityLines.join('\n') : ''}
${scrubbedGuidance ? `\nBCBA GUIDANCE (honor within the HARD RULES; if it conflicts with a hard rule, follow the rule and say so in reasoning): ${scrubbedGuidance}` : ''}

HARD RULES — verify every op against ALL before outputting:
1. Never touch any appointment whose start < NOW.
2. Never double-book a person. The BCBA is the implicit actor on EVERY supervision/parent-training/case-planning/reassessment item — new or already in SCHEDULE. No two such items may overlap in time. Diff new ops against (a) other ops in this solution and (b) every existing supervision/PT/case-planning/reassessment row.
3. BCBA BILLABLE (soft target): Aim for ~${billableMin ?? 'goal'}h/week. Solutions MAY exceed this when needed to meet compliance — flag the overage in reasoning so the BCBA can decide what to trim. Do not voluntarily go below target without a clinical reason.
4. MAXIMIZE compliance gaps aggressively. Add as many compliant sessions as needed across the horizon — the BCBA will manually trim overages. Prefer the SUPERVISABLE WINDOWS above; only look outside them if needed.
5. "add" ops must NOT include an "id" field — the app assigns IDs.
6. "add" recurring: output only the first occurrence; the app expands the series.
7. Each of the 3 solutions must be genuinely distinct (different clients prioritized, different weeks, different session types, or different slot distributions).

SCHEDULE IN HORIZON (compact JSON):
${JSON.stringify(inScope)}

CLIENTS: ${JSON.stringify(anon.clients)}
TECHNICIANS: ${JSON.stringify(anon.technicians)}
${anon.blackouts.length ? `BLACKOUT DAYS (each entry blocks only the named entity): ${JSON.stringify(anon.blackouts)}` : ''}
${anon.timeOff.length ? `BCBA TIME OFF: ${JSON.stringify(anon.timeOff)}` : ''}

VALIDATION (do mentally before answering): For every op verify — (a) start ≥ NOW; (b) no double-book; (b2) no two BCBA items overlap; (c) tokens exist in CLIENTS/TECHNICIANS; (d) apt tokens exist in SCHEDULE; (e) entity not in BLACKOUT; (f) BCBA not in TIME OFF; (g) ignore malformed tokens like "CLIENT_nIENT_m".

OUTPUT: Strict JSON only — no prose, no markdown. Schema:
{"solutions":[{"summary":"short title","reasoning":"1-2 sentences","ops":[
  {"op":"add","title":"...","type":"supervision|parent-training|case-planning|client-session","client":"CLIENT_n or null","tech":"TECH_n or null","start":"YYYY-MM-DDTHH:mm:ss","end":"YYYY-MM-DDTHH:mm:ss","recurring":false,"pattern":null},
  {"op":"move","apt":"APT_n","start":"YYYY-MM-DDTHH:mm:ss","end":"YYYY-MM-DDTHH:mm:ss"},
  {"op":"remove","apt":"APT_n"}
]}]}
ISO times are local (no timezone suffix).

NO-SOLUTION RULE: If no compliant option exists within ALLOWED STRATEGIES, return EXACTLY ONE solution with empty ops [] and a detailed "reasoning" that for EACH case in GAPS TO CLOSE specifies: (1) does it have supervisable windows? (2) is the BCBA available during those windows? (3) would a new supervision session create a double-book? (4) is the case already at or above target? Format as "CLIENT_n: [specific reason]" per case so the BCBA knows exactly what to fix.`;
  }

  buildWishPrompt(wish: WishRequest): string {
    const now = new Date();
    // fillSchedule scopes to the compliance month; all other wishes use horizonWeeks.
    const period = monthPeriod(now);
    const horizonEnd = wish.kind === 'fillSchedule'
      ? period.end
      : new Date(now.getTime() + (wish.horizonWeeks && wish.horizonWeeks > 0 ? wish.horizonWeeks : 8) * 7 * 86400000);
    const anon = anonymizeSchedule(this.data, this.anonMap);
    const s = this.data.settings;

    // Compact payload: only fields the model needs, same as Fix It.
    const inScope = anon.appointments
      .filter((a: any) => {
        const t = new Date(a.startTime).getTime();
        return t >= now.getTime() && t <= horizonEnd.getTime();
      })
      .map((a: any) => ({
        id: a.id, tech: a.technician || undefined, client: a.client || undefined,
        start: a.startTime, end: a.endTime, type: a.type,
        fixed: a.isFixed || undefined,
        recur: a.isRecurring ? (a.recurringPattern || true) : undefined,
      }));

    const clinicianAvail = s.clinicianAvailability
      ? Object.entries(s.clinicianAvailability).map(([d, ws]) => `${d}: ${(ws as any[]).map(w => `${w.start}-${w.end}`).join(', ')}`).join('; ')
      : 'not specified';

    // Inject local solver context depending on the wish kind.
    let fillBlock = '';

    if (wish.kind === 'maximizeDirectHours') {
      // Maximize BT direct-service utilization: compute per-case gaps + feasible
      // windows for this week, then let the model assemble 3 variants.
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      const ctx = buildFillContext(this.data, weekStart);
      const tok = (m: Map<string, string>, id: string, name: string) => m.get(id) || m.get(name) || name;
      const cases = ctx.underserved.map(u =>
        `${tok(this.anonMap.clients, u.clientId, u.clientName)}: target ${u.targetDirectHrs}h, scheduled ${u.scheduledDirectHrs}h, gap ${u.gapHrs}h`);
      const windows = ctx.windows.map(w =>
        `${tok(this.anonMap.clients, w.clientId, w.clientName)} ${w.date}(${w.day.slice(0, 3)}) ${w.start}-${w.end} [${w.techs.map(t => tok(this.anonMap.technicians, t.id, t.name)).join(',')}]`);
      fillBlock = `

MAXIMIZE DIRECT HOURS — fill each underserved case toward 100% of its weekly direct target for the week of ${ctx.weekStart} by ADDING client-session (direct) ops inside the OPEN WINDOWS below, assigning one of the eligible techs listed for that window.
- Do NOT move or remove anything on the BCBA's own schedule (supervision / parent-training / case-planning / reassessment). You MAY ADD supervision when it helps a case meet its supervision %. You MAY ADD parent-training ONLY within the time span of an already-scheduled or newly-added session — never as a standalone window.
- Stay strictly inside each open window; only assign a tech listed as eligible for that window; never double-book a tech or client.
UNDERSERVED CASES (token: target, scheduled, gap): ${cases.join(' | ') || 'none'}
OPEN DIRECT WINDOWS (token date(day) start-end [eligible techs]): ${windows.join(' | ') || 'none'}
The 3 solutions should differ in how they trade techs/slots while maximizing total filled direct hours.`;

    } else if (wish.kind === 'fillSchedule') {
      // BCBA fills own calendar with supervision + PT within existing direct
      // sessions to bring cases toward ideal compliance range for the month.
      const ctx = buildComplianceFillContext(this.data, period, now);
      const tok = (m: Map<string, string>, id: string, name: string) => m.get(id) || m.get(name) || name;
      const aptTok = (id: string) => this.anonMap.appointments.get(id) || id;

      if (ctx.cases.length === 0) {
        fillBlock = `\nFILL MY SCHEDULE OUT — all cases are already at or above the ideal supervision range (${ctx.idealMinPct}%–${ctx.idealMaxPct}%) for ${ctx.periodLabel}. No supervision gaps to fill this month.`;
      } else {
        const caseLines = ctx.cases.map(c => {
          const clientTok = tok(this.anonMap.clients, c.clientId, c.clientName);
          return `${clientTok}: ${c.supPct}% supervision (${c.supHrs}h / ${c.directHrs}h direct), need +${c.gapToIdealHrs}h → ${ctx.idealMinPct}% ideal (cap ${c.idealMaxHrs}h = ${ctx.idealMaxPct}%)`;
        });
        const windowLines = ctx.directWindows.map(w => {
          const clientTok = tok(this.anonMap.clients, w.clientId, w.clientName);
          const techPart  = w.techName ? ` [${tok(this.anonMap.technicians, w.techId || '', w.techName)}]` : '';
          return `${clientTok} ${aptTok(w.appointmentId)} ${w.start.slice(0, 16).replace('T', ' ')}–${w.end.slice(11, 16)}${techPart}`;
        });

        fillBlock = `

FILL MY SCHEDULE OUT — add supervision and parent-training to bring each case toward the ideal supervision range (${ctx.idealMinPct}%–${ctx.idealMaxPct}% of direct hours) for ${ctx.periodLabel}.

FITNESS FUNCTION: Maximize cases reaching the ideal range. A 15-20% buffer above the ideal max (e.g. up to ~${(ctx.idealMaxPct * 1.18).toFixed(0)}%) is acceptable as a cancellation buffer — solutions that slightly exceed the ideal cap are preferred over leaving gaps. The BCBA will manually trim overages if needed.

RULES FOR THIS WISH:
- Only ADD new sessions. Do NOT move or remove any existing session.
- Supervision: place within an existing direct session's time window for the same client, naming that BT in the tech field — overlap is required for compliance credit.
- Parent Training: must fall within the time span of an existing direct session for the same client. Never add PT as a standalone window outside a direct session — it earns no credit and violates clinical rules.
- Aim for the ideal cap per case but do NOT refuse to add sessions just because the cap would be slightly exceeded. Soft cap — flag overages in reasoning.
- Never double-book the BCBA against existing supervision/PT/case-planning/reassessment in the schedule.
- Stay within BCBA availability.

UNDERSERVED CASES (token: sup%, gap to ideal, soft cap):
${caseLines.join('\n')}

FUTURE DIRECT SESSIONS — valid windows for supervision or PT (token: apt date start–end [BT]):
${windowLines.length ? windowLines.join('\n') : '(none remaining this month — gaps can only be addressed in future months)'}

The 3 solutions should differ in which sessions they prioritize and how they balance supervision vs parent-training.

NO-SOLUTION RULE: If no sessions can be placed (e.g. all windows are BCBA-blocked), return one solution with empty ops [] and detailed reasoning per case: which clients have windows, which are blocked, and WHY (BCBA conflict, outside availability, no future sessions).`;
      }
    }

    return `You are an ABA scheduler helping a BCBA reshape their schedule toward a goal. All people are opaque tokens — use exact tokens, never invent names.

NOW: ${now.toISOString()}
HORIZON: ${horizonEnd.toISOString().slice(0, 10)}

THE WISH:
${wish.kind === 'freeform'
  ? scrubText(summarizeWish(wish), this.data, this.anonMap)
  : summarizeWish(wish)}
${wish.kind !== 'freeform' && wish.note ? `Extra detail: ${scrubText(wish.note, this.data, this.anonMap)}` : ''}

HARD RULES:
1. Never touch any appointment whose start < NOW.
2. Items marked fixed cannot be moved. Respect technician and client availability windows.
3. Keep BCBA weekly billable ≥ required; supervision ${s.supervisionDirectHoursPercent}% of direct + ${s.supervisionRBTHoursPercent}% of RBT hours; parent training ≥ ${s.parentTraining.minimumHours}h per ${s.parentTraining.periodUnit}.
4. Prefer minimal change: move as few sessions as possible, keep recurring slots stable.
5. Never double-book a person. The BCBA is not listed in CLIENTS/TECHNICIANS but is the implicit actor on EVERY supervision/parent-training/case-planning/reassessment item — new or already in SCHEDULE IN HORIZON. Two such items (any client/tech combination) must never overlap in time. Diff every new add/move against (a) the other ops in the same solution and (b) every existing supervision/parent-training/case-planning/reassessment row in the schedule.
6. "add" ops must NOT include an "id" field — the app assigns IDs.
7. Each of the ≤3 solutions must be genuinely distinct.
${wish.shaveDown ? `8. SHAVE DOWN: where a case or RBT is OVER-served, you may shorten supervision toward the binding minimum — LARGEST of preferred-min ${s.supervisionPreferredMinPercent ?? 15}%, floor ${s.supervisionFloorPercent ?? 10}%, and BACB 5%. Never trim below that minimum.` : ''}

BCBA availability: ${clinicianAvail}
${fillBlock}
SCHEDULE IN HORIZON (compact JSON):
${JSON.stringify(inScope)}

CLIENTS: ${JSON.stringify(anon.clients)}
TECHNICIANS: ${JSON.stringify(anon.technicians)}
${anon.blackouts.length ? `BLACKOUT DAYS (each entry blocks only the named entity): ${JSON.stringify(anon.blackouts)}` : ''}
${anon.timeOff.length ? `BCBA TIME OFF: ${JSON.stringify(anon.timeOff)}` : ''}

VALIDATION (do mentally before answering): For every op verify — (a) start ≥ NOW; (b) no double-book of any tech or client; (b2) no two supervision/parent-training/case-planning/reassessment items (new ops AND existing schedule rows) overlap in time — the BCBA runs all of them and can only be in one at a time; (c) client/tech tokens exist in CLIENTS/TECHNICIANS; (d) apt tokens for move/remove exist in SCHEDULE; (e) proposed date+entity not in BLACKOUT DAYS; (f) BCBA not scheduled on TIME OFF; (g) skip any malformed token like "CLIENT_nIENT_m" — those are corrupted.

OUTPUT: Strict JSON only — no prose, no markdown. Exact schema (include only listed keys per op type):
{"solutions":[{"summary":"short title","reasoning":"1-2 sentences","ops":[
  {"op":"move","apt":"APT_n","start":"YYYY-MM-DDTHH:mm:ss","end":"YYYY-MM-DDTHH:mm:ss"},
  {"op":"remove","apt":"APT_n"},
  {"op":"add","title":"...","type":"supervision|parent-training|case-planning|client-session|reassessment|other","client":"CLIENT_n or null","tech":"TECH_n or null","start":"YYYY-MM-DDTHH:mm:ss","end":"YYYY-MM-DDTHH:mm:ss","recurring":false,"pattern":null},
  {"op":"blackout","entityType":"client|technician","entity":"CLIENT_n|TECH_n","date":"YYYY-MM-DD","reason":"..."}
]}]}
ISO times are local (no timezone suffix). If the wish can't be met compliantly, return one solution with empty ops and reasoning explaining why.`;
  }

  private buildPrompt(appointment: Appointment, conflicts: string[]): string {
    const anonAppt = anonymizeAppointment(appointment, this.anonMap);
    const endOfMonth = this.getEndOfMonth(appointment.startTime);
    const nowIso = new Date().toISOString();

    // Scrub conflicts: replace any names that snuck into messages.
    const scrubbedConflicts = conflicts.map(c => scrubText(c, this.data, this.anonMap));

    return `
You are a scheduling expert for an ABA (Applied Behavior Analysis) clinic. Resolve a scheduling conflict while maintaining regulatory compliance.

All people are referenced by opaque tokens (CLIENT_n, TECH_n, APT_n). Use these tokens in your response. Do NOT invent names.

CURRENT DATETIME: ${nowIso}

CONSTRAINTS:
- Compliance is fixed going forward only. NEVER change, complete, or reschedule an appointment that starts before the current datetime. Only adjust appointments at or after now.
- Never move a technician off another client's session to staff a different client, and never assume a technician is free during a block where they are already booked. If a requirement cannot be met within genuinely open availability, do NOT propose moving an existing session; instead state that it needs a manual entry.
- Supervision requirement: ${this.data.settings.supervisionDirectHoursPercent}% of direct hours + ${this.data.settings.supervisionRBTHoursPercent}% of RBT hours
- Parent training requirement: minimum ${this.data.settings.parentTraining.minimumHours} hours per ${this.data.settings.parentTraining.periodUnit} (target ${this.data.settings.parentTraining.targetMinHours}-${this.data.settings.parentTraining.targetMaxHours})
- Items marked "Fixed" cannot be moved
- Technician availability must be respected
- Client availability must be respected

CHANGED APPOINTMENT:
- ID: ${anonAppt.id}
- Technician: ${anonAppt.technician || 'none'}
- Client: ${anonAppt.client || 'none'}
- Time: ${anonAppt.startTime} to ${anonAppt.endTime}
- Type: ${anonAppt.type}
- Fixed: ${anonAppt.isFixed}
- Billable: ${anonAppt.isBillable}

CURRENT CONFLICTS:
${scrubbedConflicts.map(c => `- ${c}`).join('\n')}

DEADLINE: Solutions should ideally fit within the current week, but may extend to the end of the calendar month (${endOfMonth}) if necessary.

TASK: Generate 2-3 alternative scheduling solutions that resolve these conflicts. For each:
1. List which APT_<n> appointments to move and their new times (ISO 8601)
2. Explain why this solution works
3. Specify how many weeks it spans
4. Note if it's a single-week solution

Format each solution exactly as:
SOLUTION X:
Week span: <number> week(s)
Changes needed:
- APT_<n>: move from <ISO start> to <ISO end> -> <ISO start> to <ISO end>
Reasoning: <one paragraph>
Single-week: <yes|no>
    `;
  }

  private containsRawNames(prompt: string): boolean {
    // Whole-word match only — a plain substring check false-positives whenever
    // a client/tech name (ABA practices commonly use 2-letter initials, e.g.
    // "CL", "EC") happens to sit inside one of our own CLIENT_n/TECH_n tokens
    // ("CL"IENT_1, T"EC"H_1), aborting every call even though nothing leaked.
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const c of this.data.clients) {
      if (c.name && c.name.length > 1 && new RegExp(`\\b${escape(c.name)}\\b`, 'i').test(prompt)) return true;
    }
    for (const t of this.data.technicians) {
      if (t.name && t.name.length > 1 && new RegExp(`\\b${escape(t.name)}\\b`, 'i').test(prompt)) return true;
    }
    return false;
  }

  private parseSolutions(text: string, changedAppointment: Appointment): ScheduleSolution[] {
    const solutions: ScheduleSolution[] = [];
    const solutionBlocks = text.split(/SOLUTION \d+:/);

    solutionBlocks.forEach((block, index) => {
      if (index === 0) return;

      const lines = block.trim().split('\n');
      const solution: ScheduleSolution = {
        id: uuidv4(),
        description: `Proposed Solution ${index}`,
        affectedWeeks: 1,
        weekSpan: { startDate: changedAppointment.startTime, endDate: changedAppointment.endTime },
        changes: [],
        reasoning: '',
        violatesConstraints: false,
      };

      let currentSection = '';
      lines.forEach(line => {
        const trimmed = line.trim();

        if (trimmed.startsWith('Week span:')) {
          const match = trimmed.match(/\d+/);
          solution.affectedWeeks = match ? parseInt(match[0]) : 1;
        } else if (trimmed.startsWith('Changes needed:')) {
          currentSection = 'changes';
        } else if (trimmed.startsWith('Reasoning:')) {
          solution.reasoning = trimmed.replace('Reasoning:', '').trim() || '';
          currentSection = 'reasoning';
        } else if (trimmed.startsWith('Single-week:')) {
          currentSection = '';
        } else if (currentSection === 'changes' && trimmed.startsWith('- ')) {
          // Try parse: "- APT_n: move from <s> to <e> -> <s> to <e>"
          const m = trimmed.match(/- (\S+): move from (\S+) to (\S+)\s*->?\s*(\S+) to (\S+)/);
          if (m && m[1] && m[2] && m[3] && m[4] && m[5]) {
            // De-anonymize APT_n back to real ID via reverse map
            const aptToken = m[1];
            const realId = this.anonMap.reverse.get(aptToken) || aptToken;
            solution.changes.push({
              appointmentId: realId,
              oldTime: { start: m[2], end: m[3] },
              newTime: { start: m[4], end: m[5] },
            });
          }
        } else if (currentSection === 'reasoning' && trimmed) {
          solution.reasoning = (solution.reasoning || '') + ' ' + trimmed;
        }
      });

      if (solution.changes.length > 0 && solution.reasoning) {
        solutions.push(solution);
      }
    });

    return solutions.slice(0, 3);
  }

  private getEndOfMonth(isoDate: string): string {
    const date = new Date(isoDate);
    const year = date.getFullYear();
    const month = date.getMonth();
    const lastDay = new Date(year, month + 1, 0);
    return lastDay.toISOString().split('T')[0] || '';
  }
}
