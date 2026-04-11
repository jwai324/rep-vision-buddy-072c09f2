import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ChevronDown, ChevronUp, RefreshCw, Check, ArrowRight, Sparkles, Loader2, Replace } from 'lucide-react';
import { EXERCISE_DATABASE, EQUIPMENT_LIST, type Exercise } from '@/data/exercises';
import { supabase } from '@/integrations/supabase/client';
import type { WorkoutTemplate, WorkoutProgram, TemplateExercise, SetType } from '@/types/workout';
import { toast } from 'sonner';

// ─── Types ───────────────────────────────────────────────────────────

interface UserInputs {
  goal: string;
  experience: string;
  daysPerWeek: number;
  sessionDuration: string;
  equipment: string[];
  injuries: string;
  splitPreference: string;
}

interface AIExercise {
  exercise_name: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  set_type: string;
  order: number;
  superset_group: number | null;
}

interface AITrainingDay {
  day_number: number;
  day_name: string;
  focus: string;
  exercises: AIExercise[];
}

interface AIProgram {
  program_name: string;
  goal: string;
  days_per_week: number;
  weeks: number;
  training_days: AITrainingDay[];
}

type ChatStep = 'goal' | 'experience' | 'daysPerWeek' | 'sessionDuration' | 'equipment' | 'injuries' | 'splitPreference' | 'summary';

interface ChatMessage {
  role: 'ai' | 'user';
  content: string;
  step?: ChatStep;
  chips?: string[];
  multiSelect?: boolean;
  freeText?: boolean;
}

const STEPS: ChatStep[] = ['goal', 'experience', 'daysPerWeek', 'sessionDuration', 'equipment', 'injuries', 'splitPreference', 'summary'];

const STEP_QUESTIONS: Record<ChatStep, string> = {
  goal: "What's your primary training goal?",
  experience: "How long have you been training consistently?",
  daysPerWeek: "How many days per week can you train?",
  sessionDuration: "How long is a typical session?",
  equipment: "What equipment do you have access to?",
  injuries: "Any injuries or body parts to avoid?",
  splitPreference: "Any split preference?",
  summary: "Here's your program configuration. Review and edit anything before generating.",
};

const STEP_CHIPS: Record<string, string[]> = {
  goal: ['Hypertrophy', 'Strength', 'Fat Loss', 'Endurance', 'General Fitness'],
  experience: ['Beginner (< 1 year)', 'Intermediate (1-3 years)', 'Advanced (3+ years)'],
  daysPerWeek: ['2', '3', '4', '5', '6'],
  sessionDuration: ['30 min', '45 min', '60 min', '75 min', '90 min'],
  equipment: ['Full Gym', 'Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight', 'Band', 'Kettlebell', 'EZ Bar', 'Trap Bar', 'Smith Machine', 'Landmine'],
  splitPreference: ['Upper/Lower', 'Push/Pull/Legs', 'Full Body', 'Bro Split', 'No preference — you decide'],
};

const ALL_EQUIPMENT = ['Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight', 'Band', 'Kettlebell', 'EZ Bar', 'Trap Bar', 'Smith Machine', 'Landmine'];

// ─── Onboarding Chat ─────────────────────────────────────────────────

interface AIProgramBuilderProps {
  onBack: () => void;
  onSaveProgram: (program: WorkoutProgram, templates: WorkoutTemplate[]) => void;
}

export const AIProgramBuilder: React.FC<AIProgramBuilderProps> = ({ onBack, onSaveProgram }) => {
  const [phase, setPhase] = useState<'chat' | 'generating' | 'review'>('chat');
  const [currentStep, setCurrentStep] = useState(0);
  const [inputs, setInputs] = useState<UserInputs>({
    goal: '', experience: '', daysPerWeek: 0, sessionDuration: '', equipment: [], injuries: '', splitPreference: '',
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typingVisible, setTypingVisible] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);
  const [injuryText, setInjuryText] = useState('');
  const [generatedProgram, setGeneratedProgram] = useState<AIProgram | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set([0]));
  const [swappingExercise, setSwappingExercise] = useState<{ dayIdx: number; exIdx: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50);
  }, []);

  // Initialize first question
  useEffect(() => {
    showAIMessage(0);
  }, []);

  const showAIMessage = (stepIndex: number) => {
    const step = STEPS[stepIndex];
    setTypingVisible(true);
    setTimeout(() => {
      setTypingVisible(false);
      const msg: ChatMessage = {
        role: 'ai',
        content: STEP_QUESTIONS[step],
        step,
        chips: STEP_CHIPS[step],
        multiSelect: step === 'equipment',
        freeText: step === 'injuries',
      };
      setMessages(prev => [...prev, msg]);
      setCurrentStep(stepIndex);
      scrollToBottom();
    }, 400);
  };

  const handleChipSelect = (value: string) => {
    const step = STEPS[currentStep];

    if (step === 'equipment') {
      if (value === 'Full Gym') {
        setSelectedEquipment(ALL_EQUIPMENT);
      } else {
        setSelectedEquipment(prev =>
          prev.includes(value) ? prev.filter(e => e !== value) : [...prev, value]
        );
      }
      return;
    }

    // Single select
    const userMsg: ChatMessage = { role: 'user', content: value };
    setMessages(prev => [...prev, userMsg]);

    const updated = { ...inputs };
    if (step === 'goal') updated.goal = value;
    else if (step === 'experience') updated.experience = value;
    else if (step === 'daysPerWeek') updated.daysPerWeek = parseInt(value);
    else if (step === 'sessionDuration') updated.sessionDuration = value;
    else if (step === 'splitPreference') updated.splitPreference = value;
    setInputs(updated);

    // Next step
    const next = currentStep + 1;
    if (next < STEPS.length) {
      showAIMessage(next);
    }
  };

  const confirmEquipment = () => {
    if (selectedEquipment.length === 0) {
      toast.error('Select at least one equipment type');
      return;
    }
    const userMsg: ChatMessage = { role: 'user', content: selectedEquipment.join(', ') };
    setMessages(prev => [...prev, userMsg]);
    setInputs(prev => ({ ...prev, equipment: selectedEquipment }));
    showAIMessage(currentStep + 1);
  };

  const confirmInjuries = (value: string) => {
    const userMsg: ChatMessage = { role: 'user', content: value || 'None' };
    setMessages(prev => [...prev, userMsg]);
    setInputs(prev => ({ ...prev, injuries: value || '' }));
    showAIMessage(currentStep + 1);
  };

  const goBack = () => {
    if (currentStep <= 0) return;
    // Remove messages from current and previous step answer
    const prevStep = STEPS[currentStep];
    const targetStep = currentStep - 1;
    // Remove all messages from targetStep answer onward
    setMessages(prev => {
      const idx = prev.findIndex(m => m.step === STEPS[targetStep]);
      if (idx >= 0) return prev.slice(0, idx);
      return prev;
    });
    showAIMessage(targetStep);
  };

  // ─── Summary Editing ────────────────────────────────────────────
  const [editingField, setEditingField] = useState<string | null>(null);

  const summaryFields = [
    { key: 'goal', label: 'Goal', value: inputs.goal },
    { key: 'experience', label: 'Experience', value: inputs.experience },
    { key: 'daysPerWeek', label: 'Days/Week', value: String(inputs.daysPerWeek) },
    { key: 'sessionDuration', label: 'Session Duration', value: inputs.sessionDuration },
    { key: 'equipment', label: 'Equipment', value: inputs.equipment.join(', ') },
    { key: 'injuries', label: 'Injuries', value: inputs.injuries || 'None' },
    { key: 'splitPreference', label: 'Split', value: inputs.splitPreference },
  ];

  const handleSummaryEdit = (key: string, value: string) => {
    if (key === 'daysPerWeek') setInputs(prev => ({ ...prev, daysPerWeek: parseInt(value) || prev.daysPerWeek }));
    else if (key === 'equipment') setInputs(prev => ({ ...prev, equipment: value.split(',').map(s => s.trim()).filter(Boolean) }));
    else setInputs(prev => ({ ...prev, [key]: value }));
    setEditingField(null);
  };

  // ─── Generation ─────────────────────────────────────────────────

  const generateProgram = async () => {
    setPhase('generating');

    // Filter exercises
    const difficultyLevel = inputs.experience.includes('Beginner') ? 1 : inputs.experience.includes('Intermediate') ? 2 : 3;
    const difficultyMap: Record<string, number> = { Beginner: 1, Intermediate: 2, Advanced: 3 };
    const injuryParts = inputs.injuries.toLowerCase().split(/[,&]/).map(s => s.trim()).filter(Boolean);

    const filtered = EXERCISE_DATABASE.filter(ex => {
      if (!inputs.equipment.includes(ex.equipment) && ex.equipment !== 'Bodyweight' && ex.equipment !== 'None') return false;
      if (difficultyMap[ex.difficulty] > difficultyLevel) return false;
      if (injuryParts.length > 0 && injuryParts.some(ip =>
        ex.primaryBodyPart.toLowerCase().includes(ip) ||
        ex.secondaryMuscles.some(m => m.toLowerCase().includes(ip))
      )) return false;
      return true;
    });

    try {
      const { data, error } = await supabase.functions.invoke('generate-program', {
        body: {
          userInputs: inputs,
          exercises: filtered.map(ex => ({
            name: ex.name,
            primaryBodyPart: ex.primaryBodyPart,
            equipment: ex.equipment,
            exerciseType: ex.exerciseType,
            movementPattern: ex.movementPattern,
          })),
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const program = data.program as AIProgram;

      // Validate exercise names
      const exerciseNames = new Set(EXERCISE_DATABASE.map(e => e.name));
      for (const day of program.training_days) {
        day.exercises = day.exercises.filter(ex => {
          if (exerciseNames.has(ex.exercise_name)) return true;
          // Try fuzzy match
          const match = EXERCISE_DATABASE.find(e =>
            e.name.toLowerCase() === ex.exercise_name.toLowerCase()
          );
          if (match) {
            ex.exercise_name = match.name;
            return true;
          }
          console.warn('Unmatched exercise:', ex.exercise_name);
          return false;
        });
      }

      setGeneratedProgram(program);
      setExpandedDays(new Set([0]));
      setPhase('review');
    } catch (e: any) {
      console.error('Program generation failed:', e);
      toast.error(e.message || 'Failed to generate program. Please try again.');
      setPhase('chat');
    }
  };

  // ─── Exercise Swap ──────────────────────────────────────────────

  const getSwapCandidates = (exercise: AIExercise): Exercise[] => {
    const current = EXERCISE_DATABASE.find(e => e.name === exercise.exercise_name);
    if (!current) return [];
    return EXERCISE_DATABASE.filter(ex =>
      ex.primaryBodyPart === current.primaryBodyPart &&
      ex.name !== current.name &&
      inputs.equipment.includes(ex.equipment)
    );
  };

  const swapExercise = (dayIdx: number, exIdx: number, newExercise: Exercise) => {
    if (!generatedProgram) return;
    const updated = { ...generatedProgram };
    updated.training_days = updated.training_days.map((day, di) => {
      if (di !== dayIdx) return day;
      return {
        ...day,
        exercises: day.exercises.map((ex, ei) => {
          if (ei !== exIdx) return ex;
          return { ...ex, exercise_name: newExercise.name };
        }),
      };
    });
    setGeneratedProgram(updated);
    setSwappingExercise(null);
  };

  // ─── Save ───────────────────────────────────────────────────────

  const saveProgram = () => {
    if (!generatedProgram) return;

    const programId = crypto.randomUUID();
    const templates: WorkoutTemplate[] = [];
    const programDays: WorkoutProgram['days'] = [];

    generatedProgram.training_days.forEach((day, i) => {
      const templateId = crypto.randomUUID();
      const templateExercises: TemplateExercise[] = day.exercises.map(ex => {
        const dbEx = EXERCISE_DATABASE.find(e => e.name === ex.exercise_name);
        const repsVal = ex.reps.includes('-') ? parseInt(ex.reps.split('-')[1]) : parseInt(ex.reps);
        return {
          exerciseId: dbEx?.id ?? ex.exercise_name.toLowerCase().replace(/\s+/g, '-'),
          sets: ex.sets,
          targetReps: repsVal || 10,
          setType: (ex.set_type as SetType) || 'normal',
          restSeconds: ex.rest_seconds,
        };
      });

      templates.push({ id: templateId, name: day.day_name, exercises: templateExercises });
      programDays.push({
        label: day.day_name,
        templateId,
        frequency: { type: 'weekly', weekday: (i + 1) % 7 }, // Mon=1, etc.
      });
    });

    const program: WorkoutProgram = {
      id: programId,
      name: generatedProgram.program_name,
      days: programDays,
      durationWeeks: generatedProgram.weeks || 4,
      startDate: new Date().toISOString().split('T')[0],
    };

    onSaveProgram(program, templates);
    toast.success("Your program is ready. Let's go. 💪");
  };

  // ─── Render ─────────────────────────────────────────────────────

  if (phase === 'generating') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 gap-4">
        <div className="relative">
          <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center animate-pulse">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <div className="absolute inset-0 w-16 h-16 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
        <p className="text-lg font-semibold text-foreground">Building your program…</p>
        <p className="text-sm text-muted-foreground text-center">Our AI coach is designing your personalized plan</p>
      </div>
    );
  }

  if (phase === 'review' && generatedProgram) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-border">
          <button onClick={() => setPhase('chat')} className="p-2 rounded-lg hover:bg-secondary">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-foreground">{generatedProgram.program_name}</h2>
            <p className="text-xs text-muted-foreground">{generatedProgram.days_per_week} days/week · {generatedProgram.weeks} weeks · {generatedProgram.goal}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={generateProgram}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Days */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {generatedProgram.training_days.map((day, dayIdx) => (
            <div key={dayIdx} className="bg-card rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => setExpandedDays(prev => {
                  const next = new Set(prev);
                  next.has(dayIdx) ? next.delete(dayIdx) : next.add(dayIdx);
                  return next;
                })}
                className="w-full flex items-center justify-between p-4"
              >
                <div className="text-left">
                  <p className="font-semibold text-foreground">{day.day_name}</p>
                  <p className="text-xs text-muted-foreground">{day.focus} · {day.exercises.length} exercises</p>
                </div>
                {expandedDays.has(dayIdx) ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              {expandedDays.has(dayIdx) && (
                <div className="border-t border-border">
                  {day.exercises.map((ex, exIdx) => (
                    <div key={exIdx} className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-b-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{ex.exercise_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {ex.sets} × {ex.reps} · {ex.rest_seconds}s rest
                          {ex.set_type !== 'normal' && ` · ${ex.set_type}`}
                        </p>
                      </div>
                      <button
                        onClick={() => setSwappingExercise(swappingExercise?.dayIdx === dayIdx && swappingExercise?.exIdx === exIdx ? null : { dayIdx, exIdx })}
                        className="ml-2 p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
                      >
                        <Replace className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {/* Swap picker */}
                  {swappingExercise?.dayIdx === dayIdx && (
                    <div className="p-3 bg-secondary/50 border-t border-border max-h-48 overflow-y-auto">
                      <p className="text-xs text-muted-foreground mb-2 font-medium">Swap with:</p>
                      <div className="space-y-1">
                        {getSwapCandidates(day.exercises[swappingExercise.exIdx]).map(candidate => (
                          <button
                            key={candidate.id}
                            onClick={() => swapExercise(dayIdx, swappingExercise.exIdx, candidate)}
                            className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-primary/10 text-foreground"
                          >
                            {candidate.name}
                            <span className="text-xs text-muted-foreground ml-2">{candidate.equipment}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Save */}
        <div className="p-4 border-t border-border">
          <Button variant="neon" size="lg" className="w-full font-bold" onClick={saveProgram}>
            <Check className="w-5 h-5 mr-2" /> Save Program
          </Button>
        </div>
      </div>
    );
  }

  // ─── Chat Phase ─────────────────────────────────────────────────

  const step = STEPS[currentStep];
  const isSummary = step === 'summary';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <button onClick={currentStep > 0 ? goBack : onBack} className="p-2 rounded-lg hover:bg-secondary">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-foreground">Build My Program</h2>
          <p className="text-xs text-muted-foreground">Step {Math.min(currentStep + 1, 7)} of 7</p>
        </div>
        <Sparkles className="w-5 h-5 text-primary" />
      </div>

      {/* Chat Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground rounded-br-md'
                : 'bg-card border border-border text-foreground rounded-bl-md'
            }`}>
              <p className="text-sm">{msg.content}</p>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {typingVisible && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* Summary card */}
        {isSummary && !typingVisible && (
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-foreground">Program Configuration</p>
            {summaryFields.map(field => (
              <div key={field.key} className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{field.label}</span>
                {editingField === field.key ? (
                  <Input
                    autoFocus
                    defaultValue={field.value}
                    className="w-40 h-7 text-xs"
                    onBlur={(e) => handleSummaryEdit(field.key, e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSummaryEdit(field.key, (e.target as HTMLInputElement).value)}
                  />
                ) : (
                  <button
                    onClick={() => setEditingField(field.key)}
                    className="text-xs text-foreground font-medium hover:text-primary transition-colors"
                  >
                    {field.value}
                  </button>
                )}
              </div>
            ))}
            <Button variant="neon" size="lg" className="w-full mt-4 font-bold" onClick={generateProgram}>
              <Sparkles className="w-4 h-4 mr-2" /> Generate My Program
            </Button>
          </div>
        )}
      </div>

      {/* Bottom Input Area */}
      {!isSummary && !typingVisible && (
        <div className="p-4 border-t border-border">
          {step === 'equipment' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {STEP_CHIPS.equipment.map(chip => {
                  const isFullGym = chip === 'Full Gym';
                  const isSelected = isFullGym
                    ? selectedEquipment.length === ALL_EQUIPMENT.length
                    : selectedEquipment.includes(chip);
                  return (
                    <button
                      key={chip}
                      onClick={() => handleChipSelect(chip)}
                      className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                      }`}
                    >
                      {chip}
                    </button>
                  );
                })}
              </div>
              {selectedEquipment.length > 0 && (
                <Button variant="neon" size="sm" className="w-full" onClick={confirmEquipment}>
                  Continue <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </div>
          ) : step === 'injuries' ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="e.g., lower back, left shoulder"
                  value={injuryText}
                  onChange={(e) => setInjuryText(e.target.value)}
                  className="flex-1"
                  onKeyDown={(e) => e.key === 'Enter' && confirmInjuries(injuryText)}
                />
                <Button variant="neon" size="sm" onClick={() => confirmInjuries(injuryText)}>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
              <button
                onClick={() => confirmInjuries('')}
                className="px-3 py-2 rounded-xl text-sm font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80"
              >
                None
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(STEP_CHIPS[step] ?? []).map(chip => (
                <button
                  key={chip}
                  onClick={() => handleChipSelect(chip)}
                  className="px-3 py-2 rounded-xl text-sm font-medium bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
