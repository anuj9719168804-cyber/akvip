import React, { useState, useEffect, useRef } from 'react';
import { Menu, ArrowLeft, Sun, Moon, Laptop } from 'lucide-react';

interface HeaderProps {
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
  canGoBack?: boolean;
  onBack?: () => void;
}

type ThemeMode = 'LIGHT' | 'DARK' | 'SYSTEM';

export const Header: React.FC<HeaderProps> = ({
  isMobileMenuOpen,
  setIsMobileMenuOpen,
  canGoBack = false,
  onBack,
}) => {
  const [theme, setTheme] = useState<ThemeMode>('SYSTEM');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('USER_THEME') as ThemeMode;
    if (saved === 'LIGHT' || saved === 'DARK' || saved === 'SYSTEM') {
      setTheme(saved);
    } else {
      localStorage.setItem('USER_THEME', 'SYSTEM');
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'DARK') {
      root.classList.add('dark');
    } else if (theme === 'LIGHT') {
      root.classList.remove('dark');
    } else {
      const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', isSystemDark);
    }
    localStorage.setItem('USER_THEME', theme);

    if (theme === 'SYSTEM') {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = (e: MediaQueryListEvent) => {
        root.classList.toggle('dark', e.matches);
      };
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    }
  }, [theme]);

  // Click outside listener for theme menu
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/80 p-2.5 backdrop-blur-md divshadow sm:p-4">
      {/* Left controls */}
      <div className="flex items-center gap-2 rounded-lg py-1 px-1">
        <button
          type="button"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 rounded-md hover:bg-muted xl:hidden text-foreground"
          aria-label="Toggle navigation menu"
        >
          <Menu className="h-6 w-6" />
        </button>

        {canGoBack && onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 text-sm font-medium text-foreground hover:bg-muted py-1.5 px-3 rounded-md transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </button>
        )}
      </div>

      {/* Right controls: Theme Switcher */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="rounded-md p-2 hover:bg-muted text-foreground transition-colors border border-transparent hover:border-border"
          aria-label="Theme selector"
        >
          {theme === 'LIGHT' ? (
            <Sun className="h-5 w-5 text-amber-500" />
          ) : (
            <Moon className="h-5 w-5 text-indigo-400" />
          )}
        </button>

        {isDropdownOpen && (
          <div className="absolute right-0 mt-2 w-48 rounded-md border bg-popover p-1.5 text-popover-foreground shadow-lg z-50">
            <button
              onClick={() => { setTheme('LIGHT'); setIsDropdownOpen(false); }}
              className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm cursor-pointer select-none transition-colors ${
                theme === 'LIGHT' ? 'bg-accent text-accent-foreground font-semibold' : 'hover:bg-accent/60'
              }`}
            >
              <Sun className="h-4 w-4 text-amber-500" />
              <span>Light</span>
            </button>
            <div className="-mx-1 my-1 h-px bg-muted" />
            <button
              onClick={() => { setTheme('DARK'); setIsDropdownOpen(false); }}
              className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm cursor-pointer select-none transition-colors ${
                theme === 'DARK' ? 'bg-accent text-accent-foreground font-semibold' : 'hover:bg-accent/60'
              }`}
            >
              <Moon className="h-4 w-4 text-indigo-400" />
              <span>Dark</span>
            </button>
            <div className="-mx-1 my-1 h-px bg-muted" />
            <button
              onClick={() => { setTheme('SYSTEM'); setIsDropdownOpen(false); }}
              className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm cursor-pointer select-none transition-colors ${
                theme === 'SYSTEM' ? 'bg-accent text-accent-foreground font-semibold' : 'hover:bg-accent/60'
              }`}
            >
              <Laptop className="h-4 w-4 text-muted-foreground" />
              <span>System</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
