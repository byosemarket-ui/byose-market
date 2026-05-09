const subscribers = new Set();

export function subscribeRealtime(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function publishRealtime(event) {
  subscribers.forEach((listener) => {
    try {
      listener(event || {});
    } catch (_error) {
      // Keep subscriber fan-out resilient.
    }
  });
}

export function connectRealtime() {
  // Foundation hook: connect SSE or WebSocket here in future phases.
  return {
    disconnect() {
      // Placeholder for future realtime transport teardown.
    }
  };
}
