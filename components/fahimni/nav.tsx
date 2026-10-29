import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

export function FnNavBar({ className, children, ...props }: React.ComponentProps<"header">) {
  return (
    <header data-slot="fn-navbar" className={cn("fn-navbar", className)} {...props}>
      <div className="fn-container fn-navbar__inner">{children}</div>
    </header>
  );
}

export function FnNavActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="fn-nav-actions" className={cn("fn-navbar__actions", className)} {...props} />;
}

export const iconButtonVariants = cva("fn-icon-btn", {
  variants: {
    variant: {
      ghost: "",
      soft: "fn-icon-btn--soft",
      onHero: "fn-icon-btn--on-hero",
    },
  },
  defaultVariants: {
    variant: "ghost",
  },
});

export function FnIconButton({
  className,
  variant,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof iconButtonVariants>) {
  return (
    <button
      type="button"
      data-slot="fn-icon-button"
      className={cn(iconButtonVariants({ variant }), className)}
      {...props}
    />
  );
}

export function FnSegmented({ className, ...props }: React.ComponentProps<"div">) {
  return <div role="tablist" data-slot="fn-segmented" className={cn("fn-segmented", className)} {...props} />;
}

export function FnSegmentedItem({
  className,
  active = false,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      data-slot="fn-segmented-item"
      aria-selected={active}
      className={cn("fn-segmented__item", active ? "is-active" : undefined, className)}
      {...props}
    />
  );
}

export function FnTabBar({ className, ...props }: React.ComponentProps<"nav">) {
  return <nav data-slot="fn-tabbar" className={cn("fn-tabbar", className)} {...props} />;
}

export function FnTabBarItem({
  className,
  active = false,
  asChild = false,
  ...props
}: React.ComponentProps<"a"> & { active?: boolean; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "a";
  return (
    <Comp
      data-slot="fn-tabbar-item"
      aria-current={active ? "page" : undefined}
      className={cn("fn-tabbar__item", active ? "is-active" : undefined, className)}
      {...props}
    />
  );
}

export function FnLinkMore({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"a"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "a";
  return <Comp data-slot="fn-link-more" className={cn("fn-link-more", className)} {...props} />;
}
