import React, { useCallback, useRef, useState } from 'react';
import { ScheduleData } from '@shared/types';
import { ComplianceCache, buildCache } from '@shared/complianceCache';
import { validatePassword } from '@shared/passwordPolicy';
import { StoreError } from './store/scheduleStore';
import { createFileScheduleStore, readBackupFile, type FileRef } from './store/fileScheduleStore';
import UploadZone from './UploadZone';
import SetupWizard from '@shared/components/SetupWizard';
import PasswordForm from './PasswordForm';
import ReadyView from './ReadyView';
import type { Tab } from './ReadyView';
import LogoutLink from './LogoutLink';
import BackupPasswordDialog from './BackupPasswordDialog';
import type { AiConfig } from './parse.worker';

type Phase = 'upload' | 'setup' | 'password' | 'decrypting' | 'ready';

export default function WebApp() {
  const [phase, setPhase]               = useState<Phase>('upload');
  const [ref, setRef]                   = useState<FileRef | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [compCache, setCompCache]       = useState<ComplianceCache | null>(null);
  const [password, setPassword]         = useState<string>('');
  // Read-only here. The portal's own assistant needs no key (it goes through the
  // proxy), but a file made by the iOS app may carry one, and the save path hands
  // it back untouched so the app keeps working from the same file.
  const [aiConfig, setAiConfig]         = useState<AiConfig | null>(null);
  const [isDirty, setIsDirty]           = useState(false);
  const [isSaving, setIsSaving]         = useState(false);
  const [saveError, setSaveError]       = useState<string | null>(null);
  const [uploadError, setUploadError]   = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [pwDialogOpen, setPwDialogOpen] = useState(false);
  const [dict, setDict]                 = useState<ReadonlySet<string> | null>(null);
  const [landOn, setLandOn]             = useState<Tab>('calendar');

  // Where schedules come from and go back to. One store today - an encrypted file
  // on this device - reached only through the seam, so Phase 2's server-backed
  // store swaps in here and nothing else on this screen changes.
  const storeRef       = useRef(createFileScheduleStore());
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

  const handleFile = useCallback(async (file: File) => {
    setUploadError(null);
    try {
      setRef(await readBackupFile(file));
    } catch (err) {
      setUploadError(err instanceof StoreError ? err.message : 'Could not read the file. Please try again.');
      return;
    }
    setPasswordError(null);
    setPhase('password');
  }, []);

  // A wrong password sends the person back to the password field; anything else
  // means this source will never open, so they start again with another one.
  const handlePasswordSubmit = useCallback(async (pwd: string) => {
    if (!ref) return;
    setPhase('decrypting');
    setPasswordError(null);
    try {
      const opened = await storeRef.current.load(ref, pwd);
      setScheduleData(opened.data);
      setCompCache(opened.cache);
      setPassword(pwd);
      setAiConfig(opened.aiConfig);
      setIsDirty(false);
      setLandOn('calendar');
      setPhase('ready');
      // Warm the password dictionary so the Save-time strength check is instant.
      loadDict().then(setDict);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof StoreError && err.failure === 'bad-credential') {
        setPasswordError(message);
        setPhase('password');
      } else {
        setUploadError(message);
        setRef(null);
        setPhase('upload');
      }
    }
  }, [ref, loadDict]);

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
    // A brand-new schedule has a roster and no sessions, so the next thing it
    // needs is a build - not an empty calendar to stare at.
    setLandOn('build');
    setPhase('ready');
    loadDict().then(setDict);
  }, [loadDict]);

  const handleDataChange = useCallback((next: ScheduleData) => {
    setScheduleData(next);
    setCompCache(buildCache(next));
    setIsDirty(true);
    setSaveError(null);
  }, []);

  // Commit the schedule with the given password. Records that password as the
  // session password so subsequent saves reuse it.
  const runSave = useCallback(async (pwd: string) => {
    if (!scheduleData) return;
    setPwDialogOpen(false);
    setIsSaving(true);
    setSaveError(null);
    try {
      await storeRef.current.save(scheduleData, aiConfig, pwd);
      setPassword(pwd);
      setIsDirty(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
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
    setRef(null);
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
    storeRef.current.dispose();
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
          initialTab={landOn}
          onDataChange={handleDataChange}
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
