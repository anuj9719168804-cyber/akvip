import React, { useState, useEffect } from 'react';
import { History as HistoryIcon, Play, Trash2, Clock } from 'lucide-react';

interface HistoryItem {
  id: string;
  title: string;
  batchName: string;
  subjectName: string;
  date: string;
  timestamp: number;
}

interface HistoryViewProps {
  onExplore: () => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ onExplore, onToast }) => {
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const loadHistory = () => {
    try {
      const data = JSON.parse(localStorage.getItem('watchHistory') || '[]');
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setHistory([]);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const clearHistory = () => {
    localStorage.removeItem('watchHistory');
    setHistory([]);
    onToast('Watch history cleared', 'success');
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="bg-background border border-border rounded-xl p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Watch History</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Lectures and study material you've recently viewed
            </p>
          </div>

          {history.length > 0 && (
            <button
              onClick={clearHistory}
              className="inline-flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-3 py-1.5 rounded-md font-medium transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear History</span>
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="p-12 text-center border border-dashed border-border rounded-xl bg-card">
            <HistoryIcon className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-60" />
            <h3 className="text-lg font-semibold text-foreground">No Watch History</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1 mb-5">
              Lectures you watch will appear here so you can easily pick up where you left off.
            </p>
            <button
              onClick={onExplore}
              className="inline-flex items-center gap-2 bg-[#5a4bda] text-white font-medium px-4 py-2 rounded-lg text-sm hover:bg-[#493abf] transition-colors"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Start Learning</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((item) => (
              <div
                key={item.id + item.timestamp}
                className="border border-border rounded-lg p-4 bg-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Play className="w-5 h-5 text-[#5a4bda] fill-[#5a4bda]" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-semibold text-foreground text-sm sm:text-base line-clamp-1">
                      {item.title}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {item.batchName} • {item.subjectName}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{item.date}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
