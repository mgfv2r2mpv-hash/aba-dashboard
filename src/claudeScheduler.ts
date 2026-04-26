import Anthropic from '@anthropic-ai/sdk';
import { ScheduleData, ScheduleSolution, Appointment } from './types';
import { v4 as uuidv4 } from 'uuid';

export class ClaudeScheduler {
  private client: Anthropic;
  private data: ScheduleData;

  constructor(apiKey: string, data: ScheduleData) {
    this.client = new Anthropic({ apiKey });
    this.data = data;
  }

  async generateSolutions(
    changedAppointment: Appointment,
    currentConflicts: string[]
  ): Promise<ScheduleSolution[]> {
    const prompt = this.buildPrompt(changedAppointment, currentConflicts);

    const response = await this.client.messages.create({
      model: 'claude-opus-4-7',
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

    return this.parseSolutions(content.text, changedAppointment);
  }

  private buildPrompt(appointment: Appointment, conflicts: string[]): string {
    const technicianName = this.getTechnicianName(appointment.technician);
    const clientName = this.getClientName(appointment.client);
    const endOfMonth = this.getEndOfMonth(appointment.startTime);

    return `
You are a scheduling expert for an ABA (Applied Behavior Analysis) clinic. You need to resolve a scheduling conflict while maintaining regulatory compliance.

CONSTRAINTS:
- Supervision requirement: ${this.data.settings.supervisionDirectHoursPercent}% of direct hours + ${this.data.settings.supervisionRBTHoursPercent}% of RBT hours
- Parent training requirement: minimum ${this.data.settings.parentTrainingHoursPerMonth.minimum} hours/month (target ${this.data.settings.parentTrainingHoursPerMonth.target.min}-${this.data.settings.parentTrainingHoursPerMonth.target.max})
- Items marked "Fixed" cannot be moved
- Technician availability must be respected
- Client availability must be respected

CHANGED APPOINTMENT:
- Title: ${appointment.title}
- Technician: ${technicianName}
- Client: ${clientName}
- New Time: ${appointment.startTime} to ${appointment.endTime}
- Type: ${appointment.type}

CURRENT CONFLICTS:
${conflicts.map(c => `- ${c}`).join('\n')}

DEADLINE: Solutions should ideally fit within the current week, but may extend to the end of the calendar month (${endOfMonth}) if necessary.

TASK: Generate 2-3 alternative scheduling solutions that resolve these conflicts. For each solution:
1. List which appointments need to be moved and their new times
2. Explain why this solution works
3. Specify how many weeks it spans
4. Note if it's a single-week solution or extends to end of month

Format each solution as:
SOLUTION X:
Week span: [weeks affected]
Changes needed:
- [appointment title/ID]: move from [old time] to [new time]
Reasoning: [explain how this maintains all constraints]
Single-week: [yes/no]
    `;
  }

  private parseSolutions(text: string, changedAppointment: Appointment): ScheduleSolution[] {
    const solutions: ScheduleSolution[] = [];
    const solutionBlocks = text.split(/SOLUTION \d+:/);

    solutionBlocks.forEach((block, index) => {
      if (index === 0) return; // Skip the initial text before first solution

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
          const changeMatch = trimmed.match(/- (.+): move from (.+) to (.+)/);
          if (changeMatch && changeMatch[1] && changeMatch[2] && changeMatch[3]) {
            const oldParts = changeMatch[2].split(' to ');
            const newParts = changeMatch[3].split(' to ');
            if (oldParts.length === 2 && newParts.length === 2) {
              solution.changes.push({
                appointmentId: changeMatch[1],
                oldTime: { start: oldParts[0] || '', end: oldParts[1] || '' },
                newTime: { start: newParts[0] || '', end: newParts[1] || '' },
              });
            }
          }
        } else if (currentSection === 'reasoning' && trimmed) {
          solution.reasoning = (solution.reasoning || '') + ' ' + trimmed;
        }
      });

      if (solution.changes.length > 0 && solution.reasoning) {
        solutions.push(solution);
      }
    });

    return solutions.slice(0, 3); // Return max 3 solutions
  }

  private getTechnicianName(id?: string): string {
    if (!id) return 'Unknown';
    const tech = this.data.technicians.find(t => t.id === id || t.name === id);
    return tech?.name || id;
  }

  private getClientName(id?: string): string {
    if (!id) return 'Unknown';
    const client = this.data.clients.find(c => c.id === id || c.name === id);
    return client?.name || id;
  }

  private getEndOfMonth(isoDate: string): string {
    const date = new Date(isoDate);
    const year = date.getFullYear();
    const month = date.getMonth();
    const lastDay = new Date(year, month + 1, 0);
    return lastDay.toISOString().split('T')[0];
  }
}
