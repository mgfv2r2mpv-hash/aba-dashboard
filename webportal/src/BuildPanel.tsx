import React, { useEffect, useState } from 'react';
import type { ScheduleData } from '@shared/types';
import { Pills } from '@shared/components/setup/SetupControls';
import { BuildResultPanel } from '@shared/components/dock/BuildResultPanel';
import { runBuild, nextTemplateWeek, type BuildPasses, type BuildPreview } from './build/runBuild';

const PASS_OPTIONS: { value: BuildPasses; label: string }[] = [
  { value: 'all',              label: 'Everything' },
  { value: 'direct',           label: 'Direct only' },
  { value: 'supervision',      label: 'Supervision only' },
  { value: 'parent-training',  label: 'Parent training only' },
];

// The last day the proposal reaches, so the count is never read as "this week".
function span(preview: BuildPreview): string | null {
  const starts = preview.next.appointments.map(a => a.startTime).sort();
  const last = starts[starts.length - 1];
  if (!last) return null;
  return new Date(last).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

const PASS_EXPLAINER: Record<BuildPasses, string> = {
  all: 'Places the direct backbone, then chases supervision and parent training over it.',
  direct: 'Places client sessions only. Run this first on a new schedule.',
  supervision: 'Chases every case to its supervision floor over the sessions already there.',
  'parent-training': 'Chases every case to its parent-training goal over the sessions already there.',
};

/**
 * The portal's Build tab: run the deterministic builder, read what it placed and
 * what it could not, then decide. A build is never committed on the way out - the
 * preview holds the proposed schedule until it is applied, so a run that turns out
 * to place nothing costs a discard rather than an undo.
 */
export default function BuildPanel({
  data,
  onApply,
}: {
  data: ScheduleData;
  onApply: (next: ScheduleData) => void;
}) {
  const [passes, setPasses]       = useState<BuildPasses>('all');
  const [weekStart, setWeekStart] = useState(() => nextTemplateWeek(new Date()));
  const [preview, setPreview]     = useState<BuildPreview | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [running, setRunning]     = useState(false);

  // A preview describes one exact schedule. The moment that schedule changes -
  // an edit elsewhere, an applied build - the preview is about something that no
  // longer exists, so it goes rather than sitting there looking current.
  useEffect(() => { setPreview(null); }, [data]);

  const run = () => {
    setError(null);
    setRunning(true);
    try {
      setPreview(runBuild(data, { passes, weekStart }));
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const cases = data.clients.length;
  const techs = data.technicians.length;
  const canBuild = cases > 0 && techs > 0;

  return (
    <div className="portal-settings-wrap">
      <h2 className="settings-heading">Build a schedule</h2>

      <section className="settings-section">
        <p className="settings-section-desc">
          The builder shapes one recurring week inside everyone's stated availability, then repeats
          it until each case's authorization runs out. It proposes; nothing reaches the calendar
          until you apply it.
        </p>

        <div className="build-field">
          <span className="form-label">What to build</span>
          <Pills ariaLabel="What to build" value={passes} onChange={setPasses} options={PASS_OPTIONS} />
          <p className="build-hint">{PASS_EXPLAINER[passes]}</p>
        </div>

        <div className="build-field">
          <label className="form-label" htmlFor="build-week">Week to shape the pattern on</label>
          <input
            id="build-week"
            type="date"
            className="form-input build-date"
            value={weekStart}
            onChange={e => setWeekStart(e.target.value)}
          />
          <p className="build-hint">
            The pattern this week works out is the one that repeats. A later week means the schedule
            starts later; a week already begun keeps only the days still ahead. Nothing is ever
            placed behind today.
          </p>
        </div>

        {!canBuild && (
          <p className="build-blocked" role="status">
            {cases === 0 && techs === 0
              ? 'Add at least one case and one technician before building.'
              : cases === 0
                ? 'Add at least one case before building.'
                : 'Add at least one technician before building.'}
          </p>
        )}

        <button className="btn-primary" onClick={run} disabled={!canBuild || running}>
          {running ? 'Building…' : 'Build schedule'}
        </button>

        {error && <p className="build-error" role="alert">The build failed: {error}</p>}
      </section>

      {preview && (
        <section className="settings-section">
          <BuildResultPanel
            result={preview.result}
            hasStagedProposal={preview.added > 0}
            reviewStep="Look it over on the calendar's Case and BT views, then apply it below."
            noAuthStep="Nothing was placed — no case has an authorization with weekly direct hours yet. Add them under Admin → Auths, then build again."
            onDismiss={() => setPreview(null)}
          />

          <div className="build-decision">
            <span className="build-count">
              {preview.added === 0
                ? 'This build proposes no new sessions.'
                : `This build proposes ${preview.added} new session${preview.added === 1 ? '' : 's'}${
                    span(preview) ? `, running to ${span(preview)}` : ''
                  }.`}
            </span>
            <button
              className="btn-primary"
              onClick={() => onApply(preview.next)}
              disabled={preview.added === 0}
            >
              Apply to the calendar
            </button>
            <button className="btn-ghost" onClick={() => setPreview(null)}>Discard</button>
          </div>
        </section>
      )}
    </div>
  );
}
