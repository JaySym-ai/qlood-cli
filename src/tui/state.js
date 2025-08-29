// Simple observable store for TUI state
// Provides: getState, setState (partial), subscribe

const listeners = new Set();

const initialState = {
  // UI
  expectingInitConfirm: false,
  working: false,
  toast: null, // { message, type, until }
  // Streaming
  streamSpinnerActive: false,
  streamSpinnerFrame: 0,
  lastStreamChunkAt: 0,
  // History
  history: [],
  histIndex: -1,
};

let state = { ...initialState };

export function getState() {
  return state;
}

export function setState(partial) {
  const next = { ...state, ...partial };
  state = next;
  for (const fn of Array.from(listeners)) {
    try { fn(state); } catch {}
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetState() {
  setState({ ...initialState });
}

