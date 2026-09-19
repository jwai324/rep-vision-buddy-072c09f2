import React, { useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import type { WorkoutTemplate } from '@/types/workout';
import { Button } from '@/components/ui/button';
import type { WeightUnit } from '@/hooks/useStorage';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { resolveTemplateSupersets } from '@/utils/templateSupersets';
import { blocksToExercises, templateToBlocks, type CustomExerciseLite, type TemplateBlock } from '@/utils/templateBlocks';
import { fingerprint } from '@/utils/draftFingerprint';
import { TemplateExerciseEditor, type BlocksUpdate } from '@/components/TemplateExerciseEditor';

interface TemplateBuilderProps {
  initial?: WorkoutTemplate;
  weightUnit?: WeightUnit;
  defaultRestSeconds?: number;
  onSave: (template: WorkoutTemplate) => void;
  onCancel: () => void;
}

const DRAFT_KEY = 'template_builder_draft';

/** What the draft was taken from; null for a template that does not exist yet. */
const templateSource = (template?: WorkoutTemplate): string | null =>
  template ? fingerprint({ name: template.name, exercises: template.exercises }) : null;

function loadDraft(
  initialTemplate?: WorkoutTemplate,
  weightUnit: WeightUnit = 'kg',
  customExercises?: CustomExerciseLite,
): { name: string; blocks: TemplateBlock[] } {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const draft = JSON.parse(raw);
      // Only restore if editing the same template (or both are new), and only
      // while that template is still the one the draft was taken from. A draft
      // abandoned on one device used to come up over a version saved since on
      // another (or by the coach, or an import), and Save wrote the stale one
      // back. A new template has no source to drift from; a draft written
      // before the source was recorded cannot be checked, so it is dropped.
      const sameTemplate = (draft.id ?? null) === (initialTemplate?.id ?? null);
      const sameSource = !initialTemplate || draft.source === templateSource(initialTemplate);
      if (sameTemplate && sameSource) {
        // A draft from before supersets became links may still carry the
        // old per-exercise pill, so it is resolved the same way a template is.
        const blocks: TemplateBlock[] = draft.blocks ?? [];
        return { name: draft.name ?? '', blocks: resolveTemplateSupersets(blocks) };
      }
    }
  } catch { /* ignore corrupt data */ }
  return {
    name: initialTemplate?.name ?? '',
    blocks: initialTemplate ? templateToBlocks(initialTemplate, weightUnit, customExercises) : [],
  };
}

/**
 * The blocks are derived once, in the state initialisers below, and a custom
 * exercise's input mode decides how its target is read in: before the custom
 * library has loaded every custom exercise reads as reps-and-weight, so an lbs
 * user's band level came in converted as kilograms (level 4 as 8.8) and went
 * back out as a fractional level. The library loads once per app start, so
 * this only ever waits on that first fetch.
 */
export const TemplateBuilder: React.FC<TemplateBuilderProps> = (props) => {
  const { loading } = useCustomExercisesContext();
  if (loading && props.initial) return null;
  return <LoadedTemplateBuilder {...props} />;
};

const LoadedTemplateBuilder: React.FC<TemplateBuilderProps> = ({ initial, weightUnit = 'kg', defaultRestSeconds = 90, onSave, onCancel }) => {
  const { exercises: customExercises } = useCustomExercisesContext();

  const [name, setName] = useState(() => loadDraft(initial, weightUnit, customExercises).name);
  const [blocks, setBlocks] = useState<TemplateBlock[]>(() => loadDraft(initial, weightUnit, customExercises).blocks);
  const onBlocksChange = useCallback((update: BlocksUpdate) => setBlocks(update), []);

  const source = useMemo(() => templateSource(initial), [initial]);
  React.useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: initial?.id ?? null, name, blocks, source }));
    } catch { /* quota exceeded, ignore */ }
  }, [name, blocks, initial?.id, source]);

  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }, []);

  const save = () => {
    if (!name.trim()) {
      toast.error('Enter a template name.');
      return;
    }
    if (blocks.length === 0) {
      toast.error('Add at least one exercise.');
      return;
    }
    clearDraft();
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      exercises: blocksToExercises(blocks, weightUnit, customExercises),
    });
    toast.success(`Template "${name.trim()}" saved.`);
  };

  const handleCancel = () => {
    clearDraft();
    onCancel();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-2">
        <button onClick={handleCancel} className="text-sm text-muted-foreground hover:text-foreground">✕</button>
        <div className="flex flex-col items-end gap-1">
          <Button
            variant="neon"
            size="sm"
            onClick={save}
            disabled={!name.trim() || blocks.length === 0}
            className="disabled:bg-muted disabled:bg-none disabled:text-muted-foreground disabled:shadow-none disabled:opacity-100"
          >
            Save Template
          </Button>
          {(!name.trim() || blocks.length === 0) && (
            <p className="text-[10px] text-muted-foreground">Add a name and at least one exercise.</p>
          )}
        </div>
      </div>

      {/* Template Name */}
      <div className="px-4 pb-3">
        <input
          type="text"
          placeholder="Template name..."
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full bg-transparent text-xl font-bold text-foreground placeholder:text-muted-foreground/50 outline-none border-b border-border pb-2 focus:border-primary transition-colors"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        <TemplateExerciseEditor
          blocks={blocks}
          onChange={onBlocksChange}
          weightUnit={weightUnit}
          defaultRestSeconds={defaultRestSeconds}
        />
      </div>
    </div>
  );
};
