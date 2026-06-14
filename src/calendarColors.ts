// Stable, MAXIMALLY-DISTINCT per-entity colors for the calendar tiles. A tile's
// background is a pastel keyed to the CLIENT; bold diagonal candy-stripes are
// keyed to the BT/staff.
//
// Colors are assigned by first-seen order through the golden-angle hue sequence
// (~137.5° apart), so consecutive entities are spread as far around the hue wheel
// as possible — no two clients (or two staff) get a confusingly-similar color the
// way a small fixed palette + hashing did (11 clients, 10 swatches → guaranteed
// collisions). Clients render light (high lightness) and staff render dark/striped,
// so the two systems also never read as the same color.

const GOLDEN_ANGLE = 137.508;
const clientIndex = new Map<string, number>();
const staffIndex = new Map<string, number>();

function indexOf(reg: Map<string, number>, name: string): number {
  let i = reg.get(name);
  if (i === undefined) { i = reg.size; reg.set(name, i); }
  return i;
}
function clientHue(name: string): number { return Math.round((indexOf(clientIndex, name) * GOLDEN_ANGLE) % 360); }
function staffHue(name: string): number { return Math.round((indexOf(staffIndex, name) * GOLDEN_ANGLE) % 360); }

export function clientPastel(name?: string): string {
  if (!name) return '#e5e7eb';
  return `hsl(${clientHue(name)} 72% 88%)`;
}

// Slightly darker shade of the client pastel — used as a completed-tile border.
export function clientDarkBorder(name?: string): string {
  if (!name) return '#9ca3af';
  return `hsl(${clientHue(name)} 55% 62%)`;
}

export function staffBold(name?: string): string {
  if (!name) return '#6b7280';
  return `hsl(${staffHue(name)} 62% 42%)`;
}

// CSS for a tile: client pastel base, with translucent bold diagonal stripes for
// the staff member overlaid when a technician is assigned (supervision / BCBA-lens
// items carry no technician and so render as the plain client pastel).
export function tileStyle(clientName?: string, techName?: string): {
  backgroundColor: string;
  backgroundImage?: string;
} {
  const pastel = clientPastel(clientName);
  if (!techName) return { backgroundColor: pastel };
  const stripe = `hsl(${staffHue(techName)} 62% 42% / 0.28)`;
  return {
    backgroundColor: pastel,
    backgroundImage: `repeating-linear-gradient(45deg, ${stripe} 0, ${stripe} 6px, transparent 6px, transparent 12px)`,
  };
}

// CSS for a legend swatch showing a staff member's stripes on a white square.
export function legendStripeStyle(techName: string): { backgroundColor: string; backgroundImage: string } {
  const stripe = staffBold(techName);
  return {
    backgroundColor: 'white',
    backgroundImage: `repeating-linear-gradient(45deg, ${stripe} 0, ${stripe} 3px, transparent 3px, transparent 6px)`,
  };
}
