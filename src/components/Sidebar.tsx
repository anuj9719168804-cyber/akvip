import React from 'react';
import { 
  BookOpen, 
  GraduationCap, 
  Target, 
  Flame, 
  Award, 
  Bookmark, 
  History, 
  MessageSquare,
  Sparkles
} from 'lucide-react';
import { NavTab } from '../types';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
}

export const LOGO_URL = "https://i.ibb.co/Q3g9fGSt/1791541921524.png";
export const APP_NAME = "GB STUDY";
export const TELEGRAM_URL = "https://t.me/GBFreestudy";

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  isMobileMenuOpen,
  setIsMobileMenuOpen,
}) => {
  const navItems = [
    { id: 'study' as NavTab, label: 'Study', icon: 'study' },
    { id: 'pi' as NavTab, label: 'PI', icon: 'pi' },
    { id: 'batches' as NavTab, label: 'Batches', icon: 'batches' },
    { id: 'nexttoppers' as NavTab, label: 'Next Toppers', icon: 'nexttoppers' },
    { id: 'missionjeet' as NavTab, label: 'MissionJeet', icon: 'missionjeet' },
    { id: 'vibrant' as NavTab, label: 'Vibrant', icon: 'vibrant' },
    { id: 'sway' as NavTab, label: 'Selection Way', icon: 'sway' },
    { id: 'mybatches' as NavTab, label: 'My Batches', icon: 'mybatches' },
    { id: 'history' as NavTab, label: 'History', icon: 'history' },
    { id: 'telegram' as NavTab, label: 'Join Telegram', icon: 'telegram', isExternal: true, href: TELEGRAM_URL },
    { id: 'contact' as NavTab, label: 'Contact Us', icon: 'contact' },
  ];

  const renderIcon = (type: string) => {
    switch (type) {
      case 'pi':
        return (
          <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 flex-shrink-0" aria-hidden="true">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12.2009 7.45149C12.1368 8.22982 11.7735 11.8221 12.1795 12.2412C12.9701 12.9198 13.3761 12.0017 13.4829 11.3831H14.4444C14.1667 15.6938 9.74359 14.9355 9.85043 12.2412C9.95726 10.6646 10.1068 9.02811 10.2564 7.45149H8.95299C8.84615 9.08798 8.61111 12.8799 7.84188 13.8777C6.85897 15.135 4.2094 14.197 5.87607 12.0816C7.05128 10.5848 7.28632 9.18777 7.4359 7.45149C6.19658 7.45149 6.00427 7.69098 5.40598 8.68884H4.44444C5.04274 6.59333 5.49145 5.55556 8.07692 5.55556C10.1923 5.55556 12.3077 5.55556 14.4017 5.55556V7.45149H12.2009Z"
              fill="#5a4bda"
            />
            <path
              d="M20 10C20 15.5228 15.5228 20 10 20C4.47715 20 0 15.5228 0 10C0 4.47715 4.47715 0 10 0C15.5228 0 20 4.47715 20 10ZM1.21343 10C1.21343 14.8527 5.14731 18.7866 10 18.7866C14.8527 18.7866 18.7866 14.8527 18.7866 10C18.7866 5.14731 14.8527 1.21343 10 1.21343C5.14731 1.21343 1.21343 5.14731 1.21343 1.21343 10.0000S1.21343 14.8527 10.0000 18.7866C14.8527 18.7866 18.7866 14.8527 18.7866 10Z"
              fill="#5a4bda"
            />
          </svg>
        );
      case 'batches':
        return (
          <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 flex-shrink-0" aria-hidden="true">
            <path
              d="M7.5 14.375V15.2145C7.5 15.8775 7.23661 16.5134 6.76777 16.9822L6.25 17.5H13.75L13.2322 16.9822C12.7634 16.5134 12.5 15.8775 12.5 15.2145V14.375M17.5 4.375V12.5C17.5 13.5355 16.6605 14.375 15.625 14.375H4.375C3.33947 14.375 2.5 13.5355 2.5 12.5V4.375M17.5 4.375C17.5 3.33947 16.6605 2.5 15.625 2.5H4.375C3.33947 2.5 2.5 3.33947 2.5 4.375M17.5 4.375V10C17.5 11.0355 16.6605 11.875 15.625 11.875H4.375C3.33947 11.875 2.5 11.0355 2.5 10V4.375"
              stroke="#5a4bda"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      case 'study':
        return <BookOpen className="w-5 h-5 flex-shrink-0 text-[#5a4bda]" />;
      case 'nexttoppers':
        return <GraduationCap className="w-5 h-5 flex-shrink-0 text-[#5a4bda]" />;
      case 'missionjeet':
        return <Target className="w-5 h-5 flex-shrink-0 text-[#5a4bda]" />;
      case 'vibrant':
        return <Flame className="w-5 h-5 flex-shrink-0 text-[#5a4bda]" />;
      case 'sway':
        return <Award className="w-5 h-5 flex-shrink-0 text-[#5a4bda]" />;
      case 'mybatches':
        return <Bookmark className="w-5 h-5 flex-shrink-0 text-[#5a4bda]" />;
      case 'history':
        return <History className="w-5 h-5 flex-shrink-0 text-[#5a4bda]" />;
      case 'telegram':
        return (
          <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 flex-shrink-0" aria-hidden="true">
            <path
              d="M16.9 3.25 14.55 16c-.18.9-.68 1.12-1.38.7l-3.58-2.64-1.73 1.66c-.19.19-.35.35-.72.35l.26-3.65 6.64-6c.29-.26-.06-.4-.45-.14l-8.2 5.16-3.53-1.1c-.77-.24-.78-.77.16-1.14L15.82 3.9c.64-.24 1.2.15 1.08-.65Z"
              stroke="#5a4bda"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      case 'contact':
        return <MessageSquare className="w-5 h-5 flex-shrink-0 text-[#5a4bda]" />;
      default:
        return <Sparkles className="w-5 h-5 flex-shrink-0 text-[#5a4bda]" />;
    }
  };

  const handleClick = (item: typeof navItems[0]) => {
    if (item.isExternal && item.href) {
      window.open(item.href, '_blank', 'noopener,noreferrer');
    } else {
      onSelectTab(item.id);
    }
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 xl:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Aside Sidebar */}
      <aside
        className={`z-50 w-64 bg-background border-r shadow-md transform transition-transform duration-200 ease-in-out ${
          isMobileMenuOpen
            ? 'fixed top-0 left-0 translate-x-0 h-full'
            : 'fixed top-0 left-0 -translate-x-full h-full'
        } xl:fixed xl:top-0 xl:left-0 xl:translate-x-0 xl:h-screen xl:z-40`}
      >
        {/* Logo & Brand Header */}
        <div 
          className="p-4 border-b sticky top-0 bg-background z-10 flex items-center gap-3 cursor-pointer select-none"
          onClick={() => { onSelectTab('batches'); setIsMobileMenuOpen(false); }}
        >
          <div className="w-10 h-10 rounded-full dark:bg-foreground overflow-hidden flex items-center justify-center border border-border shadow-sm">
            <img
              src={LOGO_URL}
              alt={`${APP_NAME} logo`}
              className="w-full h-full object-cover"
              onError={(e) => {
                // Fallback in case of network issue
                (e.target as HTMLImageElement).src = "https://i.ibb.co/mVjJG7Zg/1791541921524.png";
              }}
            />
          </div>
          <span className="font-semibold text-lg text-foreground tracking-tight">{APP_NAME}</span>
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-[#5a4bda] ml-auto flex-shrink-0">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
        </div>

        {/* Navigation list */}
        <nav className="p-2 space-y-1.5 overflow-y-auto h-[calc(100vh-5rem)]">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <div
                key={item.id}
                onClick={() => handleClick(item)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer text-sm font-medium transition-colors duration-200 select-none ${
                  isActive
                    ? 'bg-foreground/90 !text-background shadow-sm'
                    : 'text-foreground hover:bg-foreground/10'
                }`}
              >
                {renderIcon(item.icon)}
                <span>{item.label}</span>
                {item.id === 'telegram' && (
                  <span className="ml-auto text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                    Join
                  </span>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
};
