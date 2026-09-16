import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ExerciseClip } from '@/components/ExerciseClip';
import { setClipModeOverride } from '@/config/exerciseClips';
import type { ExerciseClipAsset } from '@/hooks/useExerciseClip';

const clip: ExerciseClipAsset = {
  exerciseId: 'air-squat',
  webmUrl: 'https://cdn.example/exercise-clips/air-squat-0123456789ab.webm',
  mp4Url: 'https://cdn.example/exercise-clips/air-squat-abcdef012345.mp4',
  posterUrl: 'https://cdn.example/exercise-clips/air-squat-fedcba987654.webp',
  width: 512,
  height: 288,
  durationMs: 5700,
};

const video = () => document.querySelector('video');
const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  setClipModeOverride(null);
  localStorage.clear();
});

describe('ExerciseClip', () => {
  it('opaque mode: one explicit mp4 source on a white card, no <source> children', () => {
    render(<ExerciseClip clip={clip} name="Air Squat" mode="opaque" />);
    const el = video()!;
    expect(el).toHaveAttribute('src', clip.mp4Url);
    expect(el.querySelectorAll('source')).toHaveLength(0);
    const box = screen.getByTestId('exercise-clip');
    expect(box).toHaveAttribute('data-clip-mode', 'opaque');
    expect(box.className).toContain('bg-white');
  });

  it('alpha mode: the webm over a transparent container', () => {
    render(<ExerciseClip clip={clip} name="Air Squat" mode="alpha" />);
    expect(video()).toHaveAttribute('src', clip.webmUrl);
    const box = screen.getByTestId('exercise-clip');
    expect(box).toHaveAttribute('data-clip-mode', 'alpha');
    expect(box.className).toContain('bg-transparent');
    expect(box.className).not.toContain('bg-white');
  });

  it('reserves the box from the row dimensions before anything loads', () => {
    render(<ExerciseClip clip={clip} name="Air Squat" />);
    expect(screen.getByTestId('exercise-clip').style.aspectRatio).toBe('512 / 288');
  });

  it('loops, muted, inline, with the poster set', () => {
    render(<ExerciseClip clip={clip} name="Air Squat" />);
    const el = video()!;
    expect(el).toHaveAttribute('autoplay');
    expect(el).toHaveAttribute('loop');
    expect(el).toHaveAttribute('playsinline');
    expect(el).toHaveAttribute('poster', clip.posterUrl);
    expect(el.muted).toBe(true);
    expect(el).toHaveAccessibleName('Air Squat demonstration');
  });

  it('shows the poster and never mounts a video under prefers-reduced-motion', () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    render(<ExerciseClip clip={clip} name="Air Squat" />);
    expect(video()).toBeNull();
    expect(screen.getByRole('img', { name: 'Air Squat demonstration' })).toHaveAttribute('src', clip.posterUrl);
  });

  it('falls back to the poster when the video errors, and to an empty box when the poster errors too', () => {
    render(<ExerciseClip clip={clip} name="Air Squat" />);
    fireEvent.error(video()!);
    expect(video()).toBeNull();
    const poster = screen.getByRole('img', { name: 'Air Squat demonstration' });
    expect(poster).toHaveAttribute('src', clip.posterUrl);

    fireEvent.error(poster);
    expect(screen.queryByRole('img')).toBeNull();
    expect(video()).toBeNull();
    const box = screen.getByTestId('exercise-clip');
    expect(box).toBeInTheDocument();
    expect(box.style.aspectRatio).toBe('512 / 288');
  });

  it('a failure in one mode does not condemn the other source', () => {
    render(<ExerciseClip clip={clip} name="Air Squat" />);
    fireEvent.error(video()!);
    expect(video()).toBeNull();
    act(() => setClipModeOverride('alpha'));
    expect(video()).toHaveAttribute('src', clip.webmUrl);
  });

  it('follows the dev override at runtime without a remount of the parent', () => {
    render(<ExerciseClip clip={clip} name="Air Squat" />);
    expect(video()).toHaveAttribute('src', clip.mp4Url);
    act(() => setClipModeOverride('alpha'));
    expect(video()).toHaveAttribute('src', clip.webmUrl);
    expect(screen.getByTestId('exercise-clip')).toHaveAttribute('data-clip-mode', 'alpha');
    act(() => setClipModeOverride(null));
    expect(video()).toHaveAttribute('src', clip.mp4Url);
  });

  it('an explicit mode prop wins over the app-wide mode', () => {
    act(() => setClipModeOverride('alpha'));
    render(<ExerciseClip clip={clip} name="Air Squat" mode="opaque" />);
    expect(video()).toHaveAttribute('src', clip.mp4Url);
  });
});
