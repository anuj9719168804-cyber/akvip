import React, { useState, useEffect } from 'react';
import { UserCheck, CalendarCheck2, BookOpen, BookmarkPlus, Trash2 } from 'lucide-react';
import { Batch } from '../types';

interface BatchCardProps {
  batch?: Batch;
  isPlaceholder?: boolean;
  onStudy?: (batch: Batch) => void;
  onToast?: (message: string, type?: 'success' | 'error') => void;
}

const ENROLLED_KEY = 'enrolledBatches';

export function getEnrolledBatches(): Batch[] {
  try {
    const data = JSON.parse(localStorage.getItem(ENROLLED_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export const BatchCard: React.FC<BatchCardProps> = ({
  batch,
  isPlaceholder = false,
  onStudy,
  onToast,
}) => {
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const batchId = batch?._id || batch?.batchId || '';
  const title = batch?.name || batch?.batchName || 'GB STUDY Batch';
  const image = batch?.previewImage || batch?.batchImage || 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/bb464a1b-1525-48df-8c4e-a7e607038bf7.jpeg';
  const language = batch?.language || 'Hinglish';
  const byName = batch?.byName || 'For Dedicated Aspirants';
  const startDate = batch?.startDate || '13 Apr 2026';
  const endDate = batch?.endDate || '01 Jul 2028';
  const rawPrice = batch?.feeTotal ?? batch?.batchPrice ?? 3199;
  const price = rawPrice > 0 ? String(rawPrice) : '3199';

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !batchId) return;
    const checkEnrolled = () => {
      const list = getEnrolledBatches();
      setIsEnrolled(list.some((b) => (b._id || b.batchId) === batchId));
    };

    checkEnrolled();
    window.addEventListener('batchesUpdated', checkEnrolled);
    window.addEventListener('storage', checkEnrolled);
    return () => {
      window.removeEventListener('batchesUpdated', checkEnrolled);
      window.removeEventListener('storage', checkEnrolled);
    };
  }, [batchId, isMounted]);

  const handleEnrollToggle = () => {
    if (!batch) return;
    const list = getEnrolledBatches();
    if (isEnrolled) {
      const updated = list.filter((b) => (b._id || b.batchId) !== batchId);
      localStorage.setItem(ENROLLED_KEY, JSON.stringify(updated));
      window.dispatchEvent(new Event('batchesUpdated'));
      setIsEnrolled(false);
      onToast?.(`You have been unenrolled from "${title}".`, 'success');
    } else {
      const newEntry: Batch = {
        _id: batchId,
        batchId,
        name: title,
        batchName: title,
        previewImage: image,
        batchImage: image,
        language,
        startDate,
        endDate,
        feeTotal: Number(price) || 0,
        batchPrice: Number(price) || 0,
        byName,
      };
      list.push(newEntry);
      localStorage.setItem(ENROLLED_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('batchesUpdated'));
      setIsEnrolled(true);
      onToast?.(`You've successfully enrolled in "${title}".`, 'success');
    }
  };

  if (isPlaceholder) {
    return (
      <article aria-hidden="true" className="overflow-hidden rounded-xl border bg-background p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="skeleton-shimmer h-5 w-3/5 rounded" />
          <div className="skeleton-shimmer h-6 w-12 rounded" />
        </div>
        <div className="skeleton-shimmer mt-4 aspect-video w-full rounded-lg" />
        <div className="mt-4 space-y-3">
          <div className="skeleton-shimmer h-4 w-2/5 rounded" />
          <div className="skeleton-shimmer h-4 w-4/5 rounded" />
          <div className="flex items-center justify-between gap-3">
            <div className="skeleton-shimmer h-5 w-20 rounded" />
            <div className="skeleton-shimmer h-5 w-28 rounded" />
          </div>
          <div className="flex gap-2 pt-1">
            <div className="skeleton-shimmer h-10 flex-1 rounded-md" />
            <div className="skeleton-shimmer h-10 flex-1 rounded-md" />
          </div>
        </div>
      </article>
    );
  }

  if (!batch) return null;

  return (
    <div className="border border-border rounded-xl overflow-hidden hover:shadow-lg dark:border-gray-800 transition-all duration-200 bg-card text-card-foreground flex flex-col justify-between">
      {/* Top Title & New Badge */}
      <div className="p-4 pb-2 flex items-start justify-between gap-2">
        <h2 className="line-clamp-2 text-base sm:text-lg font-bold text-foreground leading-snug">
          {title}
        </h2>
        <span className="bg-yellow-400 text-black text-xs font-semibold px-2 py-0.5 rounded shadow-xs flex-shrink-0">
          New
        </span>
      </div>

      {/* Thumbnail with Language Overlay */}
      <div className="px-4 py-1">
        <div className="w-full aspect-video rounded-lg overflow-hidden relative bg-muted border border-border/50">
          <img
            src={image}
            alt={title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/bb464a1b-1525-48df-8c4e-a7e607038bf7.jpeg';
            }}
          />
          <div className="absolute bottom-2 left-2 z-10">
            <span className="rounded-md bg-pink-500/80 dark:bg-green-600/90 px-2 py-0.5 text-xs font-semibold text-white shadow-sm">
              {language}
            </span>
          </div>
        </div>
      </div>

      {/* Meta & Actions */}
      <div className="p-4 pt-2 space-y-3">
        {/* For text */}
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <UserCheck className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="font-medium text-foreground line-clamp-1">{byName}</span>
        </div>

        {/* Dates */}
        <div className="flex items-center gap-1 text-muted-foreground text-xs">
          <CalendarCheck2 className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            Starts on <span className="font-semibold text-foreground">{startDate}</span> | Ends on{' '}
            <span className="font-semibold text-foreground">{endDate}</span>
          </span>
        </div>

        {/* Pricing */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/60">
          <div className="flex items-baseline gap-1.5">
            <span className="text-base sm:text-lg font-extrabold text-green-600 dark:text-green-400">
              ₹ FREE
            </span>
            {price && (
              <span className="text-xs text-muted-foreground line-through">
                ₹{price}
              </span>
            )}
          </div>
          <span className="text-[11px] bg-green-50 dark:bg-green-950/60 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 font-semibold px-2 py-0.5 rounded">
            100% Free For Students
          </span>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => onStudy?.(batch)}
            className="flex-1 min-w-[100px] inline-flex items-center justify-center gap-1.5 border border-input bg-background hover:bg-accent hover:text-accent-foreground text-foreground text-xs sm:text-sm font-medium py-2 px-3 rounded-md transition-colors"
          >
            <BookOpen className="w-4 h-4" />
            <span>Study</span>
          </button>

          {isEnrolled ? (
            <button
              type="button"
              onClick={handleEnrollToggle}
              className="flex-1 min-w-[100px] inline-flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm font-medium py-2 px-3 rounded-md transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span>Unenroll</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleEnrollToggle}
              className="flex-1 min-w-[100px] inline-flex items-center justify-center gap-1.5 bg-green-500 hover:bg-green-600 text-white text-xs sm:text-sm font-medium py-2 px-3 rounded-md transition-colors shadow-xs"
            >
              <span>Enroll Now</span>
              <BookmarkPlus className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
