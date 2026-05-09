export function createStore(initialState) {
  const listeners = new Set();
  let state = { ...(initialState || {}) };

  function notify() {
    listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (_error) {
        // Keep state propagation resilient.
      }
    });
  }

  return {
    getState() {
      return state;
    },
    setState(nextState) {
      state = { ...state, ...(nextState || {}) };
      notify();
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }

      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
