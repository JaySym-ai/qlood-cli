// Simple CLI spinner for long-running tasks
export function startCliSpinner(message) {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  const base = `${message}`;
  process.stdout.write(base + ' ');
  const timer = setInterval(() => {
    const f = frames[i = (i + 1) % frames.length];
    process.stdout.write(`\r${base} ${f}`);
  }, 100);
  const stop = (finalMessage, ok = true) => {
    clearInterval(timer);
    const msg = finalMessage || base;
    process.stdout.write(`\r${msg} ${ok ? '✓' : '✗'}\n`);
  };
  return { stop };
}

