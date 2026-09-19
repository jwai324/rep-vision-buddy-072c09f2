import React from 'react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  /** Rendered beside the fallback, for a control that must survive the crash (the bug-report handle). */
  fallbackExtra?: React.ReactNode;
  onReset?: () => void;
  /**
   * A second, destructive way out (e.g. "Discard workout"). It takes two taps:
   * the first turns the label into a confirmation, the second fires. Try Again
   * is the button people reach for reflexively, so it must never be the one
   * that throws data away.
   */
  destructiveAction?: { label: string; confirmLabel?: string; onClick: () => void };
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  armed: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, armed: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, armed: false };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, armed: false });
    this.props.onReset?.();
  };

  handleDestructive = () => {
    if (!this.state.armed) {
      this.setState({ armed: true });
      return;
    }
    this.setState({ hasError: false, error: null, armed: false });
    this.props.destructiveAction?.onClick();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[200px] flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-lg font-bold text-foreground">
            {this.props.fallbackTitle ?? 'Something went wrong'}
          </h2>
          <p className="text-sm text-muted-foreground max-w-md">
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <Button variant="outline" onClick={this.handleReset}>
            Try Again
          </Button>
          {this.props.destructiveAction && (
            <Button variant="ghost" className="text-set-failure" onClick={this.handleDestructive}>
              {this.state.armed
                ? (this.props.destructiveAction.confirmLabel ?? `Tap again to ${this.props.destructiveAction.label.toLowerCase()}`)
                : this.props.destructiveAction.label}
            </Button>
          )}
          {this.props.fallbackExtra}
        </div>
      );
    }

    return this.props.children;
  }
}
