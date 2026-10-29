import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

export const buttonVariants = cva("fn-btn", {
  variants: {
    variant: {
      primary: "fn-btn--primary",
      soft: "fn-btn--soft",
      outline: "fn-btn--outline",
      ghost: "fn-btn--ghost",
      gold: "fn-btn--gold",
      danger: "fn-btn--danger",
      onHero: "fn-btn--on-hero",
    },
    size: {
      sm: "fn-btn--sm",
      md: "",
      lg: "fn-btn--lg",
      icon: "fn-btn--icon",
    },
    block: {
      true: "fn-btn--block",
    },
  },
  defaultVariants: {
    variant: "primary",
    size: "md",
  },
});

export function FnButton({
  className,
  variant,
  size,
  block,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="fn-button"
      data-variant={variant ?? "primary"}
      data-size={size ?? "md"}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  );
}
