import React, { useCallback, useRef, useState } from 'react';
import { isEncryptedSchedule } from '@shared/clientCrypto';
import { ScheduleData } from '@shared/types';
import { ComplianceCache, buildCache } from '@shared/complianceCache';
import { validatePassword } from '@shared/passwordPolicy';
import { backupFilename } from '@shared/lib/backupFilename';
import UploadZone from './UploadZone';
import SetupWizard from '@shared/components/SetupWizard';
import PasswordForm from './PasswordForm';
import ReadyView from './ReadyView';
import LogoutLink from './LogoutLink';
import BackupPasswordDialog from './BackupPasswordDialog';
import type { AiConfig, WorkerResponse } from './parse.worker';
import type { SaveResponse } from './save.worker';

type Phase = 'upload' | 'setup' | 'password' | 'decrypting' | 'ready';

export default function WebApp() {
  const [phase, setPhase]               = useState<Phase>('upload');
  const [fileBytes, setFileBytes]       = useState<Uint8Array | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [compCache, setCompCache]       = useState<ComplianceCache | null>(null);
  const [password, setPassword]         = useState<string>('');
  const [aiConfig, setAiConfig]         = useState<AiConfig | null>(null);
  const [isDirty, setIsDirty]           = useState(false);
  const [isSaving, setIsSaving]         = useState(false);
  const [saveError, setSaveError]       = useState<string | null>(null);
  const [uploadError, setUploadError]   = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [pwDialogOpen, setPwDialogOpen] = useState(false);
  const [dict, setDict]                 = useState<ReadonlySet<string> | null>(null);

  const parseWorkerRef = useRef<Worker | null>(null);
  const saveWorkerRef  = useRef<Worker | null>(null);
  const dictPromiseRef = useRef<Promise<ReadonlySet<string>> | null>(null);

  // Lazy, memoized load of the password dictionary (a separate chunk so it stays out
  // of the landing bundle). Fails soft to an empty set — a blocked import must not
  // block saving; the other strength rules still apply.
  const loadDict = useCallback(() => {
    if (!dictPromiseRef.current) {
      dictPromiseRef.current = import('@shared/passwordDict')
        .then(m => m.PASSWORD_DICT)
        .catch(() => new Set<string>());
    }
    return dictPromiseRef.current;
  }, []);

  const getParseWorker = useCallback(() => {
    if (!parseWorkerRef.current) {
      parseWorkerRef.current = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    }
    return parseWorkerRef.current;
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setUploadError(null);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      setUploadError('Could not read the file. Please try again.');
      return;
    }
    if (!isEncryptedSchedule(bytes)) {
      setUploadError(
        'This file is not encrypted. Export a backup (.sassi) from the SAssi Cal app with a schedule password, then try again.'
      );
      return;
    }
    setFileBytes(bytes);
    setPasswordError(null);
    setPhase('password');
  }, []);

  const handlePasswordSubmit = useCallback((pwd: string) => {
    if (!fileBytes) return;
    setPhase('decrypting');
    setPasswordError(null);

    const worker = getParseWorker();

    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      worker.removeEventListener('message', onMessage);
      const res = e.data;
      if (res.ok) {
        setScheduleData(res.data);
        setCompCache(res.cache);
        setPassword(pwd);
        setAiConfig(res.aiConfig ?? null);
        setIsDirty(false);
        setPhase('ready');
        // Warm the password dictionary so the Save-time strength check is instant.
        loadDict().then(setDict);
      } else if (res.isDOMException) {
        setPasswordError('Incorrect password. Please try again.');
        setPhase('password');
      } else {
        setUploadError(res.message);
        setFileBytes(null);
        setPhase('upload');
      }
    };

    worker.addEventListener('message', onMessage);
    worker.onerror = (e) => {
      worker.onerror = null;
      worker.removeEventListener('message', onMessage);
      setUploadError(`Worker failed: ${e.message ?? 'unknown error'}. Try refreshing.`);
      setFileBytes(null);
      setPhase('upload');
    };
    worker.postMessage({ bytes: fileBytes, password: pwd });
  }, [fileBytes, getParseWorker, loadDict]);

  // The portal's second front door: setup returns a complete ScheduleData, so
  // it drops straight into 'ready' beside the decrypt path. A schedule created
  // here has never been saved, so it starts dirty with no session password —
  // Save will open the backup-password dialog on the first download.
  const handleSetupComplete = useCallback((next: ScheduleData) => {
    setScheduleData(next);
    setCompCache(buildCache(next));
    setAiConfig(null);
    setIsDirty(true);
    setSaveError(null);
    setPhase('ready');
    loadDict().then(setDict);
  }, [loadDict]);

  const handleDataChange = useCallback((next: ScheduleData) => {
    setScheduleData(next);
    setCompCache(buildCache(next));
    setIsDirty(true);
    setSaveError(null);
  }, []);

  const handleAiConfigChange = useCallback((next: AiConfig | null) => {
    setAiConfig(next);
  }, []);

  // Spawn the save worker with the given password and download the encrypted backup.
  // Records the password as the session password so subsequent saves reuse it.
  const runSave = useCallback((pwd: string) => {
    if (!scheduleData) return;
    setPwDialogOpen(false);
    setIsSaving(true);
    setSaveError(null);

    const worker = new Worker(new URL('./save.worker.ts', import.meta.url), { type: 'module' });
    saveWorkerRef.current?.terminate();
    saveWorkerRef.current = worker;

    worker.addEventListener('message', (e: MessageEvent<SaveResponse>) => {
      worker.terminate();
      const res = e.data;
      if (res.ok) {
        const blob = new Blob([res.bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = backupFilename(scheduleData.settings.practiceName);
        a.click();
        URL.revokeObjectURL(url);
        setPassword(pwd);
        setIsDirty(false);
        setIsSaving(false);
      } else {
        setSaveError(`Save failed: ${res.message}`);
        setIsSaving(false);
      }
    });

    worker.onerror = (e) => {
      worker.terminate();
      setSaveError(`Save worker failed: ${e.message ?? 'unknown error'}`);
      setIsSaving(false);
    };

    worker.postMessage({ data: scheduleData, password: pwd, aiConfig: aiConfig ?? undefined });
  }, [scheduleData, aiConfig]);

  // Save enforces the file-password policy: a compliant session password downloads
  // in one click; a weak one opens the dialog to require a stronger one first.
  const handleSave = useCallback(async () => {
    if (!scheduleData || !password) return;
    const d = dict ?? await loadDict();
    if (!dict) setDict(d);
    if (validatePassword(password, d).valid) {
      runSave(password);
    } else {
      setSaveError(null);
      setPwDialogOpen(true);
    }
  }, [scheduleData, password, dict, loadDict, runSave]);

  const reset = useCallback(() => {
    setPhase('upload');
    setFileBytes(null);
    setScheduleData(null);
    setCompCache(null);
    setPassword('');
    setAiConfig(null);
    setIsDirty(false);
    setIsSaving(false);
    setSaveError(null);
    setUploadError(null);
    setPasswordError(null);
    setPwDialogOpen(false);
    parseWorkerRef.current?.terminate();
    parseWorkerRef.current = null;
    saveWorkerRef.current?.terminate();
    saveWorkerRef.current = null;
  }, []);

  if (phase === 'ready' && scheduleData && compCache) {
    return (
      <>
        <ReadyView
          scheduleData={scheduleData}
          compCache={compCache}
          isDirty={isDirty}
          isSaving={isSaving}
          saveError={saveError}
          aiConfig={aiConfig}
          onDataChange={handleDataChange}
          onAiConfigChange={handleAiConfigChange}
          onSave={handleSave}
          onReset={reset}
        />
        {pwDialogOpen && (
          <BackupPasswordDialog
            initialPassword={password}
            dict={dict}
            onSubmit={runSave}
            onCancel={() => setPwDialogOpen(false)}
          />
        )}
      </>
    );
  }

  if (phase === 'setup') {
    return (
      <SetupWizard
        onComplete={handleSetupComplete}
        onCancel={() => setPhase('upload')}
      />
    );
  }

  if (phase === 'decrypting') {
    return (
      <div className="portal centered-screen">
        <LogoutLink fixed />
        <div className="spinner-wrap">
          <div className="spinner" aria-hidden="true" />
          <p className="spinner-label">Decrypting and loading schedule…</p>
        </div>
      </div>
    );
  }

  if (phase === 'password') {
    return (
      <>
        <LogoutLink fixed />
        <PasswordForm
          onSubmit={handlePasswordSubmit}
          onCancel={reset}
          error={passwordError}
          isLoading={false}
        />
      </>
    );
  }

  return (
    <div className="portal">
      <LogoutLink fixed />
      <UploadZone
        onFile={handleFile}
        error={uploadError}
        onStartSetup={() => setPhase('setup')}
      />
    </div>
  );
}
