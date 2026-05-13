export type RestTimerSound = 'none' | 'chime' | 'opening-bell' | 'mario-kart';

export const REST_TIMER_SOUND_OPTIONS: { value: RestTimerSound; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'chime', label: 'Chime' },
  { value: 'opening-bell', label: 'Opening Bell' },
  { value: 'mario-kart', label: 'Mario Kart' },
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

const audioCache: Partial<Record<Exclude<RestTimerSound, 'none'>, HTMLAudioElement>> = {};

function getAudio(sound: Exclude<RestTimerSound, 'none'>): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  let audio = audioCache[sound];
  if (!audio) {
    audio = new Audio(SOUND_FILES[sound]);
    audio.preload = 'auto';
    audioCache[sound] = audio;
  }
  return audio;
}

export function preloadRestTimerSound(sound: RestTimerSound): void {
  if (sound === 'none') return;
  getAudio(sound);
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

function play(sound: Exclude<RestTimerSound, 'none'>): void {
  const audio = getAudio(sound);
  if (!audio) return;
  try {
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  } catch {
    // ignore — play may reject if autoplay is blocked
  }
}

/**
 * Schedule the rest-timer sound (and vibration when applicable) for a timer that has
 * `durationSeconds` left from right now. Returns a cancel function.
 *
 * - chime / opening-bell: vibrates at T-3s, T-2s, T-1s, then vibrates + plays at T=0.
 * - mario-kart: fires at 3.5s remaining (no vibration).
 * - none: no-op.
 */
export function scheduleRestTimerSound(durationSeconds: number): () => void {
  const sound = getRestTimerSound();
  if (sound === 'none' || durationSeconds <= 0 || typeof window === 'undefined') {
    return () => undefined;
  }

  preloadRestTimerSound(sound);

  if (sound === 'mario-kart') {
    const delayMs = Math.max(0, (durationSeconds - MARIO_KART_LEAD_SECONDS) * 1000);
    const handle = window.setTimeout(() => play(sound), delayMs);
    return () => window.clearTimeout(handle);
  }

  // Chime / Opening Bell: countdown vibrations at T-3, T-2, T-1, then vibrate+play at T=0.
  const handles: ReturnType<typeof window.setTimeout>[] = [];

  for (const secondsBefore of [3, 2, 1]) {
    const delay = (durationSeconds - secondsBefore) * 1000;
    if (delay > 0) {
      handles.push(window.setTimeout(() => vibrate(), delay));
    }
  }

  handles.push(window.setTimeout(() => {
    vibrate();
    play(sound);
  }, durationSeconds * 1000));

  return () => handles.forEach(h => window.clearTimeout(h));
}
