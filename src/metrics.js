import { EventEmitter } from 'events';

// Simple global metrics for live UI statistics
const emitter = new EventEmitter();

const counters = {
  llmCalls: 0,
  auggieCalls: 0,
};



export function incAuggieCalls() {
  counters.auggieCalls += 1;
  emitter.emit('update', { ...counters });
}

// Removed tool call metrics: no local tool runner remains

export function getMetrics() {
  return { ...counters };
}

export function onMetricsUpdate(listener) {
  emitter.on('update', listener);
  return () => emitter.off('update', listener);
}
