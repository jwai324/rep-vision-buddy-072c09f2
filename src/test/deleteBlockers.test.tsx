import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TemplatesScreen } from '@/components/TemplatesScreen';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const Boom: React.FC = () => { throw new Error('kaboom'); };

describe('ErrorBoundary destructive action', () => {
  it('needs two taps, and Try Again never fires it', () => {
    const onReset = vi.fn();
    const discard = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary onReset={onReset} destructiveAction={{ label: 'Discard workout', onClick: discard }}>
        <Boom />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByText('Discard workout'));
    expect(discard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/tap again/i));
    expect(discard).toHaveBeenCalledTimes(1);
    expect(onReset).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('deleting a template a program still uses', () => {
  const template = { id: 'tpl-1', name: 'Push', exercises: [] };
  const renderScreen = (usedBy: (id: string) => string[]) => {
    const onDelete = vi.fn();
    render(
      <TemplatesScreen
        templates={[template]} usedBy={usedBy} onDelete={onDelete}
        onStart={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()} onShare={vi.fn()} onCreate={vi.fn()} onBack={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Delete'));
    return onDelete;
  };

  it('is refused and names the program', () => {
    const onDelete = renderScreen(() => ['PPL']);

    expect(screen.getByText(/used by "PPL"/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('still goes through when nothing references it', () => {
    const onDelete = renderScreen(() => []);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDelete).toHaveBeenCalledWith('tpl-1');
  });
});
