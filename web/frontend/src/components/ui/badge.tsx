import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] border font-mono text-[10px] uppercase tracking-[1.5px]",
  {
    variants: {
      variant: {
        default: "border-border-green bg-[rgba(0,255,65,0.08)] text-green",
        outline: "border-border-main bg-bg-secondary text-text-secondary",
        green: "border-border-green bg-[rgba(0,255,65,0.1)] text-green",
        amber: "border-[rgba(217,119,6,0.4)] bg-[rgba(217,119,6,0.1)] text-amber-warn",
        red: "border-[rgba(185,28,28,0.4)] bg-[rgba(185,28,28,0.1)] text-red-correction",
        muted: "border-border-main bg-bg-secondary text-text-dim",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
