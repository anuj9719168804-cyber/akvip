import React, { useState, useEffect } from 'react';
import { Bookmark, Search, ArrowRight } from 'lucide-react';
import { Batch } from '../types';
import { BatchCard, getEnrolledBatches } from './BatchCard';

interface MyBatchesViewProps {
  onStudy: (batch: Batch) => void;
  onExplore: () => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

export const MyBatchesView: React.FC<MyBatchesViewProps> = ({
  onStudy,
  onExplore,
  onToast,
}) => {
  const [batches, setBatches] = useState<Batch[]>([]);

  const loadBatches = () => {
    setBatches(getEnrolledBatches());
  };

  useEffect(() => {
    loadBatches();
    window.addEventListener('batchesUpdated', loadBatches);
    window.addEventListener('storage', loadBatches);
    return () => {
      window.removeEventListener('batchesUpdated', loadBatches);
      window.removeEventListener('storage', loadBatches);
    };
  }, []);

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="bg-background border border-border rounded-xl p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Batches</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Access your enrolled batches and continue learning
            </p>
          </div>

          <button
            onClick={onExplore}
            className="inline-flex items-center gap-2 bg-[#5a4bda] text-white text-xs sm:text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#493abf] transition-colors shadow-xs"
          >
            <span>Explore All Batches</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {batches.length === 0 ? (
          <div className="p-12 text-center border border-dashed border-border rounded-xl bg-card">
            <Bookmark className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-60" />
            <h3 className="text-lg font-semibold text-foreground">No Batches Enrolled Yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1 mb-5">
              Explore our wide collection of free IIT-JEE, NEET, CBSE Class 8th-12th, and competitive exam batches on GB STUDY.
            </p>
            <button
              onClick={onExplore}
              className="inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
            >
              <Search className="w-4 h-4" />
              <span>Browse Batches Now</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {batches.map((batch) => (
              <BatchCard
                key={batch._id || batch.batchId}
                batch={batch}
                onStudy={onStudy}
                onToast={onToast}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
