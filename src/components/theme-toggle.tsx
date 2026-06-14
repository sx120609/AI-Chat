"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const baseClass = "ios-icon-button relative inline-flex items-center justify-center rounded-full w-9 h-9";
  const finalClass = className ? `${baseClass} ${className}` : baseClass;

  if (!mounted) {
    return (
      <button className={`${finalClass} opacity-50 cursor-default`} aria-hidden="true" disabled>
        <div className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className={finalClass}
      aria-label="Toggle theme"
      title="切换深色模式"
    >
      <Sun className="h-[18px] w-[18px] transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[18px] w-[18px] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </button>
  );
}
