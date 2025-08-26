import { EventEmitter } from 'events';

// Simple global metrics for live UI statistics
const emitter = new EventEmitter();

const counters = {
  llmCalls: 0,
  auggieCalls: 0,
  toolCalls: 0,
  lastTool: '',
};

export function incLLMCalls() {
  counters.llmCalls += 1;
  emitter.emit('update', { ...counters });
}

export function incAuggieCalls() {
  counters.auggieCalls += 1;
  emitter.emit('update', { ...counters });
}

export function incToolCalls(toolName = '') {
  counters.toolCalls += 1;
  counters.lastTool = String(toolName || '');
  emitter.emit('update', { ...counters });
}

export function getMetrics() {
  return { ...counters };
}

export function onMetricsUpdate(listener) {
  emitter.on('update', listener);
  return () => emitter.off('update', listener);
}

