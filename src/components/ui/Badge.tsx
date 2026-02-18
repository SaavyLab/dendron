import { cn } from "@/lib/utils";

interface BadgeProps {
  variant?: "default" | "warning" | "error" | "success" | "accent";
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = "default", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 rounded text-[10px] font-mono font-medium leading-5",
        variant === "default" && "bg-white/5 text-[var(--text-secondary)] border border-[var(--border-strong)]",
        variant === "warning" && "bg-amber-950/60 text-amber-400 border border-amber-900/50",
        variant === "error"   && "bg-red-950/60 text-red-400 border border-red-900/50",
        variant === "success" && "bg-green-950/60 text-green-400 border border-green-900/50",
        variant === "accent"  && "bg-blue-950/60 text-blue-400 border border-blue-900/50",
        className
      )}
    >
      {children}
    </span>
  );
}
