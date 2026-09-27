import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/** Wraps the boundary + children with a key that changes on reset, forcing
 * a clean remount — crashed children keep their bad state otherwise. */
export const RemountingBoundary = ({ resetKey, children }: { resetKey: number; children: ReactNode }) => (
  <ErrorBoundary key={resetKey}>{children}</ErrorBoundary>
);

/**
 * to the nostr.black palette. Full-bleed crash page: error name/message,
 * open stack trace, try again / reload.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState & { resetCount: number }> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      resetCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by ErrorBoundary:', error, errorInfo);

    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState((s) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      resetCount: s.resetCount + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-black text-white p-8 font-['Lucida_Console','Consolas','Courier_New','monospace'] overflow-auto">
          <div className="max-w-4xl">
            <h1 className="text-2xl mb-6 font-bold">
              A problem has been detected and nostr.black needs to restart.
            </h1>

            <div className="space-y-4 text-sm leading-relaxed">
              <div className="mt-4">
                <div className="bg-white/10 p-4 border border-white/20">
                  <p className="mb-2 font-bold">{this.state.error?.name || 'Error'}</p>
                  <p>{this.state.error?.message || 'No error message available'}</p>
                </div>
              </div>

              {this.state.error?.stack && (
                <details className="mt-6" open>
                  <summary className="text-xs cursor-pointer hover:text-white/80">Stack trace</summary>
                  <pre className="mt-2 bg-white/10 p-2 overflow-auto max-h-48 text-[9px] leading-tight border border-white/20">
                    {this.state.error.stack}
                  </pre>
                </details>
              )}

              <div className="mt-12 flex gap-4">
                <button
                  onClick={this.handleReset}
                  className="px-6 py-2 bg-white text-black font-bold hover:bg-gray-200 transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="px-6 py-2 bg-white/10 border border-white hover:bg-white/20 transition-colors"
                >
                  Reload Page
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Keying on resetCount forces a clean remount after "Try Again" —
    // crashed children keep their bad state otherwise and re-throw.
    return <div key={this.state.resetCount}>{this.props.children}</div>;
  }
}
