// Minimal event emitter: on(event, listener) returns an unsubscribe function.
/** @returns {{ on(event: string, listener: (...args: any[]) => void): () => void, emit(event: string, ...args: any[]): void }} */
// A listener that throws is logged and skipped, so one broken view can't
// stop the others (or the code that emitted the event).
export function createEmitter() {
  const listeners = new Map();
  return {
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return () => listeners.get(event).delete(listener);
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Error in a "${event}" listener:`, error);
        }
      }
    },
  };
}
