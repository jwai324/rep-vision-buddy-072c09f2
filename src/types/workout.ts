export type SetType = 'normal' | 'superset' | 'dropset' | 'failure' | 'warmup';

export type ExerciseId = string;

export interface DropSegment {
  weight: number;
  reps: number;
}

export interface WorkoutSet {
  setNumber: number;
  type: SetType;
  reps: number;
  weight?: number;
  rpe?: number;
  time?: number; // seconds — used for time-based exercises
  distance?: number; // meters — used for distance-based exercises
  drops?: DropSegment[];
}

export interface ExerciseLog {
  exerciseId: ExerciseId;
  exerciseName: string;
  sets: WorkoutSet[];
  supersetGroup?: number;
  note?: string;
}

export interface WorkoutSession {
  id: string;
  date: string;
  startedAt?: string; // ISO 8601 timestamp of when the workout began
  exercises: ExerciseLog[];
  duration: number; // seconds
  totalVolume: number;
  totalSets: number;
  totalReps: number;
  averageRpe?: number;
  note?: string;
  location?: string;
  isRestDay?: boolean;
  recoveryActivities?: RecoveryActivity[];
}

export interface TemplateExercise {
  exerciseId: ExerciseId;
  sets: number;
  targetReps: number | 'failure';
  setType: SetType;
  restSeconds: number;
  targetRpe?: number;
  supersetGroup?: number;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  exercises: TemplateExercise[];
}

export type DayFrequency =
  | { type: 'weekly'; weekday: number }           // 0=Sun,...6=Sat
  | { type: 'monthly'; dayOfMonth: number }       // 1-31
  | { type: 'everyNDays'; interval: number; startDate?: string };

export interface ProgramDay {
  label: string;
  templateId: string | 'rest';
  frequency?: DayFrequency;
}

export type ProgramSchedule =
  | { type: 'weekly'; weekdays: number[] }
  | { type: 'monthly'; dayOfMonth: number }
  | { type: 'everyNDays'; interval: number };

export interface WorkoutProgram {
  id: string;
  name: string;
  days: ProgramDay[];
  durationWeeks?: number;
  startDate?: string; // ISO date
  schedule?: ProgramSchedule;
}

export interface RecoveryActivity {
  id: string;
  activityId: string; // maps to ExerciseId in exercise database
  notes?: string;
  duration?: number; // minutes
  completed?: boolean;
}

export const RECOVERY_ACTIVITIES = [
  { id: 'cold-plunge', name: 'Cold Plunge', icon: '🧊', category: 'Recovery' },
  { id: 'compression-cuff', name: 'Compression Cuff', icon: '🦵', category: 'Recovery' },
  { id: 'active-rest', name: 'Active Rest', icon: '🚶', category: 'Active' },
  { id: 'stretching', name: 'Stretching', icon: '🧘', category: 'Mobility' },
  { id: 'foam-rolling', name: 'Foam Rolling', icon: '🪵', category: 'Mobility' },
  { id: 'sauna', name: 'Sauna', icon: '🔥', category: 'Recovery' },
  { id: 'massage', name: 'Massage', icon: '💆', category: 'Recovery' },
  { id: 'yoga', name: 'Yoga', icon: '🧘‍♀️', category: 'Active' },
  { id: 'swimming', name: 'Swimming', icon: '🏊', category: 'Active' },
  { id: 'walking', name: 'Walking', icon: '🚶‍♂️', category: 'Active' },
  { id: 'meditation', name: 'Meditation', icon: '🧠', category: 'Mental' },
  { id: 'sleep-focus', name: 'Sleep Focus', icon: '😴', category: 'Recovery' },
  { id: 'breathing-exercises', name: 'Breathing Exercises', icon: '🌬️', category: 'Mental' },
] as const;

export type RecoveryActivityId = typeof RECOVERY_ACTIVITIES[number]['id'];

export interface FutureWorkout {
  id: string;
  programId: string;
  date: string; // ISO date string
  templateId: string; // or 'rest'
  label: string;
  completed?: boolean;
  recoveryActivities?: RecoveryActivity[];
}

// Legacy lookup - now uses exercise database
import { EXERCISE_DATABASE, getBodyPartIcon } from '@/data/exercises';

export const EXERCISES: Record<string, { name: string; icon: string }> = Object.fromEntries(
  EXERCISE_DATABASE.map(ex => [ex.id, { name: ex.name, icon: getBodyPartIcon(ex.primaryBodyPart) }])
);

export const SET_TYPE_CONFIG: Record<SetType, { label: string; colorClass: string }> = {
  normal: { label: 'Normal', colorClass: 'bg-set-normal' },
  superset: { label: 'Superset', colorClass: 'bg-set-superset' },
  dropset: { label: 'Dropset', colorClass: 'bg-set-dropset' },
  failure: { label: 'To Failure', colorClass: 'bg-set-failure' },
  warmup: { label: 'Warm-up', colorClass: 'bg-yellow-500/20' },
};
