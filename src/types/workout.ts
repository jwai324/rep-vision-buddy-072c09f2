export type SetType = 'normal' | 'superset' | 'dropset' | 'failure';

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
  drops?: DropSegment[];
}

export interface ExerciseLog {
  exerciseId: ExerciseId;
  exerciseName: string;
  sets: WorkoutSet[];
}

export interface WorkoutSession {
  id: string;
  date: string;
  exercises: ExerciseLog[];
  duration: number; // seconds
  totalVolume: number;
  totalSets: number;
  totalReps: number;
  averageRpe?: number;
}

export interface TemplateExercise {
  exerciseId: ExerciseId;
  sets: number;
  targetReps: number | 'failure';
  setType: SetType;
  restSeconds: number;
  targetRpe?: number;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  exercises: TemplateExercise[];
}

export interface ProgramDay {
  label: string;
  templateId: string | 'rest';
}

export type ProgramSchedule =
  | { type: 'weekly'; weekdays: number[] }       // 0=Sun,1=Mon,...6=Sat
  | { type: 'monthly'; dayOfMonth: number }       // 1-31
  | { type: 'everyNDays'; interval: number };     // 2,3,4...

export interface WorkoutProgram {
  id: string;
  name: string;
  days: ProgramDay[];
  schedule?: ProgramSchedule;
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
};
