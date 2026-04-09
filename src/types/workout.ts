export type SetType = 'normal' | 'superset' | 'dropset' | 'failure';

export type ExerciseId = 'squats' | 'pushups' | 'lunges' | 'bicep-curls' | 'shoulder-press';

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

export interface WorkoutProgram {
  id: string;
  name: string;
  days: ProgramDay[];
}

export const EXERCISES: Record<ExerciseId, { name: string; icon: string }> = {
  squats: { name: 'Squats', icon: '🏋️' },
  pushups: { name: 'Push-Ups', icon: '💪' },
  lunges: { name: 'Lunges', icon: '🦵' },
  'bicep-curls': { name: 'Bicep Curls', icon: '💪' },
  'shoulder-press': { name: 'Shoulder Press', icon: '🏋️' },
};

export const SET_TYPE_CONFIG: Record<SetType, { label: string; colorClass: string }> = {
  normal: { label: 'Normal', colorClass: 'bg-set-normal' },
  superset: { label: 'Superset', colorClass: 'bg-set-superset' },
  dropset: { label: 'Dropset', colorClass: 'bg-set-dropset' },
  failure: { label: 'To Failure', colorClass: 'bg-set-failure' },
};
