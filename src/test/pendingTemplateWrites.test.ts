import { describe, it, expect, beforeEach } from 'vitest';
import {
  readPendingTemplates,
  queuePendingTemplate,
  clearPendingTemplate,
  clearAllPendingTemplates,
  resolvePendingTemplates,
  type PendingTemplateWrite,
} from '@/utils/pendingTemplateWrites';
import type { WorkoutTemplate } from '@/types/workout';

const USER = 'user-1';
const tpl = (id: string, name = 'Push'): WorkoutTemplate => ({ id, name, exercises: [] });

describe('pending template writes', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty', () => {
    expect(readPendingTemplates(USER)).toEqual([]);
  });

  it('keeps a queued write across reads', () => {
    queuePendingTemplate(USER, tpl('t1'));
    expect(readPendingTemplates(USER).map(e => e.template.id)).toEqual(['t1']);
  });

  it('keeps only the newest attempt per template', () => {
    queuePendingTemplate(USER, tpl('t1', 'first'));
    queuePendingTemplate(USER, tpl('t1', 'second'));

    const pending = readPendingTemplates(USER);
    expect(pending).toHaveLength(1);
    expect(pending[0].template.name).toBe('second');
  });

  it('queues separate templates independently', () => {
    queuePendingTemplate(USER, tpl('t1'));
    queuePendingTemplate(USER, tpl('t2'));
    expect(readPendingTemplates(USER).map(e => e.template.id)).toEqual(['t1', 't2']);
  });

  it('drops a write once it lands', () => {
    queuePendingTemplate(USER, tpl('t1'));
    queuePendingTemplate(USER, tpl('t2'));
    clearPendingTemplate(USER, 't1');
    expect(readPendingTemplates(USER).map(e => e.template.id)).toEqual(['t2']);
  });

  it('expires a write too old to replay safely', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    queuePendingTemplate(USER, tpl('t1'), undefined, eightDaysAgo);
    queuePendingTemplate(USER, tpl('t2'));

    expect(readPendingTemplates(USER).map(e => e.template.id)).toEqual(['t2']);
  });

  it('keeps accounts on a shared device apart', () => {
    queuePendingTemplate(USER, tpl('t1'));
    queuePendingTemplate('user-2', tpl('t2'));

    expect(readPendingTemplates(USER).map(e => e.template.id)).toEqual(['t1']);
    expect(readPendingTemplates('user-2').map(e => e.template.id)).toEqual(['t2']);
  });

  it('clears every account on sign-out', () => {
    queuePendingTemplate(USER, tpl('t1'));
    queuePendingTemplate('user-2', tpl('t2'));
    clearAllPendingTemplates();

    expect(readPendingTemplates(USER)).toEqual([]);
    expect(readPendingTemplates('user-2')).toEqual([]);
  });

  it('treats a corrupt payload as nothing queued', () => {
    queuePendingTemplate(USER, tpl('t1'));
    const key = Object.keys(localStorage).find(k => k.includes('pending-templates'))!;
    localStorage.setItem(key, '{not json');
    expect(readPendingTemplates(USER)).toEqual([]);
  });

  it('ignores entries missing a template', () => {
    queuePendingTemplate(USER, tpl('t1'));
    const key = Object.keys(localStorage).find(k => k.includes('pending-templates'))!;
    localStorage.setItem(key, JSON.stringify([{ queuedAt: Date.now() }, { template: tpl('t2'), queuedAt: Date.now() }]));
    expect(readPendingTemplates(USER).map(e => e.template.id)).toEqual(['t2']);
  });
});

describe('the baseline a queued write was built on', () => {
  beforeEach(() => localStorage.clear());

  it('is stored with the entry', () => {
    queuePendingTemplate(USER, tpl('t1'), 'stamp-1');
    expect(readPendingTemplates(USER)[0].baseline).toBe('stamp-1');
  });

  it('is null for a template that did not exist locally', () => {
    queuePendingTemplate(USER, tpl('t1'), null);
    expect(readPendingTemplates(USER)[0].baseline).toBeNull();
  });

  it('is absent when none was given, so the entry reads as legacy', () => {
    queuePendingTemplate(USER, tpl('t1'));
    expect('baseline' in readPendingTemplates(USER)[0]).toBe(false);
  });

  it('survives a second failed save, whose own baseline is only the first attempt', () => {
    queuePendingTemplate(USER, tpl('t1', 'first'), 'stamp-1');
    queuePendingTemplate(USER, tpl('t1', 'second'), undefined);
    queuePendingTemplate(USER, tpl('t1', 'third'), 'stamp-local');

    const [entry] = readPendingTemplates(USER);
    expect(entry.template.name).toBe('third');
    expect(entry.baseline).toBe('stamp-1');
  });

  it('stays legacy when the first attempt was', () => {
    queuePendingTemplate(USER, tpl('t1', 'first'));
    queuePendingTemplate(USER, tpl('t1', 'second'), 'stamp-local');
    expect('baseline' in readPendingTemplates(USER)[0]).toBe(false);
  });
});

describe('resolvePendingTemplates', () => {
  const entry = (id: string, baseline?: string | null): PendingTemplateWrite => {
    const e: PendingTemplateWrite = { template: tpl(id), queuedAt: Date.now() };
    if (baseline !== undefined) e.baseline = baseline;
    return e;
  };
  const ids = (list: { template: { id: string } }[]) => list.map(e => e.template.id);

  it('replays a legacy entry whatever the row holds', () => {
    const { replay, conflicts } = resolvePendingTemplates(
      [entry('t1'), entry('t2')],
      [{ id: 't1', updatedAt: 'stamp-9' }],
    );
    expect(ids(replay)).toEqual(['t1', 't2']);
    expect(conflicts).toEqual([]);
  });

  it('replays a write built on the row the server still holds', () => {
    const { replay, conflicts } = resolvePendingTemplates(
      [entry('t1', 'stamp-1')],
      [{ id: 't1', updatedAt: 'stamp-1' }],
    );
    expect(ids(replay)).toEqual(['t1']);
    expect(conflicts).toEqual([]);
  });

  it('reports a row that changed since as a conflict', () => {
    const { replay, conflicts } = resolvePendingTemplates(
      [entry('t1', 'stamp-1')],
      [{ id: 't1', updatedAt: 'stamp-2' }],
    );
    expect(replay).toEqual([]);
    expect(conflicts.map(c => [c.entry.template.id, c.reason])).toEqual([['t1', 'changed']]);
  });

  it('reports a row that is gone as deleted', () => {
    const { replay, conflicts } = resolvePendingTemplates([entry('t1', 'stamp-1')], []);
    expect(replay).toEqual([]);
    expect(conflicts.map(c => c.reason)).toEqual(['deleted']);
  });

  it('replays a new template only while nothing on the server has its id', () => {
    expect(ids(resolvePendingTemplates([entry('t1', null)], []).replay)).toEqual(['t1']);

    const { replay, conflicts } = resolvePendingTemplates([entry('t1', null)], [{ id: 't1', updatedAt: 'stamp-1' }]);
    expect(replay).toEqual([]);
    expect(conflicts.map(c => c.reason)).toEqual(['changed']);
  });
});
