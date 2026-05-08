import React from 'react';
import { Check, MoreHorizontal, StickyNote, FileText, Flame, Timer, RefreshCw, Layers, ChevronDown, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RpeWheelPicker } from '@/components/RpeWheelPicker';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { ExerciseRestTimer, type TimerId } from '@/components/ExerciseRestTimer';
import { BAND_LEVELS, getBandLevelLabel, type ExerciseInputMode } from '@/utils/exerciseInputMode';
import { fromKg } from '@/utils/weightConversion';
import { formatMmSs, timeToSeconds } from '@/utils/timeFormat';
import type { WeightUnit } from '@/hooks/useStorage';
import type { ExerciseBlock, SetRow, DropRow, PersistedTimer, RunningSetState } from '@/types/activeSession';

export const timerIdKey = (id: TimerId) => `${id.type}-${id.blockIdx}-${id.setIdx ?? ''}-${id.dropIdx ?? ''}`;

/* ---------- RPE Picker Button ---------- */

const RpePickerButton: React.FC<{ id: string; value: string; onChange: (v: string) => void }> = ({ id, value, onChange }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className="w-full text-center text-xs bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary hover:bg-secondary/80 transition-colors"
        >
          {value || '—'}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-32 p-0">
        <RpeWheelPicker value={value} onChange={onChange} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
};

/* ---------- Time Input Button ---------- */

const TimeInputButton: React.FC<{ id: string; value: string; onChange: (v: string) => void; running?: boolean; small?: boolean }> = ({ id, value, onChange, running, small }) => {
  const [open, setOpen] = React.useState(false);
  const totalSeconds = timeToSeconds(value);
  const display = totalSeconds > 0 ? formatMmSs(totalSeconds) : '—';

  const [draftMin, setDraftMin] = React.useState('');
  const [draftSec, setDraftSec] = React.useState('');
  const secRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      const m = Math.floor(totalSeconds / 60);
      const s = totalSeconds % 60;
      setDraftMin(totalSeconds > 0 ? String(m) : '');
      setDraftSec(totalSeconds > 0 ? String(s).padStart(2, '0') : '');
    }
  }, [open, totalSeconds]);

  const commit = () => {
    const m = parseInt(draftMin, 10) || 0;
    const s = Math.min(59, Math.max(0, parseInt(draftSec, 10) || 0));
    const total = m * 60 + s;
    onChange(total > 0 ? String(total) : '');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className={`w-full text-center bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary hover:bg-secondary/80 transition-colors font-mono ${
            small ? 'text-[10px]' : 'text-sm'
          } ${running ? 'ring-1 ring-primary animate-pulse' : ''}`}
        >
          {display}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-52 p-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-center mb-2">Time</div>
        <div className="flex items-center justify-center gap-1">
          <div className="flex flex-col items-center">
            <input
              autoFocus
              type="number"
              inputMode="numeric"
              min={0}
              value={draftMin}
              onChange={e => setDraftMin(e.target.value.replace(/\D/g, '').slice(0, 3))}
              onFocus={e => e.target.select()}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                if (e.key === ':' || e.key === 'Tab') { e.preventDefault(); secRef.current?.focus(); }
              }}
              placeholder="0"
              className="w-16 text-center text-2xl font-mono bg-secondary rounded-md py-2 text-foreground outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
            />
            <span className="text-[9px] text-muted-foreground mt-0.5">min</span>
          </div>
          <span className="text-2xl font-mono font-bold text-foreground pb-4">:</span>
          <div className="flex flex-col items-center">
            <input
              ref={secRef}
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              value={draftSec}
              onChange={e => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 2);
                setDraftSec(v);
              }}
              onFocus={e => e.target.select()}
              onBlur={() => {
                const n = parseInt(draftSec, 10);
                if (!isNaN(n)) setDraftSec(String(Math.min(59, n)).padStart(2, '0'));
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
              }}
              placeholder="00"
              className="w-16 text-center text-2xl font-mono bg-secondary rounded-md py-2 text-foreground outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
            />
            <span className="text-[9px] text-muted-foreground mt-0.5">sec</span>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => { onChange(''); setOpen(false); }}
            className="flex-1 text-xs py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80"
          >
            Clear
          </button>
          <button
            onClick={commit}
            className="flex-1 text-xs py-1.5 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90"
          >
            Done
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

/* ---------- Header helpers ---------- */

const RpeHeaderPopover: React.FC = () => (
  <Popover>
    <PopoverTrigger asChild>
      <button className="text-center w-full text-xs font-medium text-muted-foreground hover:text-primary transition-colors underline decoration-dotted underline-offset-2">RPE</button>
    </PopoverTrigger>
    <PopoverContent side="top" align="center" className="w-64 p-3 text-xs leading-relaxed text-foreground">
      <p className="font-semibold mb-1">Rate of Perceived Exertion (RPE)</p>
      <p className="text-muted-foreground">A subjective 1–10 scale measuring how hard an exercise feels.</p>
    </PopoverContent>
  </Popover>
);

const TimerHeaderPopover: React.FC = () => (
  <Popover>
    <PopoverTrigger asChild>
      <button className="text-center w-full text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
        <Timer className="w-3 h-3 mx-auto" />
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="center" className="w-56 p-3 text-xs leading-relaxed text-foreground">
      <p className="font-semibold mb-1">Time elapsed</p>
      <p className="text-muted-foreground">Time it took to complete the set, captured automatically when you start and finish a set.</p>
    </PopoverContent>
  </Popover>
);

const CheckHeader: React.FC = () => (
  <span className="text-center"><Check className="w-3 h-3 mx-auto" /></span>
);

/* ---------- Grid helpers ---------- */

function getGridCols(mode: ExerciseInputMode): string {
  switch (mode) {
    case 'time': return 'grid-cols-[32px_1fr_1fr_30px_36px]';
    case 'time-distance': return 'grid-cols-[32px_1fr_1fr_1fr_36px]';
    case 'distance': return 'grid-cols-[32px_1fr_1fr_36px]';
    case 'reps': return 'grid-cols-[32px_1fr_1fr_42px_30px_36px]';
    case 'band':
    case 'reps-weight':
    default: return 'grid-cols-[32px_1fr_1fr_1fr_42px_30px_36px]';
  }
}

const SetTableHeader: React.FC<{ inputMode: ExerciseInputMode; weightUnit: WeightUnit }> = ({ inputMode, weightUnit }) => {
  const cols = getGridCols(inputMode);
  switch (inputMode) {
    case 'time':
      return (
        <div className={`grid ${cols} gap-1 text-xs font-medium text-muted-foreground mb-1 px-1`}>
          <span>Set</span>
          <span className="text-center">Time</span>
          <RpeHeaderPopover />
          <TimerHeaderPopover />
          <CheckHeader />
        </div>
      );
    case 'time-distance':
      return (
        <div className={`grid ${cols} gap-1 text-xs font-medium text-muted-foreground mb-1 px-1`}>
          <span>Set</span>
          <span className="text-center">Time</span>
          <span className="text-center">km</span>
          <RpeHeaderPopover />
          <CheckHeader />
        </div>
      );
    case 'distance':
      return (
        <div className={`grid ${cols} gap-1 text-xs font-medium text-muted-foreground mb-1 px-1`}>
          <span>Set</span>
          <span className="text-center">km</span>
          <RpeHeaderPopover />
          <CheckHeader />
        </div>
      );
    case 'reps':
      return (
        <div className={`grid ${cols} gap-1 text-xs font-medium text-muted-foreground mb-1 px-1`}>
          <span>Set</span>
          <span className="text-center">Previous</span>
          <span className="text-center">Reps</span>
          <RpeHeaderPopover />
          <TimerHeaderPopover />
          <CheckHeader />
        </div>
      );
    case 'band':
      return (
        <div className={`grid ${cols} gap-1 text-xs font-medium text-muted-foreground mb-1 px-1`}>
          <span>Set</span>
          <span className="text-center">Previous</span>
          <span className="text-center">Band</span>
          <span className="text-center">Reps</span>
          <RpeHeaderPopover />
          <TimerHeaderPopover />
          <CheckHeader />
        </div>
      );
    case 'reps-weight':
    default:
      return (
        <div className={`grid ${cols} gap-1 text-xs font-medium text-muted-foreground mb-1 px-1`}>
          <span>Set</span>
          <span className="text-center">Previous</span>
          <span className="text-center">{weightUnit}</span>
          <span className="text-center">Reps</span>
          <RpeHeaderPopover />
          <TimerHeaderPopover />
          <CheckHeader />
        </div>
      );
  }
};

/* ---------- Input navigation ---------- */

const FIELD_ORDER = ['weight', 'reps', 'rpe'] as const;

function buildInputId(blockIdx: number, setIdx: number, field: string, dropIdx?: number) {
  return dropIdx !== undefined
    ? `input-${blockIdx}-${setIdx}-d${dropIdx}-${field}`
    : `input-${blockIdx}-${setIdx}-${field}`;
}

function getBlockRows(block: ExerciseBlock): { setIdx: number; dropIdx?: number }[] {
  const rows: { setIdx: number; dropIdx?: number }[] = [];
  for (let si = 0; si < block.sets.length; si++) {
    rows.push({ setIdx: si });
    const drops = block.sets[si].drops;
    if (drops) {
      for (let di = 0; di < drops.length; di++) {
        rows.push({ setIdx: si, dropIdx: di });
      }
    }
  }
  return rows;
}

function handleInputNext(e: React.KeyboardEvent<HTMLInputElement>, blocks: ExerciseBlock[], blockIdx: number, setIdx: number, field: string, dropIdx?: number) {
  if (e.key !== 'Enter') return;
  e.preventDefault();

  const block = blocks[blockIdx];
  const rows = getBlockRows(block);
  const currentRowIdx = rows.findIndex(r => r.setIdx === setIdx && r.dropIdx === dropIdx);
  const currentFieldIdx = FIELD_ORDER.indexOf(field as typeof FIELD_ORDER[number]);

  if (currentFieldIdx < FIELD_ORDER.length - 1) {
    const nextField = FIELD_ORDER[currentFieldIdx + 1];
    const nextId = buildInputId(blockIdx, setIdx, nextField, dropIdx);
    const el = document.getElementById(nextId) as HTMLInputElement | null;
    if (el) { el.focus(); return; }
  }

  if (currentRowIdx < rows.length - 1) {
    const nextRow = rows[currentRowIdx + 1];
    const nextId = buildInputId(blockIdx, nextRow.setIdx, FIELD_ORDER[0], nextRow.dropIdx);
    const el = document.getElementById(nextId) as HTMLInputElement | null;
    if (el) { el.focus(); return; }
  }

  if (blockIdx < blocks.length - 1) {
    const nextBlock = blocks[blockIdx + 1];
    const nextRows = getBlockRows(nextBlock);
    if (nextRows.length > 0) {
      const firstRow = nextRows[0];
      const nextId = buildInputId(blockIdx + 1, firstRow.setIdx, FIELD_ORDER[0], firstRow.dropIdx);
      const el = document.getElementById(nextId) as HTMLInputElement | null;
      if (el) { el.focus(); return; }
    }
  }

  (e.target as HTMLInputElement).blur();
}

/* ---------- Exercise Menu ---------- */

const EXERCISE_MENU_ITEMS = [
  { icon: FileText, label: 'Add Note' },
  { icon: StickyNote, label: 'Add Sticky Note' },
  { icon: Flame, label: 'Add Warm-up Sets' },
  { icon: Timer, label: 'Update Rest Timer' },
  { icon: RefreshCw, label: 'Replace Exercise' },
  { icon: Layers, label: 'Create Superset' },
  { icon: ChevronDown, label: 'Drop Sets', toggle: true },
  { icon: Trash2, label: 'Remove Exercise', destructive: true },
] as const;

/* ---------- ExerciseTable Props ---------- */

export interface ExerciseTableProps {
  block: ExerciseBlock;
  blockIdx: number;
  weightUnit: WeightUnit;
  blocks: ExerciseBlock[];
  stickyNote: string;
  activeTimer: PersistedTimer | null;
  restRecords: Record<string, number>;
  previousSets: { weight?: number; reps: number; rpe?: number; time?: number }[];
  inputMode: ExerciseInputMode;
  onUpdateSet: (blockIdx: number, setIdx: number, field: keyof SetRow, value: string | boolean | number) => void;
  onToggleComplete: (blockIdx: number, setIdx: number) => void;
  onAddSet: (blockIdx: number) => void;
  onAddDrop: (blockIdx: number, setIdx: number) => void;
  onUpdateDrop: (blockIdx: number, setIdx: number, dropIdx: number, field: keyof DropRow, value: string | boolean) => void;
  onRemoveSet: (blockIdx: number, setIdx: number) => void;
  onRemoveDrop: (blockIdx: number, setIdx: number, dropIdx: number) => void;
  onMenuAction: (action: string, blockIdx: number) => void;
  onStartTimer: (id: TimerId, duration: number) => void;
  onSkipTimer: () => void;
  onExtendTimer: (delta?: number) => void;
  onTitleTap?: () => void;
  isEditMode?: boolean;
  runningSet?: RunningSetState | null;
  onStartNextSet?: (blockIdx: number) => void;
  onStopSet?: () => void;
  hideHeaderName?: boolean;
  hideTimers?: boolean;
}

/* ---------- ExerciseTable Component ---------- */

export const ExerciseTable: React.FC<ExerciseTableProps> = ({ block, blockIdx, weightUnit, blocks, stickyNote, activeTimer, restRecords, previousSets, inputMode, onUpdateSet, onToggleComplete, onAddSet, onAddDrop, onUpdateDrop, onRemoveSet, onRemoveDrop, onMenuAction, onStartTimer, onSkipTimer, onExtendTimer, onTitleTap, isEditMode, runningSet, onStartNextSet, onStopSet, hideHeaderName, hideTimers }) => {
  const isRunningHere = runningSet?.blockIdx === blockIdx;
  const [menuOpen, setMenuOpen] = React.useState(false);
  return (
    <div>
      {/* Exercise Header */}
      <div className="flex items-center justify-between mb-1 gap-2">
        {hideHeaderName ? (
          <div className="flex-1" />
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onTitleTap?.(); }}
            className="text-sm font-semibold text-primary text-left hover:underline focus:outline-none focus:underline truncate"
          >
            {block.exerciseName}
          </button>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {!isEditMode && onStartNextSet && (
            <button
              onClick={() => (isRunningHere ? onStopSet?.() : onStartNextSet(blockIdx))}
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-colors ${
                isRunningHere
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
            >
              {isRunningHere ? 'Stop set' : 'Start next set'}
            </button>
          )}
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button className="text-muted-foreground hover:text-foreground p-1">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-1">
            {EXERCISE_MENU_ITEMS.map(item => (
              <button
                key={item.label}
                onClick={() => { setMenuOpen(false); onMenuAction(item.label, blockIdx); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                  'destructive' in item && item.destructive
                    ? 'text-destructive hover:bg-destructive/10'
                    : 'text-foreground hover:bg-secondary'
                }`}
              >
                <item.icon className="w-4 h-4" />
                {'toggle' in item && item.toggle ? (
                  <span className="flex-1 flex items-center justify-between">
                    <span>{item.label}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${block.dropSetsEnabled ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                      {block.dropSetsEnabled ? 'ON' : 'OFF'}
                    </span>
                  </span>
                ) : (
                  item.label
                )}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        </div>
      </div>

      {/* Sticky Note display */}
      {stickyNote && (
        <div
          className="mb-2 px-2 py-1.5 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-200 flex items-start gap-1.5 cursor-pointer hover:bg-yellow-500/20 transition-colors"
          onClick={() => onMenuAction('Add Sticky Note', blockIdx)}
        >
          <StickyNote className="w-3 h-3 mt-0.5 shrink-0 text-yellow-400" />
          {stickyNote}
        </div>
      )}

      {/* Session Note display */}
      {block.note && (
        <div
          className="mb-2 px-2 py-1.5 rounded-md bg-primary/5 border border-primary/20 text-xs text-muted-foreground flex items-start gap-1.5 cursor-pointer hover:bg-primary/10 transition-colors"
          onClick={() => onMenuAction('Add Note', blockIdx)}
        >
          <FileText className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
          {block.note}
        </div>
      )}

      {/* Table Header */}
      <SetTableHeader inputMode={inputMode} weightUnit={weightUnit} />

      {/* Set Rows */}
      {block.sets.map((set, setIdx) => {
        const superscripts = ['¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
        const gridCols = getGridCols(inputMode);
        const setLabel = set.type === 'warmup' ? `W${set.setNumber}` : set.setNumber;
        const setLabelClass = `text-xs font-bold text-center ${set.type === 'warmup' ? 'text-yellow-400' : 'text-muted-foreground'}`;
        const completeBtn = (
          <button
            id={blockIdx === 0 && setIdx === 0 ? 'tutorial-complete-set' : undefined}
            onClick={() => onToggleComplete(blockIdx, setIdx)}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
              set.completed ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
            }`}
          >
            <Check className="w-4 h-4" />
          </button>
        );

        const renderSetRow = () => {
          switch (inputMode) {
            case 'time':
              return (
                <div className={`grid ${gridCols} gap-1 items-center py-1.5 px-1 rounded-md ${set.completed ? 'bg-primary/10' : ''}`}>
                  <span className={setLabelClass}>{setLabel}</span>
                  <TimeInputButton id={buildInputId(blockIdx, setIdx, 'time')} value={set.time} onChange={v => onUpdateSet(blockIdx, setIdx, 'time', v)} running={runningSet?.blockIdx === blockIdx && runningSet?.setIdx === setIdx} />
                  <RpePickerButton id={buildInputId(blockIdx, setIdx, 'rpe')} value={set.rpe} onChange={v => onUpdateSet(blockIdx, setIdx, 'rpe', v)} />
                  <span />
                  {completeBtn}
                </div>
              );
            case 'time-distance':
              return (
                <div className={`grid ${gridCols} gap-1 items-center py-1.5 px-1 rounded-md ${set.completed ? 'bg-primary/10' : ''}`}>
                  <span className={setLabelClass}>{setLabel}</span>
                  <TimeInputButton id={buildInputId(blockIdx, setIdx, 'time')} value={set.time} onChange={v => onUpdateSet(blockIdx, setIdx, 'time', v)} running={runningSet?.blockIdx === blockIdx && runningSet?.setIdx === setIdx} />
                  <input
                    id={buildInputId(blockIdx, setIdx, 'distance')}
                    type="number"
                    inputMode="decimal"
                    value={set.distance ?? ''}
                    onChange={e => onUpdateSet(blockIdx, setIdx, 'distance' as keyof SetRow, e.target.value)}
                    onFocus={e => e.target.value && e.target.select()}
                    placeholder="—"
                    className="w-full text-center text-base bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                  />
                  <RpePickerButton id={buildInputId(blockIdx, setIdx, 'rpe')} value={set.rpe} onChange={v => onUpdateSet(blockIdx, setIdx, 'rpe', v)} />
                  {completeBtn}
                </div>
              );
            case 'distance':
              return (
                <div className={`grid ${gridCols} gap-1 items-center py-1.5 px-1 rounded-md ${set.completed ? 'bg-primary/10' : ''}`}>
                  <span className={setLabelClass}>{setLabel}</span>
                  <input
                    id={buildInputId(blockIdx, setIdx, 'distance')}
                    type="number"
                    inputMode="decimal"
                    value={set.distance ?? ''}
                    onChange={e => onUpdateSet(blockIdx, setIdx, 'distance' as keyof SetRow, e.target.value)}
                    onFocus={e => e.target.value && e.target.select()}
                    placeholder="—"
                    className="w-full text-center text-base bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                  />
                  <RpePickerButton id={buildInputId(blockIdx, setIdx, 'rpe')} value={set.rpe} onChange={v => onUpdateSet(blockIdx, setIdx, 'rpe', v)} />
                  {completeBtn}
                </div>
              );
            case 'reps': {
              const workingSetIndex = block.sets.slice(0, setIdx).filter(s => s.type !== 'warmup').length;
              const prevSet = set.type !== 'warmup' ? previousSets[workingSetIndex] : undefined;
              return (
                <div id={blockIdx === 0 && setIdx === 0 ? 'tutorial-set-row' : undefined}
                  className={`grid ${gridCols} gap-1 items-center py-1.5 px-1 rounded-md ${set.completed ? 'bg-primary/10' : ''}`}>
                  <span className={setLabelClass}>{setLabel}</span>
                  {prevSet ? (
                    <button type="button" onClick={() => {
                      if (prevSet.reps !== undefined) onUpdateSet(blockIdx, setIdx, 'reps', String(prevSet.reps));
                      if (prevSet.rpe !== undefined) onUpdateSet(blockIdx, setIdx, 'rpe', String(prevSet.rpe));
                    }} className="text-xs text-muted-foreground text-center truncate w-full hover:text-primary hover:bg-primary/10 rounded-md py-0.5 transition-colors cursor-pointer" title="Tap to copy">
                      {`${prevSet.reps} reps`}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground text-center">—</span>
                  )}
                  <input
                    id={blockIdx === 0 && setIdx === 0 ? 'tutorial-reps-input' : buildInputId(blockIdx, setIdx, 'reps')}
                    type="number" inputMode="numeric" value={set.reps}
                    onChange={e => onUpdateSet(blockIdx, setIdx, 'reps', e.target.value)}
                    onFocus={e => e.target.value && e.target.select()} placeholder="—"
                    className="w-full text-center text-base bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                  />
                  <RpePickerButton id={buildInputId(blockIdx, setIdx, 'rpe')} value={set.rpe} onChange={v => onUpdateSet(blockIdx, setIdx, 'rpe', v)} />
                  <TimeInputButton id={buildInputId(blockIdx, setIdx, 'time')} value={set.time} onChange={v => onUpdateSet(blockIdx, setIdx, 'time', v)} running={runningSet?.blockIdx === blockIdx && runningSet?.setIdx === setIdx} small />
                  {completeBtn}
                </div>
              );
            }
            case 'band':
            case 'reps-weight':
            default: {
              const workingSetIndex = block.sets.slice(0, setIdx).filter(s => s.type !== 'warmup').length;
              const prevSet = set.type !== 'warmup' ? previousSets[workingSetIndex] : undefined;
              return (
                <div id={blockIdx === 0 && setIdx === 0 ? 'tutorial-set-row' : undefined}
                  className={`grid ${gridCols} gap-1 items-center py-1.5 px-1 rounded-md ${set.completed ? 'bg-primary/10' : ''}`}>
                  <span className={setLabelClass}>{setLabel}</span>
                  {prevSet ? (
                    <button type="button" onClick={() => {
                      if (prevSet.weight !== undefined) onUpdateSet(blockIdx, setIdx, 'weight', String(Math.round(fromKg(prevSet.weight, weightUnit))));
                      if (prevSet.reps !== undefined) onUpdateSet(blockIdx, setIdx, 'reps', String(prevSet.reps));
                      if (prevSet.rpe !== undefined) onUpdateSet(blockIdx, setIdx, 'rpe', String(prevSet.rpe));
                      if (prevSet.time !== undefined) onUpdateSet(blockIdx, setIdx, 'time', String(prevSet.time));
                    }} className="text-xs text-muted-foreground text-center truncate w-full hover:text-primary hover:bg-primary/10 rounded-md py-0.5 transition-colors cursor-pointer" title="Tap to copy to current set">
                      {`${prevSet.weight != null ? Math.round(fromKg(prevSet.weight!, weightUnit)) : '—'} × ${prevSet.reps}`}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground text-center">—</span>
                  )}
                  {inputMode === 'band' ? (
                    <select id={buildInputId(blockIdx, setIdx, 'weight')} value={set.weight}
                      onChange={e => onUpdateSet(blockIdx, setIdx, 'weight', e.target.value)}
                      className="w-full text-center text-base bg-secondary/60 rounded-md py-1.5 text-foreground outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer">
                      <option value="">—</option>
                      {BAND_LEVELS.map(b => (<option key={b.level} value={b.level.toString()}>{getBandLevelLabel(b.level, weightUnit)}</option>))}
                    </select>
                  ) : (
                    <input id={blockIdx === 0 && setIdx === 0 ? 'tutorial-weight-input' : buildInputId(blockIdx, setIdx, 'weight')}
                      type="number" inputMode="decimal" value={set.weight}
                      onChange={e => onUpdateSet(blockIdx, setIdx, 'weight', e.target.value)}
                      onKeyDown={e => handleInputNext(e, blocks, blockIdx, setIdx, 'weight')}
                      onFocus={e => e.target.value && e.target.select()} placeholder="—"
                      className="w-full text-center text-base bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto" />
                  )}
                  <input id={blockIdx === 0 && setIdx === 0 ? 'tutorial-reps-input' : buildInputId(blockIdx, setIdx, 'reps')}
                    type="number" inputMode="numeric" value={set.reps}
                    onChange={e => onUpdateSet(blockIdx, setIdx, 'reps', e.target.value)}
                    onKeyDown={e => handleInputNext(e, blocks, blockIdx, setIdx, 'reps')}
                    onFocus={e => e.target.value && e.target.select()} placeholder="—"
                    className="w-full text-center text-base bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto" />
                  <RpePickerButton id={blockIdx === 0 && setIdx === 0 ? 'tutorial-rpe' : buildInputId(blockIdx, setIdx, 'rpe')} value={set.rpe} onChange={v => onUpdateSet(blockIdx, setIdx, 'rpe', v)} />
                  <TimeInputButton id={buildInputId(blockIdx, setIdx, 'time')} value={set.time} onChange={v => onUpdateSet(blockIdx, setIdx, 'time', v)} running={runningSet?.blockIdx === blockIdx && runningSet?.setIdx === setIdx} small />
                  {completeBtn}
                </div>
              );
            }
          }
        };

        const renderDropRow = (drop: DropRow, dropIdx: number) => {
          const dropLabel = `${set.setNumber}D${superscripts[dropIdx] ?? `${dropIdx + 1}`}`;
          const dropCompleteBtn = (
            <button onClick={() => onUpdateDrop(blockIdx, setIdx, dropIdx, 'completed', !drop.completed)}
              className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${drop.completed ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground hover:text-foreground'}`}>
              <Check className="w-4 h-4" />
            </button>
          );
          const baseClass = `grid ${gridCols} gap-1 items-center py-1.5 px-1 rounded-md ml-4 border-l-2 border-set-dropset/40 ${drop.completed ? 'bg-primary/10' : ''}`;

          switch (inputMode) {
            case 'time':
              return (
                <div className={baseClass}>
                  <span className="text-xs font-bold text-set-dropset text-center">{dropLabel}</span>
                  <TimeInputButton id={buildInputId(blockIdx, setIdx, 'time', dropIdx)} value={drop.time ?? ''} onChange={v => onUpdateDrop(blockIdx, setIdx, dropIdx, 'time', v)} running={runningSet?.blockIdx === blockIdx && runningSet?.setIdx === setIdx && runningSet?.dropIdx === dropIdx} />
                  <RpePickerButton id={buildInputId(blockIdx, setIdx, 'rpe', dropIdx)} value={drop.rpe} onChange={v => onUpdateDrop(blockIdx, setIdx, dropIdx, 'rpe', v)} />
                  <span />
                  {dropCompleteBtn}
                </div>
              );
            case 'time-distance':
              return (
                <div className={baseClass}>
                  <span className="text-xs font-bold text-set-dropset text-center">{dropLabel}</span>
                  <TimeInputButton id={buildInputId(blockIdx, setIdx, 'time', dropIdx)} value={drop.time ?? ''} onChange={v => onUpdateDrop(blockIdx, setIdx, dropIdx, 'time', v)} running={runningSet?.blockIdx === blockIdx && runningSet?.setIdx === setIdx && runningSet?.dropIdx === dropIdx} />
                  <input id={buildInputId(blockIdx, setIdx, 'distance', dropIdx)} type="number" inputMode="decimal" value={drop.distance ?? ''}
                    onChange={e => onUpdateDrop(blockIdx, setIdx, dropIdx, 'distance' as keyof DropRow, e.target.value)}
                    placeholder="—" className="w-full text-center text-base bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto" />
                  <RpePickerButton id={buildInputId(blockIdx, setIdx, 'rpe', dropIdx)} value={drop.rpe} onChange={v => onUpdateDrop(blockIdx, setIdx, dropIdx, 'rpe', v)} />
                  {dropCompleteBtn}
                </div>
              );
            case 'distance':
              return (
                <div className={baseClass}>
                  <span className="text-xs font-bold text-set-dropset text-center">{dropLabel}</span>
                  <input id={buildInputId(blockIdx, setIdx, 'distance', dropIdx)} type="number" inputMode="decimal" value={drop.distance ?? ''}
                    onChange={e => onUpdateDrop(blockIdx, setIdx, dropIdx, 'distance' as keyof DropRow, e.target.value)}
                    placeholder="—" className="w-full text-center text-base bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto" />
                  <RpePickerButton id={buildInputId(blockIdx, setIdx, 'rpe', dropIdx)} value={drop.rpe} onChange={v => onUpdateDrop(blockIdx, setIdx, dropIdx, 'rpe', v)} />
                  {dropCompleteBtn}
                </div>
              );
            case 'reps':
              return (
                <div className={baseClass}>
                  <span className="text-xs font-bold text-set-dropset text-center">{dropLabel}</span>
                  <span className="text-xs text-muted-foreground text-center">—</span>
                  <input id={buildInputId(blockIdx, setIdx, 'reps', dropIdx)} type="number" inputMode="numeric" value={drop.reps}
                    onChange={e => onUpdateDrop(blockIdx, setIdx, dropIdx, 'reps', e.target.value)} placeholder="—"
                    className="w-full text-center text-base bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto" />
                  <RpePickerButton id={buildInputId(blockIdx, setIdx, 'rpe', dropIdx)} value={drop.rpe} onChange={v => onUpdateDrop(blockIdx, setIdx, dropIdx, 'rpe', v)} />
                  <TimeInputButton id={buildInputId(blockIdx, setIdx, 'time', dropIdx)} value={drop.time ?? ''} onChange={v => onUpdateDrop(blockIdx, setIdx, dropIdx, 'time', v)} running={runningSet?.blockIdx === blockIdx && runningSet?.setIdx === setIdx && runningSet?.dropIdx === dropIdx} small />
                  {dropCompleteBtn}
                </div>
              );
            default:
              return (
                <div className={baseClass}>
                  <span className="text-xs font-bold text-set-dropset text-center">{dropLabel}</span>
                  <span className="text-xs text-muted-foreground text-center">—</span>
                  {inputMode === 'band' ? (
                    <select id={buildInputId(blockIdx, setIdx, 'weight', dropIdx)} value={drop.weight}
                      onChange={e => onUpdateDrop(blockIdx, setIdx, dropIdx, 'weight', e.target.value)}
                      className="w-full text-center text-base bg-secondary/60 rounded-md py-1.5 text-foreground outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer">
                      <option value="">—</option>
                      {BAND_LEVELS.map(b => (<option key={b.level} value={b.level.toString()}>{getBandLevelLabel(b.level, weightUnit)}</option>))}
                    </select>
                  ) : (
                    <input id={buildInputId(blockIdx, setIdx, 'weight', dropIdx)} type="number" inputMode="decimal" value={drop.weight}
                      onChange={e => onUpdateDrop(blockIdx, setIdx, dropIdx, 'weight', e.target.value)}
                      onKeyDown={e => handleInputNext(e, blocks, blockIdx, setIdx, 'weight', dropIdx)} placeholder="—"
                      className="w-full text-center text-base bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto" />
                  )}
                  <input id={buildInputId(blockIdx, setIdx, 'reps', dropIdx)} type="number" inputMode="numeric" value={drop.reps}
                    onChange={e => onUpdateDrop(blockIdx, setIdx, dropIdx, 'reps', e.target.value)}
                    onKeyDown={e => handleInputNext(e, blocks, blockIdx, setIdx, 'reps', dropIdx)} placeholder="—"
                    className="w-full text-center text-base bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto" />
                  <RpePickerButton id={buildInputId(blockIdx, setIdx, 'rpe', dropIdx)} value={drop.rpe} onChange={v => onUpdateDrop(blockIdx, setIdx, dropIdx, 'rpe', v)} />
                  <TimeInputButton id={buildInputId(blockIdx, setIdx, 'time', dropIdx)} value={drop.time ?? ''} onChange={v => onUpdateDrop(blockIdx, setIdx, dropIdx, 'time', v)} running={runningSet?.blockIdx === blockIdx && runningSet?.setIdx === setIdx && runningSet?.dropIdx === dropIdx} small />
                  {dropCompleteBtn}
                </div>
              );
          }
        };

        return (
          <React.Fragment key={setIdx}>
            <SwipeToDelete onDelete={() => onRemoveSet(blockIdx, setIdx)}>
              {renderSetRow()}
            </SwipeToDelete>

            {/* Drop rows */}
            {set.drops?.map((drop, dropIdx) => (
              <SwipeToDelete key={`drop-${setIdx}-${dropIdx}`} onDelete={() => onRemoveDrop(blockIdx, setIdx, dropIdx)}>
                {renderDropRow(drop, dropIdx)}
              </SwipeToDelete>
            ))}

            {/* Add Drop button for any set - only when dropsets enabled */}
            {block.dropSetsEnabled && (
              <button
                onClick={() => onAddDrop(blockIdx, setIdx)}
                className="ml-4 py-1 px-3 text-xs text-set-dropset/70 hover:text-set-dropset transition-colors"
              >
                + Add Dropset
              </button>
            )}

            {/* Between-set rest timer */}
            {!hideTimers && setIdx < block.sets.length - 1 && (() => {
              const betweenSetId: TimerId = { type: 'set', blockIdx, setIdx };
              const betweenSetKey = timerIdKey(betweenSetId);
              const isBetweenSetActive = activeTimer !== null && timerIdKey(activeTimer.id) === betweenSetKey;
              return (
                <ExerciseRestTimer
                  timerId={betweenSetId}
                  defaultDuration={block.restSeconds}
                  variant="between"
                  isActive={isBetweenSetActive}
                  remaining={isBetweenSetActive ? Math.ceil((activeTimer!.startedAtEpoch + activeTimer!.duration * 1000 - Date.now()) / 1000) : 0}
                  totalDuration={isBetweenSetActive ? activeTimer!.originalDuration : 0}
                  recordedRest={restRecords[betweenSetKey] ?? null}
                  onStart={onStartTimer}
                  onSkip={onSkipTimer}
                  onExtend={onExtendTimer}
                />
              );
            })()}
          </React.Fragment>
        );
      })}

      {/* Add Set */}
      <button
        onClick={() => onAddSet(blockIdx)}
        className="w-full py-2 mt-1 rounded-md bg-secondary/40 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
      >
        + Add Set
      </button>
    </div>
  );
};
