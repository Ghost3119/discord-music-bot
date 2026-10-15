import { describe, expect, it, vi } from 'vitest';
import { AbandonedOperation, createOperationScope } from '../src/lib/operation-scope';

describe('logout operation priority', () => {
  it('invalidates a pending extraction without waiting and prevents its UI continuation', async () => {
    const scope = createOperationScope();
    let finish!: () => void;
    const continuation = vi.fn();
    const pending = scope.run(() => new Promise<void>((resolve) => { finish = resolve; })).then(continuation);
    scope.invalidate(); // Logout takes this path immediately, independently of the busy operation.
    finish();
    await expect(pending).rejects.toBeInstanceOf(AbandonedOperation);
    expect(continuation).not.toHaveBeenCalled();
    await expect(scope.run(async () => 'new session')).resolves.toBe('new session');
  });

  it('discards late failures from a previous session while preserving current failures', async () => {
    const scope = createOperationScope();
    let fail!: (error: Error) => void;
    const pending = scope.run(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    scope.invalidate();
    fail(new Error('Late extraction failure'));
    await expect(pending).rejects.toBeInstanceOf(AbandonedOperation);
    await expect(scope.run(async () => { throw new Error('Current failure'); })).rejects.toThrow('Current failure');
  });
});
