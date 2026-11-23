/**
 * Top-level React error boundary so unexpected render errors show a recovery card instead of a white screen.
 */
import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { APP_NAME } from '../config/constants';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-6 text-center text-slate-100">
        <div className="w-full max-w-sm rounded-2xl bg-slate-900/95 p-6 ring-1 ring-slate-800 shadow-xl">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-400" />
          <h1 className="mt-3 text-base font-bold text-slate-100">Something went wrong</h1>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            {APP_NAME} hit an unexpected display error. Reload to return to your session.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reload
          </button>
        </div>
      </div>
    );
  }
}
