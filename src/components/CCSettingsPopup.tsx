import { CompanySettings, resolveCancellationCodes } from '../types';

// Read-only snapshot of the compliance & cancellation settings that drive the
// C&C hub. Editing lives in Admin → C&C; this popup is the at-a-glance view with
// a single "Edit" jump. Reuses the Settings.tsx modal overlay shape.
interface Props {
  settings: CompanySettings;
  onClose: () => void;
  // Jumps to Admin with the editable C&C tab pre-selected.
  onEdit: () => void;
}

export default function CCSettingsPopup({ settings, onClose, onEdit }: Props) {
  const pct = (n: number | undefined) => (n === undefined ? '—' : `${n}%`);
  const num = (n: number | undefined) => (n === undefined ? '—' : String(n));
  const pt = settings.parentTraining;
  const reasons = resolveCancellationCodes(settings).filter(r => !r.retired);

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 'bold', margin: 0 }}>C&C Settings</h2>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
          </div>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 4px' }}>View-only. Use Edit to change these in Admin.</p>
        </div>

        <div style={{ padding: '8px 20px 20px', overflowY: 'auto' }}>
          <Section title="Supervision (% of direct hours)">
            <Row label="Floor (hard min)" value={pct(settings.supervisionFloorPercent)} />
            <Row label="Preferred band" value={`${pct(settings.supervisionPreferredMinPercent)} – ${pct(settings.supervisionPreferredMaxPercent)}`} />
            <Row label="Insurer cap" value={pct(settings.supervisionMaxHoursPercent)} />
            <Row label="Legacy per-case target" value={pct(settings.supervisionDirectHoursPercent)} />
            <Row label="RBT target" value={pct(settings.supervisionRBTHoursPercent)} />
            <Row label="Non-RBT BT target" value={pct(settings.supervisionTechHoursPercent)} />
          </Section>

          <Section title="Supervision contacts / month">
            <Row label="RBT minimum" value={num(settings.rbtMinContactsPerMonth)} />
            <Row label="BT minimum" value={num(settings.techMinContactsPerMonth)} />
            <Row label="Must be separate days" value={settings.contactsMustOccurOnSeparateDays === false ? 'No' : 'Yes'} />
          </Section>

          {pt && (
            <Section title={`Parent training (per ${pt.periodUnit})`}>
              <Row label="Minimum" value={`${num(pt.minimumHours)}h`} />
              <Row label="Target band" value={`${num(pt.targetMinHours)} – ${num(pt.targetMaxHours)}h`} />
            </Section>
          )}

          {settings.cancellationNotice && (
            <Section title="Cancellation notice thresholds">
              <Row label="Unplanned (hours)" value={num(settings.cancellationNotice.unplannedHoursThreshold)} />
              <Row label="Planned (days)" value={num(settings.cancellationNotice.plannedDaysThreshold)} />
            </Section>
          )}

          <Section title={`Cancellation reasons (${reasons.length})`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {reasons.map(r => (
                <span key={r.value} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: 'var(--surface-sunken)', color: 'var(--text-body)' }}>
                  {r.label}
                </span>
              ))}
              {reasons.length === 0 && <span style={{ fontSize: 12, color: '#9ca3af' }}>Using built-in defaults.</span>}
            </div>
          </Section>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--surface-sunken)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button onClick={onClose} style={secondaryBtn}>Close</button>
          <button onClick={() => { onClose(); onEdit(); }} style={primaryBtn}>Edit in Admin → C&C</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 6px', color: '#374151' }}>{title}</h3>
      <div style={{ display: 'grid', gap: 2 }}>{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
  boxSizing: 'border-box',
};
const modal: React.CSSProperties = {
  backgroundColor: 'white', borderRadius: 8, width: '100%', maxWidth: 460,
  maxHeight: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', background: 'var(--brand-primary)', color: 'white',
  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
const secondaryBtn: React.CSSProperties = {
  padding: '8px 14px', background: 'white', color: 'var(--text-body)',
  border: 'var(--border-hairline)', borderRadius: 6, cursor: 'pointer', fontSize: 13,
};
