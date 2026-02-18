import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "danger" | "accent";
  size?: "sm" | "xs" | "icon";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", size = "sm", className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 font-medium rounded transition-colors select-none",
          "disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer",
          size === "sm"   && "h-7 px-2.5 text-xs",
          size === "xs"   && "h-5 px-1.5 text-[11px]",
          size === "icon" && "h-7 w-7 text-xs",
          variant === "default" && [
            "border text-zinc-300 hover:text-zinc-100",
            "bg-transparent hover:bg-white/5",
            "border-[var(--border-strong)]",
          ],
          variant === "ghost" && [
            "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5",
          ],
          variant === "danger" && [
            "text-red-400 hover:text-red-300 hover:bg-red-950/50 border border-red-900/40",
          ],
          variant === "accent" && [
            "bg-blue-600 hover:bg-blue-500 text-white border border-blue-500/50",
          ],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
