import React, { useCallback, useRef, useState } from 'react';
import { isEncryptedSchedule } from '@shared/clientCrypto';
import { ScheduleData } from '@shared/types';
import { ComplianceCache, buildCache } from '@shared/complianceCache';
import UploadZone from './UploadZone';
import PasswordForm from './PasswordForm';
import ReadyView from './ReadyView';
import type { WorkerResponse } from './parse.worker';
import type { SaveResponse } from './save.worker';

type Phase = 'upload' | 'password' | 'decrypting' | 'ready';

export default function WebApp() {
  const [phase, setPhase]               = useState<Phase>('upload');
  const [fileBytes, setFileBytes]       = useState<Uint8Array | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [compCache, setCompCache]       = useState<ComplianceCache | null>(null);
  const [password, setPassword]         = useState<string>('');
  const [apiKey, setApiKey]             = useState<string | null>(null);
  const [isDirty, setIsDirty]           = useState(false);
  const [isSaving, setIsSaving]         = useState(false);
  const [saveError, setSaveError]       = useState<string | null>(null);
  const [uploadError, setUploadError]   = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const parseWorkerRef = useRef<Worker | null>(null);
  const saveWorkerRef  = useRef<Worker | null>(null);

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
        'This file is not encrypted. Export from the ABA Dashboard app with a schedule password, then try again.'
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
        setApiKey(res.apiKey ?? null);
        setIsDirty(false);
        setPhase('ready');
      } else if (res.isDOMException) {
        setPasswordError('Incorrect password. Please try again.');
        setPhase('password');
      } else {
        setUploadError(`Failed to parse schedule: ${res.message}`);
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
  }, [fileBytes, getParseWorker]);

  const handleDataChange = useCallback((next: ScheduleData) => {
    setScheduleData(next);
    setCompCache(buildCache(next));
    setIsDirty(true);
    setSaveError(null);
  }, []);

  const handleApiKeyChange = useCallback((key: string | null) => {
    setApiKey(key);
  }, []);

  const handleSave = useCallback(() => {
    if (!scheduleData || !password) return;
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
        a.download = 'schedule.enc';
        a.click();
        URL.revokeObjectURL(url);
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

    worker.postMessage({ data: scheduleData, password, apiKey: apiKey ?? undefined });
  }, [scheduleData, password, apiKey]);

  const reset = useCallback(() => {
    setPhase('upload');
    setFileBytes(null);
    setScheduleData(null);
    setCompCache(null);
    setPassword('');
    setApiKey(null);
    setIsDirty(false);
    setIsSaving(false);
    setSaveError(null);
    setUploadError(null);
    setPasswordError(null);
    parseWorkerRef.current?.terminate();
    parseWorkerRef.current = null;
    saveWorkerRef.current?.terminate();
    saveWorkerRef.current = null;
  }, []);

  if (phase === 'ready' && scheduleData && compCache) {
    return (
      <ReadyView
        scheduleData={scheduleData}
        compCache={compCache}
        isDirty={isDirty}
        isSaving={isSaving}
        saveError={saveError}
        apiKey={apiKey}
        onDataChange={handleDataChange}
        onApiKeyChange={handleApiKeyChange}
        onSave={handleSave}
        onReset={reset}
      />
    );
  }

  if (phase === 'decrypting') {
    return (
      <div className="portal centered-screen">
        <div className="spinner-wrap">
          <div className="spinner" aria-hidden="true" />
          <p className="spinner-label">Decrypting and loading schedule…</p>
        </div>
      </div>
    );
  }

  if (phase === 'password') {
    return (
      <PasswordForm
        onSubmit={handlePasswordSubmit}
        onCancel={reset}
        error={passwordError}
        isLoading={false}
      />
    );
  }

  return (
    <div className="portal">
      <UploadZone onFile={handleFile} error={uploadError} />
    </div>
  );
}
