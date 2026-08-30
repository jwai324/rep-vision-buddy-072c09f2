import { describe, it, expect, beforeEach } from 'vitest';
import {
  readPendingTemplates,
  queuePendingTemplate,
  clearPendingTemplate,
  clearAllPendingTemplates,
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
    queuePendingTemplate(USER, tpl('t1'), eightDaysAgo);
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
