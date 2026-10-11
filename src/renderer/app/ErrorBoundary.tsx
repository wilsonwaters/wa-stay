import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { ArrowLeft, Copy, RotateCcw, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button, EmptyState, Notice, PageHeader } from '../components/ui';
import { ROUTES } from './routes';

interface BoundaryProps {
  children: ReactNode;
  /** What to show instead of `children` once something below has thrown. */
  fallback: (error: Error, details: string, reset: () => void) => ReactNode;
}

interface BoundaryState {
  error: Error | null;
  componentStack: string;
}

/** Catches a render error below it and shows `fallback` until `reset` is called. */
class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? '' });
    console.error('WA Stay caught a render error:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null, componentStack: '' });

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return this.props.fallback(error, errorDetails(error, componentStack), this.reset);
  }
}

/** The text "Copy error details" puts on the clipboard, for a bug report. */
export function errorDetails(error: Error, componentStack = ''): string {
  return [
    `${error.name}: ${error.message}`,
    error.stack ? `\nStack:\n${error.stack}` : '',
    componentStack ? `\nComponents:${componentStack}` : '',
    `\nWhere: ${typeof window === 'undefined' ? '' : window.location.hash || '#/'}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const reloadWindow = () => window.location.reload();

function AppErrorFallback({ details, onReload }: { details: string; onReload: () => void }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div>
        <EmptyState
          icon={<TriangleAlert size={24} />}
          title="WA Stay hit a problem"
          description="Something went wrong and this window can't carry on. Reloading usually fixes it. If it keeps happening, copy the error details into a bug report."
          actions={
            <>
              <Button leadingIcon={<RotateCcw size={18} />} onClick={onReload}>
                Reload WA Stay
              </Button>
              <Button variant="secondary" leadingIcon={<Copy size={18} />} onClick={copy}>
                Copy error details
              </Button>
            </>
          }
        />
        <p role="status" className="text-center text-sm text-fg-secondary">
          {copied === 'done' && 'Error details copied.'}
          {copied === 'failed' && "Couldn't copy the error details."}
        </p>
      </div>
    </div>
  );
}

/**
 * The last line of defence: anything that throws outside a route (the header, the tray, a
 * provider) replaces the whole window with a way to reload.
 */
export function AppErrorBoundary({
  children,
  onReload = reloadWindow,
}: {
  children: ReactNode;
  /** Reloads the window. Tests replace it: jsdom cannot reload. */
  onReload?: () => void;
}) {
  return (
    <Boundary
      fallback={(_error, details) => <AppErrorFallback details={details} onReload={onReload} />}
    >
      {children}
    </Boundary>
  );
}

function RouteErrorPanel({ error, reset }: { error: Error; reset: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-8">
      <PageHeader
        title="This page hit a problem"
        description="Something went wrong while showing this page. The rest of WA Stay still works: try again, or go back to Explore."
      />
      <Notice tone="danger" title="What went wrong" className="mt-6 max-w-2xl">
        {error.message || 'An unexpected error.'}
      </Notice>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button leadingIcon={<RotateCcw size={18} />} onClick={reset}>
          Try again
        </Button>
        <Button
          variant="secondary"
          leadingIcon={<ArrowLeft size={18} />}
          onClick={() => navigate(ROUTES.explore())}
        >
          Back to Explore
        </Button>
      </div>
    </div>
  );
}

/**
 * Wraps the routed page only, so the header and tray keep working when a page throws. The
 * shell keys it by pathname: going to another page starts with a fresh boundary.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Boundary
      fallback={(error, _details, reset) => <RouteErrorPanel error={error} reset={reset} />}
    >
      {children}
    </Boundary>
  );
}

export default AppErrorBoundary;
