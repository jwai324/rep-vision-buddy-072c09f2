export type RestTimerSound = 'none' | 'chime' | 'opening-bell' | 'mario-kart';

export const REST_TIMER_SOUND_OPTIONS: { value: RestTimerSound; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'chime', label: 'Chime' },
  { value: 'opening-bell', label: 'Opening Bell' },
  { value: 'mario-kart', label: 'Race Start' },
];

const STORAGE_KEY = 'restTimerSound';
const MARIO_KART_LEAD_SECONDS = 3.5;

const SOUND_FILES: Record<Exclude<RestTimerSound, 'none'>, string> = {
  'chime': '/sounds/chime.mp3',
  'opening-bell': '/sounds/opening-bell.mp3',
  'mario-kart': '/sounds/mario-kart-race-start.mp3',
};

const VALID_SOUNDS: ReadonlySet<RestTimerSound> = new Set(
  REST_TIMER_SOUND_OPTIONS.map(o => o.value),
);

type AudibleSound = Exclude<RestTimerSound, 'none'>;

const htmlAudioCache: Partial<Record<AudibleSound, HTMLAudioElement>> = {};
const audioBufferCache: Partial<Record<AudibleSound, AudioBuffer>> = {};
const audioBufferPending: Partial<Record<AudibleSound, Promise<AudioBuffer | null>>> = {};

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedAudioContext) return sharedAudioContext;
  const Ctor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedAudioContext = new Ctor();
  } catch {
    sharedAudioContext = null;
  }
  return sharedAudioContext;
}

function decodeBuffer(sound: AudibleSound): Promise<AudioBuffer | null> {
  const cached = audioBufferCache[sound];
  if (cached) return Promise.resolve(cached);
  const pending = audioBufferPending[sound];
  if (pending) return pending;
  const ctx = getAudioContext();
  if (!ctx) return Promise.resolve(null);
  const p: Promise<AudioBuffer | null> = (async () => {
    try {
      const res = await fetch(SOUND_FILES[sound]);
      if (!res.ok) return null;
      const data = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(data);
      audioBufferCache[sound] = buf;
      return buf;
    } catch {
      return null;
    } finally {
      delete audioBufferPending[sound];
    }
  })();
  audioBufferPending[sound] = p;
  return p;
}

function getHtmlAudio(sound: AudibleSound): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  let audio = htmlAudioCache[sound];
  if (!audio) {
    audio = new Audio(SOUND_FILES[sound]);
    audio.preload = 'auto';
    htmlAudioCache[sound] = audio;
  }
  return audio;
}

export function preloadRestTimerSound(sound: RestTimerSound): void {
  if (sound === 'none') return;
  // HTMLAudioElement keeps the existing fallback warm; the AudioBuffer is what
  // lets us schedule playback via AudioContext.start(when) so audio fires on
  // time even when the tab is backgrounded.
  getHtmlAudio(sound);
  void decodeBuffer(sound);
}

export function getRestTimerSound(): RestTimerSound {
  if (typeof window === 'undefined') return 'none';
  try {
    const value = window.localStorage.getItem(STORAGE_KEY) as RestTimerSound | null;
    if (value && VALID_SOUNDS.has(value)) return value;
  } catch {
    // ignore — Safari private mode etc.
  }
  return 'none';
}

export function setRestTimerSound(sound: RestTimerSound): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, sound);
  } catch {
    // ignore
  }
  preloadRestTimerSound(sound);
}

function vibrate(): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(200);
  } catch {
    // ignore — some browsers throw outside a user-gesture context
  }
}

function playViaHtmlAudio(sound: AudibleSound): void {
  const audio = getHtmlAudio(sound);
  if (!audio) return;
  try {
    audio.currentTime = 0;
    void audio.play().catch((e) => console.warn('[RestTimer] Audio play blocked:', e));
  } catch {
    // ignore — play may reject if autoplay is blocked
  }
}

// Schedule the sound to play `delayMs` from now. Returns a cancel function.
//
// AudioContext path: schedules the buffer source on the audio thread, so it
// fires on time even when the main thread is throttled (Android background
// tab). HTMLAudioElement path is the fallback when AudioContext or the
// decoded buffer is unavailable; setTimeout on the main thread IS throttled
// when hidden, so the visibility-change catch-up in useSessionRestTimer.ts
// is what saves that case.
function scheduleAt(sound: AudibleSound, delayMs: number): () => void {
  const ctx = getAudioContext();
  const buffer = audioBufferCache[sound];
  if (ctx && buffer) {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const when = ctx.currentTime + Math.max(0, delayMs / 1000);
    let stopped = false;
    try {
      source.start(when);
    } catch {
      // start() throws if context is closed; fall through to fallback.
    }
    return () => {
      if (stopped) return;
      stopped = true;
      try { source.stop(); } catch { /* already stopped or never started */ }
      try { source.disconnect(); } catch { /* already disconnected */ }
    };
  }
  const handle = window.setTimeout(() => playViaHtmlAudio(sound), delayMs);
  return () => window.clearTimeout(handle);
}

/**
 * Schedule the rest-timer sound (and vibration when applicable) for a timer
 * that has `durationSeconds` left from right now. Returns a cancel function.
 *
 * - chime / opening-bell: vibrates at T-3s, T-2s, T-1s, then vibrates + plays at T=0.
 * - mario-kart: fires at 3.5s remaining (no vibration).
 * - none: no-op.
 *
 * Vibration uses setTimeout because the Vibration API has no scheduling
 * primitive that survives a hidden tab (navigator.vibrate(pattern) is
 * cancelled when the document becomes inactive). Best-effort vibration is
 * fine — useSessionRestTimer.ts fires the catch-up vibration on
 * visibilitychange. iOS Safari fully suspends JS when the screen locks, so
 * neither vibration nor audio scheduling fires until unlock.
 */
export function scheduleRestTimerSound(durationSeconds: number): () => void {
  const sound = getRestTimerSound();
  if (sound === 'none' || durationSeconds <= 0 || typeof window === 'undefined') {
    return () => undefined;
  }

  preloadRestTimerSound(sound);

  if (sound === 'mario-kart') {
    if (durationSeconds <= MARIO_KART_LEAD_SECONDS) return () => undefined;
    const delayMs = (durationSeconds - MARIO_KART_LEAD_SECONDS) * 1000;
    return scheduleAt(sound, delayMs);
  }

  const cancellers: Array<() => void> = [];

  for (const secondsBefore of [3, 2, 1]) {
    const delay = (durationSeconds - secondsBefore) * 1000;
    if (delay > 0) {
      const handle = window.setTimeout(() => vibrate(), delay);
      cancellers.push(() => window.clearTimeout(handle));
    }
  }

  const finalDelayMs = durationSeconds * 1000;
  const vibrateHandle = window.setTimeout(() => vibrate(), finalDelayMs);
  cancellers.push(() => window.clearTimeout(vibrateHandle));
  cancellers.push(scheduleAt(sound, finalDelayMs));

  return () => cancellers.forEach(c => c());
}

/**
 * Play a sound immediately for settings preview — no vibration, no scheduling.
 * Called when the user selects a new sound in Settings so they can hear it.
 */
export function playPreviewSound(sound: RestTimerSound): void {
  if (sound === 'none') return;
  preloadRestTimerSound(sound);
  const ctx = getAudioContext();
  const buffer = audioBufferCache[sound];
  if (ctx && buffer) {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
      return;
    } catch {
      // fall through to HTMLAudioElement
    }
  }
  playViaHtmlAudio(sound);
}

/**
 * Fire the rest-timer completion sound + vibration immediately. Used by the
 * visibility-change catch-up path when a timer expired while the tab was
 * hidden: even if AudioContext fired the scheduled sound on time (Chrome),
 * vibration's setTimeout was throttled and the user missed the haptic, so
 * we re-fire on return.
 */
export function playRestTimerSoundNow(): void {
  const sound = getRestTimerSound();
  if (sound === 'none') return;
  if (sound !== 'mario-kart') vibrate();
  const ctx = getAudioContext();
  const buffer = audioBufferCache[sound];
  if (ctx && buffer) {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
      return;
    } catch {
      // fall through to HTMLAudioElement
    }
  }
  playViaHtmlAudio(sound);
}
