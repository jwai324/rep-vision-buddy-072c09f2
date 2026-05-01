import React, { useState, useMemo } from 'react';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { BODY_PARTS, EQUIPMENT_LIST, EXERCISE_DATABASE } from '@/data/exercises';
import type { MeasurementType } from '@/data/exercises';
import type { CustomExerciseInput } from '@/hooks/useCustomExercises';
import type { Exercise } from '@/data/exercises';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { isDuplicateExerciseName } from '@/utils/exerciseSearch';

const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'] as const;
const EXERCISE_TYPES = ['Compound', 'Isolation'] as const;
const BODY_PART_OPTIONS = BODY_PARTS.filter(b => b !== 'All');
const EQUIPMENT_OPTIONS = EQUIPMENT_LIST.filter(e => e !== 'All');
const MEASUREMENT_TYPES: MeasurementType[] = ['Reps', 'Reps + Weight', 'Time', 'Distance', 'Time + Distance'];

interface CreateExerciseFormProps {
  onSave: (input: CustomExerciseInput) => void;
  onCancel: () => void;
  editingExercise?: (Exercise & { isCustom: true; isRecovery: boolean }) | null;
}

export const CreateExerciseForm: React.FC<CreateExerciseFormProps> = ({ onSave, onCancel, editingExercise }) => {
  const { exercises: customExercises } = useCustomExercisesContext();
  const [name, setName] = useState(editingExercise?.name || '');
  const [bodyPart, setBodyPart] = useState<string | null>(editingExercise?.primaryBodyPart || null);
  const [equipment, setEquipment] = useState<string | null>(editingExercise?.equipment || null);
  const [difficulty, setDifficulty] = useState<'Beginner' | 'Intermediate' | 'Advanced' | null>(
    (editingExercise?.difficulty as any) || null
  );
  const [exerciseType, setExerciseType] = useState<'Compound' | 'Isolation'>(
    (editingExercise?.exerciseType as any) || 'Isolation'
  );
  const [isRecovery, setIsRecovery] = useState(editingExercise?.isRecovery || false);
  const [measurementType, setMeasurementType] = useState<MeasurementType | null>(
    editingExercise?.measurementType ?? null
  );

  const isDuplicate = useMemo(() => {
    if (!name.trim()) return false;
    return isDuplicateExerciseName(name, EXERCISE_DATABASE, customExercises, editingExercise?.id);
  }, [name, customExercises, editingExercise?.id]);

  const isValid = name.trim() && !isDuplicate && bodyPart && equipment && difficulty;

  const handleSave = () => {
    if (!isValid) return;
    onSave({
      name: name.trim(),
      primaryBodyPart: bodyPart!,
      equipment: equipment!,
      difficulty: difficulty!,
      exerciseType,
      movementPattern: 'Other',
      secondaryMuscles: [],
      isRecovery,
      measurementType: measurementType,
    });
  };

  const chipClass = (active: boolean) =>
    `px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`;

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4">
      <p className="text-sm font-bold text-foreground">{editingExercise ? 'Edit Exercise' : 'New Exercise'}</p>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Name *</label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Bulgarian Split Squat" className={`bg-secondary border-border ${isDuplicate ? 'border-destructive' : ''}`} />
        {isDuplicate && <p className="text-xs text-destructive mt-1">An exercise with this name already exists.</p>}
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Body Part *</label>
        {!bodyPart && <p className="text-[10px] text-muted-foreground/60 mb-1">Select a body part</p>}
        <div className="flex flex-wrap gap-1">
          {BODY_PART_OPTIONS.map(bp => (
            <button key={bp} onClick={() => setBodyPart(bp)} className={chipClass(bodyPart === bp)}>{bp}</button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Equipment *</label>
        {!equipment && <p className="text-[10px] text-muted-foreground/60 mb-1">Select equipment</p>}
        <div className="flex flex-wrap gap-1">
          {EQUIPMENT_OPTIONS.map(eq => (
            <button key={eq} onClick={() => setEquipment(eq)} className={chipClass(equipment === eq)}>{eq}</button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Difficulty *</label>
        {!difficulty && <p className="text-[10px] text-muted-foreground/60 mb-1">Select difficulty</p>}
        <div className="flex gap-1 flex-wrap">
          {DIFFICULTIES.map(d => (
            <button key={d} onClick={() => setDifficulty(d)} className={chipClass(difficulty === d)}>{d}</button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Type</label>
        <div className="flex gap-1 flex-wrap">
          {EXERCISE_TYPES.map(t => (
            <button key={t} onClick={() => setExerciseType(t)} className={chipClass(exerciseType === t)}>{t}</button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Measurement Type</label>
        <p className="text-[10px] text-muted-foreground/60 mb-1">How is this exercise measured? Leave blank for Reps + Weight (default)</p>
        <div className="flex gap-1 flex-wrap">
          {MEASUREMENT_TYPES.map(mt => (
            <button key={mt} onClick={() => setMeasurementType(measurementType === mt ? null : mt)} className={chipClass(measurementType === mt)}>{mt}</button>
          ))}
        </div>
      </div>

        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">Rest Day Activity</p>
            <p className="text-xs text-muted-foreground">Available on rest days</p>
          </div>
        </div>
        <Switch checked={isRecovery} onCheckedChange={setIsRecovery} />
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button className="flex-1" onClick={handleSave} disabled={!isValid}>
          {editingExercise ? 'Update' : 'Save'}
        </Button>
      </div>
    </div>
  );
};
