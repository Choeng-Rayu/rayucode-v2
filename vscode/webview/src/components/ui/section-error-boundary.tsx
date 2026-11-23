import * as React from "react";
import { QueryErrorResetBoundary } from "@tanstack/react-query";

import { ErrorState } from "@/components/ui/error-state";

export interface SectionErrorBoundaryProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

interface InnerErrorBoundaryProps extends SectionErrorBoundaryProps {
  onReset: () => void;
}

interface InnerErrorBoundaryState {
  error: Error | null;
}

class InnerSectionErrorBoundary extends React.Component<
  InnerErrorBoundaryProps,
  InnerErrorBoundaryState
> {
  state: InnerErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): InnerErrorBoundaryState {
    return { error };
  }

  handleRetry = () => {
    this.props.onReset();
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="p-4">
          <ErrorState
            title={this.props.title ?? "Unable to load section"}
            description={
              this.state.error.message ||
              "An unexpected runtime error occurred in this panel."
            }
            actionLabel="Reload section"
            onRetry={this.handleRetry}
            className={this.props.className}
          />
        </div>
      );
    }

    return this.props.children;
  }
}

export function SectionErrorBoundary({
  title,
  children,
  className,
}: SectionErrorBoundaryProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <InnerSectionErrorBoundary
          title={title}
          onReset={reset}
          className={className}
        >
          {children}
        </InnerSectionErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
