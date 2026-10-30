import React, { useState, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import { Batch, NavTab } from './types';
import { fetchAllBatches, searchBatches } from './services/api';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { BannerCarousel } from './components/BannerCarousel';
import { BatchCard } from './components/BatchCard';
import { BatchDetailView } from './components/BatchDetailView';
import { MyBatchesView } from './components/MyBatchesView';
import { HistoryView } from './components/HistoryView';
import { ContactView } from './components/ContactView';
import { ToastContainer, ToastMessage } from './components/Toast';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('batches');
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Batches state
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Load batches
  const loadData = useCallback(async (pageNum: number, query: string, isAppend: boolean) => {
    if (isAppend) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const res = query.trim()
        ? await searchBatches(query, pageNum)
        : await fetchAllBatches(pageNum);

      setBatches((prev) => (isAppend ? [...prev, ...res.batches] : res.batches));
      setHasMore(pageNum < res.totalPages && res.batches.length > 0);
    } catch (err: any) {
      console.error('Failed to load batches:', err);
      showToast('Failed to load batches. Check connection.', 'error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [showToast]);

  // Initial fetch and on search change
  useEffect(() => {
    setPage(1);
    loadData(1, activeSearch, false);
  }, [activeSearch, loadData]);

  // Handle Search submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveSearch(searchQuery);
  };

  // Debounced auto-search if user pauses typing
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== activeSearch) {
        setActiveSearch(searchQuery);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, activeSearch]);

  // Load more pagination
  const handleLoadMore = () => {
    if (loading || loadingMore || !hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    loadData(nextPage, activeSearch, true);
  };

  // Handle clicking study on a batch
  const handleStudyBatch = (batch: Batch) => {
    setSelectedBatch(batch);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackToBatches = () => {
    setSelectedBatch(null);
  };

  // Switch tabs
  const handleSelectTab = (tab: NavTab) => {
    setActiveTab(tab);
    setSelectedBatch(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const canGoBack = Boolean(selectedBatch || activeTab !== 'batches');
  const handleHeaderBack = () => {
    if (selectedBatch) {
      setSelectedBatch(null);
    } else {
      setActiveTab('batches');
    }
  };

  return (
    <div className="flex min-h-screen w-full max-w-full overflow-x-hidden bg-background text-foreground">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
      />

      {/* Main Content Area */}
      <div className="flex min-w-0 w-full max-w-full flex-1 flex-col xl:ml-64">
        {/* Sticky Header */}
        <Header
          isMobileMenuOpen={isMobileMenuOpen}
          setIsMobileMenuOpen={setIsMobileMenuOpen}
          canGoBack={canGoBack}
          onBack={handleHeaderBack}
        />

        {/* Dynamic Main Body */}
        <main className="min-w-0 w-full max-w-full flex-1 overflow-x-hidden">
          {/* View 1: Batch Detail View */}
          {selectedBatch ? (
            <BatchDetailView
              batch={selectedBatch}
              onBack={handleBackToBatches}
              onToast={showToast}
            />
          ) : activeTab === 'mybatches' ? (
            /* View 2: My Batches */
            <MyBatchesView
              onStudy={handleStudyBatch}
              onExplore={() => handleSelectTab('batches')}
              onToast={showToast}
            />
          ) : activeTab === 'history' ? (
            /* View 3: History */
            <HistoryView
              onExplore={() => handleSelectTab('batches')}
              onToast={showToast}
            />
          ) : activeTab === 'contact' ? (
            /* View 4: Contact Us */
            <ContactView />
          ) : (
            /* View 5: Batches Portal (Default & Core View) */
            <div className="container mx-auto px-4 py-6 max-w-7xl">
              <div className="bg-background border border-border rounded-lg p-4 sm:p-6 shadow-xs">
                {/* Heading */}
                <h1 className="text-2xl font-semibold mb-4 text-foreground tracking-tight">
                  Batches
                </h1>

                {/* Search Bar */}
                <form
                  onSubmit={handleSearchSubmit}
                  className="divshadow flex flex-wrap items-center gap-3 sm:gap-5"
                >
                  <div className="relative w-full">
                    <div className="absolute inset-y-0 start-0 flex items-center ps-3.5 pointer-events-none text-muted-foreground">
                      <Search className="w-4 h-4 stroke-[2.5]" />
                    </div>

                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="flex-grow block w-full p-4 ps-10 text-sm divshadow border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-[#5a4bda] bg-foreground/5 text-foreground placeholder:text-muted-foreground"
                      placeholder="Search Your Batch"
                    />

                    <button
                      type="submit"
                      className="absolute end-2.5 bottom-2.5 font-medium rounded-lg text-sm px-4 py-2 bg-green-500 hover:bg-green-600 text-white transition-colors cursor-pointer shadow-xs"
                    >
                      Search
                    </button>
                  </div>
                </form>

                {/* Banner Carousel */}
                <BannerCarousel />

                {/* Batches Grid */}
                {loading && page === 1 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <BatchCard key={i} isPlaceholder />
                    ))}
                  </div>
                ) : batches.length > 0 ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
                      {batches.map((batch) => (
                        <BatchCard
                          key={batch._id || batch.batchId || batch.slug}
                          batch={batch}
                          onStudy={handleStudyBatch}
                          onToast={showToast}
                        />
                      ))}
                    </div>

                    {/* Load More Button */}
                    {hasMore && (
                      <div className="flex justify-center mt-6">
                        <button
                          type="button"
                          onClick={handleLoadMore}
                          disabled={loadingMore}
                          className="border border-input bg-background hover:bg-accent hover:text-accent-foreground px-6 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {loadingMore ? 'Loading...' : 'Load More'}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground font-medium">No batches found.</p>
                    <button
                      onClick={() => { setSearchQuery(''); setActiveSearch(''); }}
                      className="mt-3 text-sm text-[#5a4bda] hover:underline font-semibold"
                    >
                      Clear search filter
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Floating Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
