import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-mono text-sm font-medium tracking-[0.5px] uppercase transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default:
          "bg-green text-bg-primary hover:shadow-[0_0_30px_rgba(0,255,65,0.45)] hover:scale-[1.02] btn-clip",
        outline:
          "border border-border-main bg-transparent text-text-primary hover:border-border-green hover:text-green hover:shadow-[0_0_12px_rgba(0,255,65,0.15)]",
        ghost:
          "bg-transparent text-text-secondary hover:text-green",
        destructive:
          "bg-red-correction text-white hover:shadow-[0_0_20px_rgba(185,28,28,0.4)]",
        secondary:
          "bg-bg-secondary text-text-primary border border-border-main hover:border-border-green",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-7 text-[13px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
