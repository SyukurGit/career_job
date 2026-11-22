"use client";

import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle({ className, showLabel = false }: { className?: string; showLabel?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";

  return (
    <Button
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      type="button"
      onClick={toggleTheme}
      aria-label="Dark mode"
      aria-pressed={dark}
      title={dark ? "Ubah ke mode terang" : "Ubah ke mode malam"}
      className={cn("h-9 rounded-xl text-muted hover:text-foreground", showLabel && "w-full justify-start px-3 text-xs font-medium", className)}
    >
      {dark ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
      {showLabel && <span>{dark ? "Mode Malam" : "Mode Terang"}</span>}
    </Button>
  );
}
