// The seam between the portal and wherever a schedule actually lives.
//
// Today there is one implementation and it is a file on the person's own disk:
// they hand us an encrypted backup, we hand one back. Phase 2 adds a second
// implementation that keeps schedules server side so a BT can open one without
// being given a file, and the portal picks between them rather than learning a
// second way to load and save.
//
// Everything file-shaped - worker plumbing, blob downloads, the .sassi envelope -
// belongs behind this interface, so a second implementation replaces mechanics
// rather than rewriting the screen that calls them.
import type { ScheduleData } from '@shared/types';
import type { ComplianceCache } from '@shared/complianceCache';
import type { AiConfig } from '../parse.worker';

export interface StoreDescription {
  readonly id: string;
  /** Where this store keeps schedules, phrased for a person. */
  readonly label: string;
  /** True when load and save need a secret the person has to supply. */
  readonly needsCredential: boolean;
}

export interface OpenedSchedule {
  readonly data: ScheduleData;
  readonly cache: ComplianceCache;
  readonly aiConfig: AiConfig | null;
}

// 'unreadable'     - the source is not a schedule we can open; the person picks another.
// 'bad-credential' - the source is fine, the secret is wrong; the person retypes it.
// 'failed'         - the machinery broke; nothing about the input would fix it.
export type StoreFailure = 'unreadable' | 'bad-credential' | 'failed';

export class StoreError extends Error {
  constructor(readonly failure: StoreFailure, message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

/**
 * `Ref` names one schedule in this store's own terms - the bytes of a file here,
 * an id over the network later. The portal holds a Ref without inspecting it.
 */
export interface ScheduleStore<Ref> {
  describe(): StoreDescription;
  load(ref: Ref, credential: string): Promise<OpenedSchedule>;
  save(data: ScheduleData, aiConfig: AiConfig | null, credential: string): Promise<void>;
  /** Releases anything long-lived. The store stays usable afterwards. */
  dispose(): void;
}
