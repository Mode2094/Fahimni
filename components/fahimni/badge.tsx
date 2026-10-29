import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const badgeVariants = cva("fn-badge", {
  variants: {
    variant: {
      primary: "",
      mint: "fn-badge--mint",
      gold: "fn-badge--gold",
      sky: "fn-badge--sky",
      pink: "fn-badge--pink",
      danger: "fn-badge--danger",
      outline: "fn-badge--outline",
    },
    dot: {
      true: "fn-badge--live",
    },
  },
  defaultVariants: {
    variant: "primary",
  },
});

export function FnBadge({
  className,
  variant,
  dot,
  children,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="fn-badge"
      data-variant={variant ?? "primary"}
      className={cn(badgeVariants({ variant, dot }), className)}
      {...props}
    >
      {dot ? <span className="fn-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function FnChip({ className, ...props }: React.ComponentProps<"button">) {
  return <button type="button" data-slot="fn-chip" className={cn("fn-chip", className)} {...props} />;
}
