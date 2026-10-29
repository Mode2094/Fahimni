import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const cardVariants = cva("fn-card", {
  variants: {
    variant: {
      default: "",
      flat: "fn-card--flat",
      elevated: "fn-card--elevated",
      tinted: "fn-card--tinted",
      hero: "fn-card--hero",
      gold: "fn-card--gold",
    },
    interactive: {
      true: "fn-card--interactive",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export function FnCard({
  className,
  variant,
  interactive,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-slot="fn-card"
      data-variant={variant ?? "default"}
      className={cn(cardVariants({ variant, interactive }), className)}
      {...props}
    />
  );
}

export function FnCardHead({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="fn-card-head" className={cn("fn-card__head", className)} {...props} />;
}

export function FnCardTitle({
  className,
  as: Comp = "h3",
  ...props
}: React.ComponentProps<"h3"> & { as?: "h1" | "h2" | "h3" }) {
  return <Comp data-slot="fn-card-title" className={cn("fn-card__title", className)} {...props} />;
}

export function FnCardText({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="fn-card-text" className={cn("fn-card__text", className)} {...props} />;
}

export function FnCardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="fn-card-footer" className={cn("fn-card__footer", className)} {...props} />;
}
