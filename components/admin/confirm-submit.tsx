"use client";

import * as React from "react";

import { FnButton } from "@/components/fahimni";

export function ConfirmSubmit({
  message,
  children,
  ...props
}: React.ComponentProps<typeof FnButton> & { message: string }) {
  return (
    <FnButton
      {...props}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </FnButton>
  );
}
