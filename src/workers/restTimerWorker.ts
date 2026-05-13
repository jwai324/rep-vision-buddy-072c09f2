/// <reference lib="webworker" />

// Workers are not throttled by tab visibility on modern browsers, so this
// ticks accurately even when the user backgrounds the app. Posted messages
// still land on the main thread's queue (which IS throttled when hidden) —
// reliable background audio comes from AudioContext scheduling in
// restTimerSound.ts, not from this tick stream.

declare const self: DedicatedWorkerGlobalScope;

type InMsg =
  | { type: 'start'; durationMs: number; startedAt: number }
  | { type: 'cancel' };

type OutMsg =
  | { type: 'tick'; remainingMs: number }
  | { type: 'done' };

let intervalId: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;
let durationMs = 0;
let runId = 0;

function tick(currentRun: number): void {
  if (currentRun !== runId) return;
  const remainingMs = durationMs - (Date.now() - startedAt);
  if (remainingMs <= 0) {
    stopInterval();
    post({ type: 'done' });
  } else {
    post({ type: 'tick', remainingMs });
  }
}

function post(msg: OutMsg): void {
  self.postMessage(msg);
}

function stopInterval(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

self.addEventListener('message', (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'start') {
    stopInterval();
    runId += 1;
    const myRun = runId;
    // Idempotent: re-sending start with the same (startedAt, durationMs)
    // produces identical remaining time, so the sync effect in the hook can
    // safely re-issue start without drift.
    startedAt = msg.startedAt;
    durationMs = msg.durationMs;
    tick(myRun);
    intervalId = setInterval(() => tick(myRun), 100);
  } else if (msg.type === 'cancel') {
    runId += 1;
    stopInterval();
  }
});

export {};
