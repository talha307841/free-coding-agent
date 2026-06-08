import * as assert from 'node:assert';
import { applyPatchToText, computePatchStats, parseUnifiedDiff } from '../../src/utils/diffApplier';
import { createReadAnnotation } from '../../src/utils/readAnnotations';
import { WorkflowStateMachine } from '../../src/workflow/stateMachine';

describe('NIM Coder extension', () => {
  it('applies unified diff patch to text', () => {
    const diff = [
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,3 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 22;',
      ' console.log(a + b);'
    ].join('\n');

    const patches = parseUnifiedDiff(diff);
    assert.strictEqual(patches.length, 1);
    const result = applyPatchToText('const a = 1;\nconst b = 2;\nconsole.log(a + b);', patches[0]);
    assert.strictEqual(result, 'const a = 1;\nconst b = 22;\nconsole.log(a + b);');

    const stats = computePatchStats(patches[0]);
    assert.deepStrictEqual(stats, { added: 1, removed: 1 });
  });

  it('creates read annotation with summary and safe line range', () => {
    const annotation = createReadAnnotation(
      'src/main.py',
      0,
      4,
      '\nclass ScrapingBeeBackend:\n    pass\n'
    );
    assert.strictEqual(annotation.startLine, 1);
    assert.strictEqual(annotation.endLine, 4);
    assert.strictEqual(annotation.languageTag, 'python');
    assert.ok(annotation.summary.includes('class ScrapingBeeBackend'));
  });

  it('enforces workflow transitions', () => {
    const machine = new WorkflowStateMachine();
    assert.strictEqual(machine.stage(), 'USER_REQUEST');

    machine.transition('PLAN');
    machine.transition('CONFIRM_PLAN');
    machine.transition('EXECUTE');
    machine.transition('VERIFY');
    machine.transition('DONE');

    assert.deepStrictEqual(machine.timeline(), [
      'USER_REQUEST',
      'PLAN',
      'CONFIRM_PLAN',
      'EXECUTE',
      'VERIFY',
      'DONE'
    ]);
  });

  it('rejects invalid workflow transition', () => {
    const machine = new WorkflowStateMachine();
    assert.throws(() => machine.transition('VERIFY'), /Invalid workflow transition/);
  });
});
