import React, { useMemo, useState } from 'react';
import { ChevronLeft, Target, GraduationCap, Dumbbell, AlertTriangle, Scale, Ruler, User, Cake, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EQUIPMENT_LIST, BODY_PARTS } from '@/data/exercises';
import { fromKg, toKg } from '@/utils/weightConversion';
import { format } from 'date-fns';
import type { UserProfile, BodyMeasurement, WeightUnit, Goal, ExperienceLevel, Sex } from '@/hooks/useStorage';

interface ProfileScreenProps {
  profile: UserProfile;
  bodyMeasurements: BodyMeasurement[];
  weightUnit: WeightUnit;
  onUpdateProfile: (updates: Partial<UserProfile>) => void;
  onAddBodyMeasurement: (weightKg: number, date?: string) => Promise<boolean>;
  onDeleteBodyMeasurement: (id: string) => Promise<boolean>;
  onBack: () => void;
}

const GOAL_OPTIONS: { value: Goal; label: string }[] = [
  { value: 'hypertrophy', label: 'Hypertrophy' },
  { value: 'strength', label: 'Strength' },
  { value: 'fat_loss', label: 'Fat Loss' },
  { value: 'endurance', label: 'Endurance' },
  { value: 'general', label: 'General Fitness' },
];

const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const CM_PER_IN = 2.54;
const toCm = (inches: number) => Math.round(inches * CM_PER_IN * 10) / 10;
const fromCm = (cm: number, unit: WeightUnit) => unit === 'kg' ? Math.round(cm * 10) / 10 : Math.round((cm / CM_PER_IN) * 10) / 10;

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="bg-card rounded-xl border border-border overflow-hidden">
    <div className="px-4 py-3 border-b border-border flex items-center gap-2">
      {icon}
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">{title}</p>
    </div>
    <div className="p-4">{children}</div>
  </div>
);

const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
      active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
    }`}
  >
    {children}
  </button>
);

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  profile, bodyMeasurements, weightUnit,
  onUpdateProfile, onAddBodyMeasurement, onDeleteBodyMeasurement, onBack,
}) => {
  const [bwDraft, setBwDraft] = useState('');
  const [bwSaving, setBwSaving] = useState(false);

  const heightUnit = weightUnit === 'kg' ? 'cm' : 'in';
  const heightDisplay = profile.heightCm != null ? String(fromCm(profile.heightCm, weightUnit)) : '';
  const [heightDraft, setHeightDraft] = useState(heightDisplay);
  const [ageDraft, setAgeDraft] = useState(profile.age != null ? String(profile.age) : '');

  const equipmentOptions = useMemo(() => EQUIPMENT_LIST.filter(e => e !== 'All'), []);
  const bodyPartOptions = useMemo(() => BODY_PARTS.filter(b => b !== 'All'), []);

  const toggleEquipment = (item: string) => {
    const set = new Set(profile.equipment);
    if (set.has(item)) set.delete(item);
    else set.add(item);
    onUpdateProfile({ equipment: Array.from(set) });
  };

  const toggleInjury = (item: string) => {
    const set = new Set(profile.injuries);
    if (set.has(item)) set.delete(item);
    else set.add(item);
    onUpdateProfile({ injuries: Array.from(set) });
  };

  const saveAge = () => {
    const n = parseInt(ageDraft, 10);
    if (!ageDraft.trim()) { onUpdateProfile({ age: null }); return; }
    if (Number.isNaN(n) || n < 13 || n > 120) return;
    onUpdateProfile({ age: n });
  };

  const saveHeight = () => {
    if (!heightDraft.trim()) { onUpdateProfile({ heightCm: null }); return; }
    const n = parseFloat(heightDraft);
    if (Number.isNaN(n) || n <= 0) return;
    const cm = weightUnit === 'kg' ? n : toCm(n);
    if (cm <= 0 || cm >= 300) return;
    onUpdateProfile({ heightCm: cm });
  };

  const logWeight = async () => {
    const n = parseFloat(bwDraft);
    if (Number.isNaN(n) || n <= 0) return;
    setBwSaving(true);
    const kg = toKg(n, weightUnit);
    const ok = await onAddBodyMeasurement(kg);
    setBwSaving(false);
    if (ok) setBwDraft('');
  };

  const latest = bodyMeasurements[0];
  const recent = bodyMeasurements.slice(0, 10);

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={onBack}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-extrabold text-foreground">Coach Profile</h1>
      </div>

      <p className="text-xs text-muted-foreground -mt-1">
        Fields here are sent to the AI coach so it can give relevant advice. Leave anything blank you'd rather not share.
      </p>

      <Section icon={<Target className="w-4 h-4 text-primary" />} title="Primary Goal">
        <div className="flex flex-wrap gap-2">
          {GOAL_OPTIONS.map(opt => (
            <Chip key={opt.value} active={profile.goal === opt.value} onClick={() => onUpdateProfile({ goal: profile.goal === opt.value ? null : opt.value })}>
              {opt.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section icon={<GraduationCap className="w-4 h-4 text-primary" />} title="Experience">
        <div className="flex flex-wrap gap-2">
          {EXPERIENCE_OPTIONS.map(opt => (
            <Chip key={opt.value} active={profile.experienceLevel === opt.value} onClick={() => onUpdateProfile({ experienceLevel: profile.experienceLevel === opt.value ? null : opt.value })}>
              {opt.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section icon={<Dumbbell className="w-4 h-4 text-primary" />} title="Equipment Available">
        <div className="flex flex-wrap gap-2">
          {equipmentOptions.map(item => (
            <Chip key={item} active={profile.equipment.includes(item)} onClick={() => toggleEquipment(item)}>
              {item}
            </Chip>
          ))}
        </div>
      </Section>

      <Section icon={<AlertTriangle className="w-4 h-4 text-amber-500" />} title="Injuries / Body Parts to Avoid">
        <div className="flex flex-wrap gap-2">
          {bodyPartOptions.map(item => (
            <Chip key={item} active={profile.injuries.includes(item)} onClick={() => toggleInjury(item)}>
              {item}
            </Chip>
          ))}
        </div>
      </Section>

      <Section icon={<User className="w-4 h-4 text-primary" />} title="Demographics">
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-[11px] text-muted-foreground font-semibold flex items-center gap-1 mb-1.5">
              <Cake className="w-3 h-3" /> Age
            </label>
            <Input
              type="number"
              inputMode="numeric"
              value={ageDraft}
              onChange={e => setAgeDraft(e.target.value)}
              onBlur={saveAge}
              placeholder="—"
              className="h-9 max-w-[120px]"
            />
          </div>

          <div>
            <p className="text-[11px] text-muted-foreground font-semibold mb-1.5">Sex</p>
            <div className="flex flex-wrap gap-2">
              {SEX_OPTIONS.map(opt => (
                <Chip key={opt.value} active={profile.sex === opt.value} onClick={() => onUpdateProfile({ sex: profile.sex === opt.value ? null : opt.value })}>
                  {opt.label}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground font-semibold flex items-center gap-1 mb-1.5">
              <Ruler className="w-3 h-3" /> Height ({heightUnit})
            </label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={heightDraft}
              onChange={e => setHeightDraft(e.target.value)}
              onBlur={saveHeight}
              placeholder="—"
              className="h-9 max-w-[140px]"
            />
          </div>
        </div>
      </Section>

      <Section icon={<Scale className="w-4 h-4 text-primary" />} title={`Bodyweight (${weightUnit})`}>
        <div className="flex flex-col gap-3">
          {latest && (
            <p className="text-xs text-muted-foreground">
              Latest: <span className="text-foreground font-semibold">{fromKg(latest.weightKg, weightUnit)} {weightUnit}</span>
              <span className="ml-2">on {format(new Date(latest.date + 'T00:00:00'), 'MMM d, yyyy')}</span>
            </p>
          )}
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={bwDraft}
              onChange={e => setBwDraft(e.target.value)}
              placeholder={`Log new (${weightUnit})`}
              className="h-9 flex-1 max-w-[180px]"
            />
            <Button onClick={logWeight} disabled={!bwDraft.trim() || bwSaving} size="sm" className="gap-1">
              <Plus className="w-3.5 h-3.5" />
              Log
            </Button>
          </div>

          {recent.length > 0 && (
            <div className="mt-1 border-t border-border pt-2 flex flex-col gap-1">
              {recent.map(m => (
                <div key={m.id} className="flex items-center justify-between text-xs">
                  <span className="text-foreground font-medium">{fromKg(m.weightKg, weightUnit)} {weightUnit}</span>
                  <span className="text-muted-foreground">{format(new Date(m.date + 'T00:00:00'), 'MMM d, yyyy')}</span>
                  <button
                    onClick={() => onDeleteBodyMeasurement(m.id)}
                    className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors"
                    aria-label="Delete measurement"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {bodyMeasurements.length > 10 && (
                <p className="text-[10px] text-muted-foreground italic pt-1">
                  Showing 10 most recent. {bodyMeasurements.length} total.
                </p>
              )}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
};
