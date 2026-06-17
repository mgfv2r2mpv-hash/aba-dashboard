import React, { useState, useCallback } from 'react';
import type { CprSession } from '../cpr/types';
import { loadSessions, upsertSession, deleteSession } from '../cpr/storage';
import { computeCprAnalysis } from '../cpr/engine';
import CprSetupWizard from './CprSetupWizard';
import CprRecorder from './CprRecorder';
import CprReport from './CprReport';
import type { CodeSet } from '../cpr/types';

type Phase = 'list' | 'setup' | 'recording' | 'report';

function fmtDate(d: string) {
  const [y, m, day] = d.split('-');
  return `${m}/${day}/${y}`;
}
function fmtDuration(ms: number) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s % 60}s`;
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 16, padding: 32, textAlign: 'center',
      color: '#6b7280',
    }}>
      <div style={{ fontSize: 48, opacity: 0.3 }}>📊</div>
      <div>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
          No CPR sessions yet
        </div>
        <div style={{ fontSize: 14, maxWidth: 340, lineHeight: 1.5 }}>
          Conditional Probability Recording (CPR) lets you observe and quantify
          antecedent–behavior–consequence sequences, then generate a print-ready
          functional hypothesis report.
        </div>
      </div>
      <button onClick={onNew} style={{
        padding: '12px 24px', borderRadius: 10, border: 'none',
        background: '#6366f1', color: '#fff', fontWeight: 700,
        fontSize: 15, cursor: 'pointer',
      }}>
        Start First Session
      </button>
      <p style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>
        Vollmer et al. (1993) · Bakeman &amp; Gottman (1997)
      </p>
    </div>
  );
}

function SessionCard({
  session,
  onView,
  onDelete,
}: {
  session: CprSession;
  onView: () => void;
  onDelete: () => void;
}) {
  const behavior = session.codeSetSnapshot.codes.find(c => c.id === session.targetBehaviorId);
  const behaviorCount = session.events.filter(e => e.codeId === session.targetBehaviorId).length;

  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: '14px 16px',
      border: '1px solid #e5e7eb', display: 'flex', gap: 12, alignItems: 'center',
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    }}>
      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onView}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
            {session.clientLabel}
          </span>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            {fmtDate(session.date)} · {fmtDuration(session.durationMs)}
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>
          {behavior?.label ?? 'Target behavior'}: {behaviorCount} occurrence{behaviorCount !== 1 ? 's' : ''}
          &ensp;·&ensp;{session.events.length} events total
          &ensp;·&ensp;{session.observerName}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, background: '#eef2ff', color: '#4f46e5', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>
            {session.codeSetSnapshot.name}
          </span>
          <span style={{ fontSize: 10, background: '#f3f4f6', color: '#6b7280', borderRadius: 4, padding: '2px 6px' }}>
            {(session.lagWindowMs / 1000)}s window
          </span>
          {session.lagEnabled && (
            <span style={{ fontSize: 10, background: '#f0fdf4', color: '#059669', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>
              Lag ×{session.lagCount}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
        <button
          onClick={onView}
          style={{
            padding: '6px 14px', borderRadius: 7, border: 'none',
            background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Report
        </button>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{
            padding: '6px 14px', borderRadius: 7, border: '1px solid #fca5a5',
            background: '#fff', color: '#ef4444', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default function CprView() {
  const [phase, setPhase] = useState<Phase>('list');
  const [sessions, setSessions] = useState<CprSession[]>(loadSessions);
  const [activeSession, setActiveSession] = useState<CprSession | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleSetupStart = useCallback((config: {
    clientLabel: string; observerName: string; date: string;
    codeSet: CodeSet; lagEnabled: boolean; lagWindowMs: number;
    lagCount: number; targetBehaviorId: string; notes: string;
  }) => {
    const session: CprSession = {
      id: crypto.randomUUID(),
      clientLabel: config.clientLabel,
      observerName: config.observerName,
      date: config.date,
      durationMs: 0,
      codeSetSnapshot: config.codeSet,
      events: [],
      lagEnabled: config.lagEnabled,
      lagWindowMs: config.lagWindowMs,
      lagCount: config.lagCount,
      targetBehaviorId: config.targetBehaviorId,
      notes: config.notes,
      createdAt: Date.now(),
    };
    setActiveSession(session);
    setPhase('recording');
  }, []);

  const handleRecordingEnd = useCallback((completed: CprSession) => {
    const saved = upsertSession(completed);
    setSessions(saved);
    setActiveSession(completed);
    setPhase('report');
  }, []);

  const handleDeleteConfirm = useCallback((id: string) => {
    const updated = deleteSession(id);
    setSessions(updated);
    setDeleteConfirm(null);
  }, []);

  if (phase === 'recording' && activeSession) {
    return (
      <CprRecorder
        session={activeSession}
        onEnd={handleRecordingEnd}
        onCancel={() => { setActiveSession(null); setPhase('list'); }}
      />
    );
  }

  if (phase === 'report' && activeSession) {
    const analysis = computeCprAnalysis(activeSession);
    return (
      <CprReport
        analysis={analysis}
        onBack={() => { setActiveSession(null); setPhase('list'); }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f8fafc' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px 12px',
        background: '#fff', borderBottom: '1px solid #e5e7eb', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>
              Conditional Probability Recording
            </h2>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '3px 0 0' }}>
              ABC observation · lag sequential analysis · functional hypothesis generation
            </p>
          </div>
          <button
            onClick={() => setPhase('setup')}
            style={{
              padding: '9px 18px', borderRadius: 9, border: 'none',
              background: '#6366f1', color: '#fff', fontWeight: 700,
              fontSize: 14, cursor: 'pointer', flexShrink: 0,
            }}
          >
            + New Session
          </button>
        </div>
      </div>

      {/* Session list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sessions.length === 0 ? (
          <EmptyState onNew={() => setPhase('setup')} />
        ) : (
          sessions
            .slice()
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(s => (
              <SessionCard
                key={s.id}
                session={s}
                onView={() => { setActiveSession(s); setPhase('report'); }}
                onDelete={() => setDeleteConfirm(s.id)}
              />
            ))
        )}
      </div>

      {/* Setup wizard */}
      {phase === 'setup' && (
        <CprSetupWizard
          onStart={handleSetupStart}
          onCancel={() => setPhase('list')}
        />
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#fff', borderRadius: 14, padding: 24, maxWidth: 320,
            width: '90%', textAlign: 'center',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Delete this session?</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
              This will permanently remove the session and all recorded events.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontWeight: 600, cursor: 'pointer' }}
              >Cancel</button>
              <button
                onClick={() => handleDeleteConfirm(deleteConfirm)}
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
              >Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
