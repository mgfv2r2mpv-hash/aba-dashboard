import { useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Appointment } from '../types';

// Home to-dos are net-new state with no engine backing — a small, local-only
// store persisted to localStorage. They start empty (no fabricated PHI); the
// Supervising Behavior Analyst adds their own client-tagged items, and
// "Start → session" opens the appointment form prefilled from the to-do.

export interface HomeTodo {
  id: string;
  clientId: string;      // Client.id (or name) the item is tagged to
  text: string;
  due?: string;          // free-text due hint, e.g. "Thu" or "Mon 23"
  done: boolean;
  sessionType?: Appointment['type']; // seed type for Start → session
}

export interface NewHomeTodo {
  clientId: string;
  text: string;
  due?: string;
  sessionType?: Appointment['type'];
}

const STORAGE_KEY = 'sassi.home.todos.v1';

function load(): HomeTodo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isHomeTodo) : [];
  } catch {
    return [];
  }
}

function isHomeTodo(x: unknown): x is HomeTodo {
  return !!x && typeof x === 'object'
    && typeof (x as HomeTodo).id === 'string'
    && typeof (x as HomeTodo).text === 'string';
}

export interface UseHomeTodos {
  todos: HomeTodo[];
  add: (todo: NewHomeTodo) => void;
  remove: (id: string) => void;
  markDone: (id: string, done?: boolean) => void;
}

export function useHomeTodos(): UseHomeTodos {
  const [todos, setTodos] = useState<HomeTodo[]>(() => load());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    } catch {
      /* storage full / unavailable — keep the in-memory list */
    }
  }, [todos]);

  const add = useCallback((todo: NewHomeTodo) => {
    const text = todo.text.trim();
    if (!text) return;
    const next: HomeTodo = {
      id: uuidv4(),
      clientId: todo.clientId,
      text,
      due: todo.due?.trim() || undefined,
      done: false,
      sessionType: todo.sessionType,
    };
    setTodos(prev => [...prev, next]);
  }, []);

  const remove = useCallback((id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id));
  }, []);

  const markDone = useCallback((id: string, done = true) => {
    setTodos(prev => prev.map(t => (t.id === id ? { ...t, done } : t)));
  }, []);

  return { todos, add, remove, markDone };
}
