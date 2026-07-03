import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHomeTodos } from './useHomeTodos';

const KEY = 'sassi.home.todos.v1';

describe('useHomeTodos', () => {
  // The shared test setup stubs localStorage as a non-persisting mock; swap in a
  // real in-memory store so persistence/rehydration is exercised for real.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts empty with no fabricated data', () => {
    const { result } = renderHook(() => useHomeTodos());
    expect(result.current.todos).toEqual([]);
  });

  it('adds a to-do and persists it to localStorage', () => {
    const { result } = renderHook(() => useHomeTodos());
    act(() => result.current.add({ clientId: 'c1', text: 'Pull probe data', due: 'Thu' }));
    expect(result.current.todos).toHaveLength(1);
    expect(result.current.todos[0]).toMatchObject({ clientId: 'c1', text: 'Pull probe data', due: 'Thu', done: false });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
  });

  it('ignores blank text', () => {
    const { result } = renderHook(() => useHomeTodos());
    act(() => result.current.add({ clientId: 'c1', text: '   ' }));
    expect(result.current.todos).toHaveLength(0);
  });

  it('marks a to-do done', () => {
    const { result } = renderHook(() => useHomeTodos());
    act(() => result.current.add({ clientId: 'c1', text: 'Re-auth packet' }));
    const id = result.current.todos[0].id;
    act(() => result.current.markDone(id));
    expect(result.current.todos[0].done).toBe(true);
  });

  it('removes a to-do', () => {
    const { result } = renderHook(() => useHomeTodos());
    act(() => result.current.add({ clientId: 'c1', text: 'Materials' }));
    const id = result.current.todos[0].id;
    act(() => result.current.remove(id));
    expect(result.current.todos).toHaveLength(0);
  });

  it('rehydrates persisted todos on mount', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { id: 'x1', clientId: 'c1', text: 'Existing', done: false },
    ]));
    const { result } = renderHook(() => useHomeTodos());
    expect(result.current.todos).toHaveLength(1);
    expect(result.current.todos[0].text).toBe('Existing');
  });
});
