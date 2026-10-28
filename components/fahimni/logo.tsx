import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

type MarkProps = Omit<React.SVGProps<SVGSVGElement>, "width" | "height"> & {
  size?: number;
};

export function FahimniMark({ size = 40, className, ...props }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      data-slot="fn-logo-mark"
      className={cn("fn-logo-mark", className)}
      {...props}
    >
      <path d="M32 7.5 8 18.4l24 10.6 24-10.6L32 7.5Z" fill="#8a67ff" />
      <path d="M14.5 23.6v9.9c0 3.1 7.8 5.6 17.5 5.6s17.5-2.5 17.5-5.6v-9.9L32 29.1 14.5 23.6Z" fill="#5a37e0" />
      <path d="M54 19.8v10.4" stroke="#5a37e0" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="54" cy="33.4" r="3" fill="#7c5cff" />
      <path
        d="M32 21.5c-10.9 0-19.7 7-19.7 15.7 0 4.6 2.4 8.8 6.3 11.7l-1.6 7.1 8.4-4.1c2.1.5 4.3.8 6.6.8 10.9 0 19.7-7 19.7-15.7s-8.8-15.5-19.7-15.5Z"
        fill="#211d52"
        stroke="#7c5cff"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <path d="M22 36.8q3.4-4.6 6.8 0" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" fill="none" />
      <path d="M35.2 36.8q3.4-4.6 6.8 0" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" fill="none" />
      <path d="M28.6 42.4q3.4 3.9 6.8 0" stroke="#b7a4ff" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M10.4 20.9l3.2-3.2" stroke="#a68cff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M7.6 26.6l4.1-1" stroke="#a68cff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function FahimniWordmark({ className }: { className?: string }) {
  return (
    <span data-slot="fn-logo-wordmark" className={cn("fn-brand__name", className)}>
      فهمني
    </span>
  );
}

export function FahimniBrand({
  size = 36,
  subtitle,
  className,
  markClassName,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  size?: number;
  subtitle?: string;
  markClassName?: string;
}) {
  return (
    <Link href="/" data-slot="fn-brand" className={cn("fn-brand", className)} {...props}>
      <FahimniMark size={size} className={markClassName} />
      <span>
        <FahimniWordmark />
        {subtitle ? <span className="fn-brand__sub">{subtitle}</span> : null}
      </span>
    </Link>
  );
}
