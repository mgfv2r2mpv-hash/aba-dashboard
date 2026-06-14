/**
 * Verification for "Fix It" pure logic: the allowed-strategies clause and the
 * human summary derived from FixItOptions.
 * Run: npx tsx scripts/verify-fixit.ts
 */
import { DEFAULT_FIXIT_OPTIONS, FixItOptions } from '../src/types';
import { allowedStrategies, summarizeFixIt } from '../src/fixit';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

console.log('defaults');
{
  check('BT supervision on by default', DEFAULT_FIXIT_OPTIONS.includeBtSupervision === true);
  check('no-BT supervision off by default', DEFAULT_FIXIT_OPTIONS.includeNoBtSupervision === false);
  check('in-session parent training on by default', DEFAULT_FIXIT_OPTIONS.includeInSessionParentTraining === true);
  check('out-session parent training off by default', DEFAULT_FIXIT_OPTIONS.includeOutSessionParentTraining === false);
  check('case planning on by default', DEFAULT_FIXIT_OPTIONS.includeCasePlanning === true);
  check('soften billable off by default', DEFAULT_FIXIT_OPTIONS.softenBillableMinimum === false);
}

console.log('allowedStrategies');
{
  const def = allowedStrategies(DEFAULT_FIXIT_OPTIONS);
  check('default selects 3 strategies', def.length === 3, `got ${def.length}`);
  const none: FixItOptions = {
    ...DEFAULT_FIXIT_OPTIONS,
    includeBtSupervision: false, includeNoBtSupervision: false,
    includeInSessionParentTraining: false, includeOutSessionParentTraining: false,
    includeCasePlanning: false,
  };
  check('no strategies → empty list', allowedStrategies(none).length === 0);
  const all: FixItOptions = {
    ...DEFAULT_FIXIT_OPTIONS,
    includeBtSupervision: true, includeNoBtSupervision: true,
    includeInSessionParentTraining: true, includeOutSessionParentTraining: true,
    includeCasePlanning: true,
  };
  check('all strategies → 5 entries', allowedStrategies(all).length === 5);
}

console.log('summarizeFixIt');
{
  const soft = summarizeFixIt({ ...DEFAULT_FIXIT_OPTIONS, softenBillableMinimum: true });
  check('soften mentions softened', /soften/i.test(soft));
  const hard = summarizeFixIt(DEFAULT_FIXIT_OPTIONS);
  check('default keeps billable at/above min', /at or above its minimum/i.test(hard));
  const excl = summarizeFixIt({ ...DEFAULT_FIXIT_OPTIONS, excludedClientIds: ['a', 'b'] });
  check('summary reports excluded count', excl.includes('Excluding 2 client'));
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
