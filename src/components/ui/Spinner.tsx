import { cn } from "@/lib/utils";

interface SpinnerProps {
  size?: "sm" | "xs" | "md";
  className?: string;
}

export function Spinner({ size = "sm", className }: SpinnerProps) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border-2 border-transparent border-t-blue-400",
        size === "md" && "w-4 h-4",
        size === "sm" && "w-3.5 h-3.5",
        size === "xs" && "w-2.5 h-2.5",
        className
      )}
      style={{ animation: "spin 0.7s linear infinite" }}
    />
  );
}
