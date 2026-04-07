import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-white",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-red-50 text-red-700 border-red-200/60",
        outline: "text-foreground border-border/80",
        success: "border-transparent bg-emerald-50 text-emerald-700 border-emerald-200/60",
        warning: "border-transparent bg-amber-50 text-amber-700 border-amber-200/60",
        info: "border-transparent bg-sky-50 text-sky-700 border-sky-200/60",
        teal: "border-transparent bg-accent/10 text-accent font-semibold"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
