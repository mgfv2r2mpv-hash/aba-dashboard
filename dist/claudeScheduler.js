import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { buildAnonymizationMap, anonymizeAppointment, scrubText, deAnonymizeText, } from './anonymizer';
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
export class ClaudeScheduler {
    constructor(apiKey, data, model = DEFAULT_MODEL) {
        this.client = new Anthropic({ apiKey });
        this.data = data;
        this.model = model;
        // Build anonymization map once per request - tokens stay consistent within a single Claude call.
        this.anonMap = buildAnonymizationMap(data);
    }
    async generateSolutions(changedAppointment, currentConflicts) {
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
    buildPrompt(appointment, conflicts) {
        const anonAppt = anonymizeAppointment(appointment, this.anonMap);
        const endOfMonth = this.getEndOfMonth(appointment.startTime);
        // Scrub conflicts: replace any names that snuck into messages.
        const scrubbedConflicts = conflicts.map(c => scrubText(c, this.data, this.anonMap));
        return `
You are a scheduling expert for an ABA (Applied Behavior Analysis) clinic. Resolve a scheduling conflict while maintaining regulatory compliance.

All people are referenced by opaque tokens (CLIENT_n, TECH_n, APT_n). Use these tokens in your response — do NOT invent names.

CONSTRAINTS:
- Supervision requirement: ${this.data.settings.supervisionDirectHoursPercent}% of direct hours + ${this.data.settings.supervisionRBTHoursPercent}% of RBT hours
- Parent training requirement: minimum ${this.data.settings.parentTrainingHoursPerMonth.minimum} hours/month (target ${this.data.settings.parentTrainingHoursPerMonth.target.min}-${this.data.settings.parentTrainingHoursPerMonth.target.max})
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
    containsRawNames(prompt) {
        for (const c of this.data.clients) {
            if (c.name && c.name.length > 1 && prompt.includes(c.name))
                return true;
        }
        for (const t of this.data.technicians) {
            if (t.name && t.name.length > 1 && prompt.includes(t.name))
                return true;
        }
        return false;
    }
    parseSolutions(text, changedAppointment) {
        const solutions = [];
        const solutionBlocks = text.split(/SOLUTION \d+:/);
        solutionBlocks.forEach((block, index) => {
            if (index === 0)
                return;
            const lines = block.trim().split('\n');
            const solution = {
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
                }
                else if (trimmed.startsWith('Changes needed:')) {
                    currentSection = 'changes';
                }
                else if (trimmed.startsWith('Reasoning:')) {
                    solution.reasoning = trimmed.replace('Reasoning:', '').trim() || '';
                    currentSection = 'reasoning';
                }
                else if (trimmed.startsWith('Single-week:')) {
                    currentSection = '';
                }
                else if (currentSection === 'changes' && trimmed.startsWith('- ')) {
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
                }
                else if (currentSection === 'reasoning' && trimmed) {
                    solution.reasoning = (solution.reasoning || '') + ' ' + trimmed;
                }
            });
            if (solution.changes.length > 0 && solution.reasoning) {
                solutions.push(solution);
            }
        });
        return solutions.slice(0, 3);
    }
    getEndOfMonth(isoDate) {
        const date = new Date(isoDate);
        const year = date.getFullYear();
        const month = date.getMonth();
        const lastDay = new Date(year, month + 1, 0);
        return lastDay.toISOString().split('T')[0] || '';
    }
}
//# sourceMappingURL=claudeScheduler.js.map