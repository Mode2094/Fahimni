import * as React from "react";

import { cn } from "@/lib/utils";

export function FnField({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="fn-field" className={cn("fn-field", className)} {...props} />;
}

export function FnLabel({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="fn-label" className={cn("fn-field__label", className)} {...props} />;
}

export function FnHint({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="fn-hint" className={cn("fn-field__hint", className)} {...props} />;
}

export function FnError({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="fn-error" role="alert" className={cn("fn-field__error", className)} {...props} />;
}

export function FnInput({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="fn-input" className={cn("fn-input", className)} {...props} />;
}

export function FnTextarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="fn-textarea" className={cn("fn-textarea", className)} {...props} />;
}

export function FnSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select data-slot="fn-select" className={cn("fn-select", className)} {...props} />;
}

export function FnInputGroup({
  className,
  icon,
  addon,
  children,
  ...props
}: React.ComponentProps<"div"> & { icon?: React.ReactNode; addon?: React.ReactNode }) {
  return (
    <div
      data-slot="fn-input-group"
      className={cn(
        "fn-input-group",
        icon ? "fn-input-group--icon-start" : undefined,
        addon ? "fn-input-group--addon" : undefined,
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="fn-input-group__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
      {addon ? <span className="fn-input-group__addon">{addon}</span> : null}
    </div>
  );
}
