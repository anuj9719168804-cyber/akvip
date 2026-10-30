import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  BookOpen, 
  Video, 
  FileText, 
  Bell, 
  Clock, 
  Calendar, 
  Download, 
  Play, 
  ExternalLink,
  ChevronRight,
  Layers,
  Sparkles,
  X,
  FileCheck2,
  FileQuestion,
  HelpCircle,
  Maximize2
} from 'lucide-react';
import { Batch, SubjectItem, ChapterItem, LectureItem, AnnouncementItem, ScheduleClass } from '../types';
import { 
  fetchBatchDetails, 
  fetchSubjectChapters, 
  fetchTopicContent, 
  fetchLectureSchedule,
  fetchTodaysSchedule, 
  fetchAnnouncements,
  fetchBatchTests,
  fetchTestInstructions,
  ScheduleDetailResponse,
  ExtractedNote
} from '../services/api';

interface BatchDetailViewProps {
  batch: Batch;
  onBack: () => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

type MainTabType = 'classes' | 'live' | 'tests' | 'announcements';
type ContentTypeTab = 'videos' | 'dpps' | 'notes' | 'DppNotes' | 'DppVideos';

export const BatchDetailView: React.FC<BatchDetailViewProps> = ({
  batch,
  onBack,
  onToast,
}) => {
  const batchId = batch._id || batch.batchId || '';

  const [activeMainTab, setActiveMainTab] = useState<MainTabType>('classes');
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<any>(null);

  // Today's schedule & live
  const [classes, setClasses] = useState<ScheduleClass[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);

  // Announcements
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);

  // Tests
  const [tests, setTests] = useState<any[]>([]);
  const [testsLoading, setTestsLoading] = useState(false);
  const [testInstructions, setTestInstructions] = useState<any | null>(null);

  // Hierarchy: Subject -> Chapter -> Topics
  const [selectedSubject, setSelectedSubject] = useState<SubjectItem | null>(null);
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);

  const [selectedChapter, setSelectedChapter] = useState<ChapterItem | null>(null);
  const [contentType, setContentType] = useState<ContentTypeTab>('videos');
  const [items, setItems] = useState<LectureItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  // Video Player state
  const [activeLectureSchedule, setActiveLectureSchedule] = useState<ScheduleDetailResponse | null>(null);
  const [activeLectureMeta, setActiveLectureMeta] = useState<LectureItem | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

  // In-app PDF Viewer
  const [activePdfUrl, setActivePdfUrl] = useState<string | null>(null);
  const [activePdfTitle, setActivePdfTitle] = useState<string>('Document PDF');

  // Load batch details
  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchBatchDetails(batchId);
        if (active) setDetails(data);
      } catch (err) {
        console.error('Error loading batch:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [batchId]);

  // Load data when main tabs change
  useEffect(() => {
    if (activeMainTab === 'live') {
      let active = true;
      setClassesLoading(true);
      fetchTodaysSchedule(batchId)
        .then((res) => { if (active) setClasses(res); })
        .finally(() => { if (active) setClassesLoading(false); });
      return () => { active = false; };
    }
    if (activeMainTab === 'announcements') {
      let active = true;
      setAnnouncementsLoading(true);
      fetchAnnouncements(batchId)
        .then((res) => { if (active) setAnnouncements(res); })
        .finally(() => { if (active) setAnnouncementsLoading(false); });
      return () => { active = false; };
    }
    if (activeMainTab === 'tests') {
      let active = true;
      setTestsLoading(true);
      fetchBatchTests(batchId)
        .then((res) => { if (active) setTests(res); })
        .finally(() => { if (active) setTestsLoading(false); });
      return () => { active = false; };
    }
  }, [activeMainTab, batchId]);

  // Load chapters when a subject is clicked
  useEffect(() => {
    if (!selectedSubject) {
      setChapters([]);
      setSelectedChapter(null);
      return;
    }
    let active = true;
    setChaptersLoading(true);
    fetchSubjectChapters(batchId, selectedSubject._id)
      .then((res) => { if (active) setChapters(res); })
      .finally(() => { if (active) setChaptersLoading(false); });
    return () => { active = false; };
  }, [selectedSubject, batchId]);

  // Load content (Lectures, DPPs, Notes, etc.)
  useEffect(() => {
    if (!selectedSubject || !selectedChapter) {
      setItems([]);
      return;
    }
    let active = true;
    setItemsLoading(true);
    fetchTopicContent(batchId, selectedSubject._id, selectedChapter._id, contentType)
      .then((res) => { if (active) setItems(res); })
      .finally(() => { if (active) setItemsLoading(false); });
    return () => { active = false; };
  }, [selectedChapter, contentType, selectedSubject, batchId]);

  const subjects: SubjectItem[] = details?.subjects || [];

  // Play video with real backend Schedule fetch
  const handleWatchLecture = async (lecture: LectureItem) => {
    setActiveLectureMeta(lecture);
    setVideoLoading(true);
    try {
      const schedule = await fetchLectureSchedule(batchId, selectedSubject?._id || '', lecture._id);
      setActiveLectureSchedule(schedule);

      // Save to watch history
      const history = JSON.parse(localStorage.getItem('watchHistory') || '[]');
      const entry = {
        id: lecture._id,
        title: lecture.topic || lecture.videoDetails?.name || 'Class Lecture',
        batchName: batch.name || batch.batchName || 'GB STUDY',
        subjectName: selectedSubject?.subject || 'Subject',
        date: new Date().toLocaleDateString(),
        timestamp: Date.now()
      };
      const filtered = history.filter((h: any) => h.id !== lecture._id);
      filtered.unshift(entry);
      localStorage.setItem('watchHistory', JSON.stringify(filtered.slice(0, 30)));
    } catch (e: any) {
      console.warn('Error fetching lecture schedule:', e);
      onToast('Connecting to lecture stream...', 'success');
    } finally {
      setVideoLoading(false);
    }
  };

  const openPdfViewer = (url: string, title: string) => {
    if (!url) {
      onToast('PDF file will be uploaded shortly', 'error');
      return;
    }
    setActivePdfUrl(url);
    setActivePdfTitle(title);
  };

  const getYoutubeEmbed = (url: string) => {
    if (!url) return '';
    if (url.includes('embed/')) return url;
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|live\/|embed\/))([a-zA-Z0-9_-]+)/);
    return match ? `https://www.youtube.com/embed/${match[1]}?autoplay=1&rel=0` : url;
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Top Breadcrumb */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 font-medium text-foreground hover:text-primary transition-colors py-1 px-2 rounded-md hover:bg-muted"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Batches</span>
        </button>

        <span>/</span>
        <span className="font-semibold text-foreground truncate max-w-xs sm:max-w-md">
          {batch.name || batch.batchName}
        </span>

        {selectedSubject && (
          <>
            <span>/</span>
            <button
              onClick={() => { setSelectedSubject(null); setSelectedChapter(null); }}
              className="text-foreground hover:text-primary transition-colors truncate max-w-[200px]"
            >
              {selectedSubject.subject}
            </button>
          </>
        )}

        {selectedChapter && (
          <>
            <span>/</span>
            <span className="font-medium text-foreground truncate max-w-[200px]">
              {selectedChapter.name}
            </span>
          </>
        )}
      </div>

      {/* Hero Batch Card */}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-6 mb-6 shadow-xs">
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <div className="w-full md:w-64 aspect-video rounded-lg overflow-hidden border border-border/80 flex-shrink-0 bg-muted">
            <img
              src={batch.previewImage || batch.batchImage || 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/bb464a1b-1525-48df-8c4e-a7e607038bf7.jpeg'}
              alt={batch.name || 'Batch preview'}
              className="w-full h-full object-cover"
            />
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="bg-yellow-400 text-black text-xs font-bold px-2 py-0.5 rounded">
                GB STUDY Verified
              </span>
              <span className="bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300 text-xs font-semibold px-2 py-0.5 rounded border border-green-200 dark:border-green-800">
                100% Free For Students
              </span>
              <span className="bg-primary/10 text-primary text-xs font-semibold px-2 py-0.5 rounded">
                {batch.language || 'Hinglish'}
              </span>
            </div>

            <h1 className="text-xl sm:text-2xl font-bold text-foreground">
              {batch.name || batch.batchName}
            </h1>

            <p className="text-xs sm:text-sm text-muted-foreground">
              {batch.byName || 'Complete Preparation with Live & Recorded Lectures, Notes, DPPs & Practice Tests'}
            </p>

            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-1">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-primary" />
                <span>Starts: {batch.startDate || 'Started'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-primary" />
                <span>Ends: {batch.endDate || 'Target Exam Session'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-primary" />
                <span>{subjects.length} Subjects</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Feature Tabs (Matching Target Site) */}
      <div className="flex border-b border-border mb-6 overflow-x-auto">
        <button
          onClick={() => { setActiveMainTab('classes'); setSelectedSubject(null); setSelectedChapter(null); }}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
            activeMainTab === 'classes'
              ? 'border-[#7567ee] text-[#5a4bda] dark:text-[#29ff94] dark:border-[#3dc280] font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <span>🎁 All Classes & Subjects</span>
        </button>

        <button
          onClick={() => setActiveMainTab('live')}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
            activeMainTab === 'live'
              ? 'border-[#7567ee] text-[#5a4bda] dark:text-[#29ff94] dark:border-[#3dc280] font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <span>🔴 Live Classes</span>
        </button>

        <button
          onClick={() => setActiveMainTab('tests')}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
            activeMainTab === 'tests'
              ? 'border-[#7567ee] text-[#5a4bda] dark:text-[#29ff94] dark:border-[#3dc280] font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <span>📝 Tests Series</span>
        </button>

        <button
          onClick={() => setActiveMainTab('announcements')}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
            activeMainTab === 'announcements'
              ? 'border-[#7567ee] text-[#5a4bda] dark:text-[#29ff94] dark:border-[#3dc280] font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>Announcements</span>
        </button>
      </div>

      {/* Main Tab Content */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton-shimmer h-28 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* TAB 1: ALL CLASSES & SUBJECTS */}
          {activeMainTab === 'classes' && (
            <div>
              {/* Level 1: Subjects List */}
              {!selectedSubject && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-foreground">Subjects</h2>
                    <span className="text-xs text-muted-foreground">{subjects.length} subjects found</span>
                  </div>

                  {subjects.length === 0 ? (
                    <div className="p-8 text-center border border-dashed rounded-xl">
                      <p className="text-muted-foreground">No subjects found for this batch.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {subjects.map((subj) => (
                        <div
                          key={subj._id}
                          onClick={() => setSelectedSubject(subj)}
                          className="border border-border rounded-xl p-4 bg-card hover:border-[#5a4bda]/60 transition-all cursor-pointer shadow-xs hover:shadow-md flex items-center justify-between group"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-11 h-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                              <BookOpen className="w-5 h-5 text-[#5a4bda]" />
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-semibold text-foreground text-sm line-clamp-1 group-hover:text-primary transition-colors">
                                {subj.subject}
                              </h3>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                View Chapters & Materials
                              </p>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all flex-shrink-0" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Level 2: Chapters List */}
              {selectedSubject && !selectedChapter && (
                <div>
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
                    <div>
                      <h2 className="text-xl font-bold text-foreground">
                        {selectedSubject.subject}
                      </h2>
                      <p className="text-xs text-muted-foreground">Select a chapter to access lectures, notes and DPPs</p>
                    </div>
                    <button
                      onClick={() => setSelectedSubject(null)}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      ← Change Subject
                    </button>
                  </div>

                  {chaptersLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="skeleton-shimmer h-16 rounded-xl" />
                      ))}
                    </div>
                  ) : chapters.length === 0 ? (
                    <div className="p-8 text-center border border-dashed rounded-xl">
                      <p className="text-muted-foreground">No chapters or topics uploaded yet for this subject.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {chapters.map((chap) => (
                        <div
                          key={chap._id}
                          onClick={() => setSelectedChapter(chap)}
                          className="border border-border rounded-xl p-4 bg-card hover:border-[#5a4bda]/50 transition-all cursor-pointer shadow-xs hover:shadow-md flex items-center justify-between group"
                        >
                          <div className="border-l-4 border-[#7567ee] pl-3 min-w-0">
                            <h3 className="font-semibold text-foreground text-sm sm:text-base line-clamp-1 group-hover:text-primary transition-colors">
                              {chap.name}
                            </h3>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                              <span>{chap.videos || 0} Videos</span>
                              <span>|</span>
                              <span>{chap.exercises || 0} Exercises</span>
                              <span>|</span>
                              <span>{chap.notes || 0} Notes</span>
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Level 3: Chapter Content Tabs */}
              {selectedSubject && selectedChapter && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-border">
                    <div>
                      <h2 className="text-lg sm:text-xl font-bold text-foreground">
                        {selectedChapter.name}
                      </h2>
                      <p className="text-xs text-muted-foreground">{selectedSubject.subject}</p>
                    </div>

                    {/* Content Sub-Tabs matching original site */}
                    <div className="flex flex-wrap items-center gap-1.5 bg-muted p-1 rounded-lg">
                      {[
                        { id: 'videos' as ContentTypeTab, label: 'Lectures', icon: Video },
                        { id: 'dpps' as ContentTypeTab, label: 'DPPs', icon: Sparkles },
                        { id: 'notes' as ContentTypeTab, label: 'Notes', icon: FileText },
                        { id: 'DppNotes' as ContentTypeTab, label: 'DPP PDFs', icon: FileCheck2 },
                        { id: 'DppVideos' as ContentTypeTab, label: 'DPP Videos', icon: Play },
                      ].map((tab) => {
                        const Icon = tab.icon;
                        const isSelected = contentType === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setContentType(tab.id)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-background text-foreground shadow-xs'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            <span>{tab.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {itemsLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="skeleton-shimmer h-20 rounded-xl" />
                      ))}
                    </div>
                  ) : items.length === 0 ? (
                    <div className="p-10 text-center border border-dashed rounded-xl bg-card">
                      <p className="font-semibold text-foreground">No {contentType} found for this chapter.</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Try checking the other tabs above (Lectures, Notes, DPPs) or browse other chapters.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {items.map((item) => {
                        const title = item.topic || item.videoDetails?.name || 'Study Material';
                        const duration = item.videoDetails?.duration;
                        const date = item.date ? new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
                        
                        // Extract direct attachments
                        const homeworks = item.homeworkIds || [];
                        const firstAttachment = homeworks[0]?.attachmentIds?.[0];
                        const directPdfUrl = firstAttachment?.baseUrl && firstAttachment?.key 
                          ? `${firstAttachment.baseUrl}${firstAttachment.key}`
                          : null;

                        const isVideo = contentType === 'videos' || contentType === 'DppVideos';

                        return (
                          <div
                            key={item._id}
                            className="border border-border rounded-xl p-4 bg-card hover:border-[#5a4bda]/50 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs"
                          >
                            <div className="flex items-start gap-3.5 min-w-0">
                              <div className="w-12 h-12 rounded-xl bg-sky-100 dark:bg-sky-950/60 text-primary flex items-center justify-center flex-shrink-0">
                                {isVideo ? (
                                  <Play className="w-6 h-6 text-[#5a4bda] fill-[#5a4bda]" />
                                ) : (
                                  <FileText className="w-6 h-6 text-[#5a4bda]" />
                                )}
                              </div>

                              <div className="min-w-0">
                                <h4 className="font-semibold text-foreground text-sm sm:text-base leading-snug line-clamp-2">
                                  {title}
                                </h4>
                                <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground mt-1">
                                  {date && <span>{date}</span>}
                                  {duration && (
                                    <>
                                      <span>•</span>
                                      <span>Duration: {duration}</span>
                                    </>
                                  )}
                                  {item.urlType && (
                                    <>
                                      <span>•</span>
                                      <span className="uppercase text-[10px] font-bold bg-muted px-1.5 py-0.5 rounded">
                                        {item.urlType}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-shrink-0">
                              {isVideo ? (
                                <button
                                  type="button"
                                  onClick={() => handleWatchLecture(item)}
                                  className="inline-flex items-center gap-2 bg-[#5a4bda] hover:bg-[#493abf] text-white text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors cursor-pointer shadow-xs"
                                >
                                  <Play className="w-3.5 h-3.5 fill-white" />
                                  <span>Watch Lecture</span>
                                </button>
                              ) : directPdfUrl ? (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => openPdfViewer(directPdfUrl, title)}
                                    className="inline-flex items-center gap-1.5 bg-[#5a4bda] text-white hover:bg-[#493abf] text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                                  >
                                    <Maximize2 className="w-3.5 h-3.5" />
                                    <span>View Note</span>
                                  </button>
                                  <a
                                    href={directPdfUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download
                                    className="inline-flex items-center gap-1.5 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold p-2 rounded-lg transition-colors"
                                    title="Download PDF"
                                  >
                                    <Download className="w-4 h-4" />
                                  </a>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    // Try fetching schedule for this note item
                                    const sched = await fetchLectureSchedule(batchId, selectedSubject._id, item._id);
                                    if (sched && sched.notes.length > 0 && sched.notes[0].url) {
                                      openPdfViewer(sched.notes[0].url, sched.notes[0].title);
                                    } else {
                                      onToast('Opening note...', 'success');
                                      window.open(`https://s2-cdn.pwnexus.eu.cc/watch?batchId=${batchId}&SubjectId=${selectedSubject._id}&ChildId=${item._id}`, '_blank');
                                    }
                                  }}
                                  className="inline-flex items-center gap-1.5 bg-foreground text-background hover:bg-foreground/90 text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                  <span>Open Material</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: LIVE CLASSES */}
          {activeMainTab === 'live' && (
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">Live Classes & Today's Schedule</h2>
              {classesLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton-shimmer h-24 rounded-xl" />
                  ))}
                </div>
              ) : classes.length === 0 ? (
                <div className="p-12 text-center border border-dashed rounded-xl bg-card">
                  <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-60" />
                  <p className="font-semibold text-foreground text-base">No live classes scheduled right now.</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                    Live lectures stream directly here when scheduled by the faculty. In the meantime, browse recorded lectures in All Classes.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {classes.map((cls) => {
                    const isLive = cls.tag === 'LIVE';
                    return (
                      <div
                        key={cls._id}
                        className="border border-border rounded-xl p-4 bg-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <span
                            className={`px-2 py-1 rounded text-xs font-bold uppercase flex-shrink-0 ${
                              isLive
                                ? 'bg-red-600 text-white animate-pulse'
                                : 'bg-blue-600 text-white'
                            }`}
                          >
                            {cls.tag || 'LIVE STREAM'}
                          </span>
                          <div className="min-w-0">
                            <h4 className="font-bold text-foreground text-sm sm:text-base line-clamp-1">
                              {cls.topic}
                            </h4>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                              <Clock className="w-3.5 h-3.5" />
                              <span>
                                {cls.startTime ? new Date(cls.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                {cls.endTime ? ` - ${new Date(cls.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (cls.videoDetails?.videoUrl || cls.url) {
                              window.open(cls.videoDetails?.videoUrl || cls.url, '_blank');
                            } else {
                              window.open(`https://s2-cdn.pwnexus.eu.cc/live?batchId=${batchId}&ChildId=${cls._id}`, '_blank');
                            }
                          }}
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#5a4bda] hover:bg-[#493abf] text-white text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-white" />
                          <span>{isLive ? 'Join Live Now' : 'Join Class'}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TESTS SERIES */}
          {activeMainTab === 'tests' && (
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">Batch Tests & Practice Tests</h2>
              {testsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton-shimmer h-24 rounded-xl" />
                  ))}
                </div>
              ) : tests.length === 0 ? (
                <div className="p-12 text-center border border-dashed rounded-xl bg-card">
                  <FileQuestion className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-60" />
                  <p className="font-semibold text-foreground text-base">Tests Series Scheduled by Faculty</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                    Weekly mock tests, chapter tests, and DPP test papers are posted here for practice.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tests.map((test: any) => (
                    <div
                      key={test._id}
                      className="border border-border rounded-xl p-4 bg-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <h4 className="font-bold text-foreground text-base line-clamp-1">{test.name || test.title}</h4>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>{test.startTime ? new Date(test.startTime).toLocaleDateString() : 'Active'}</span>
                          <span>•</span>
                          <span>Duration: {test.duration || '60'} mins</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const inst = await fetchTestInstructions(test._id, batchId);
                            setTestInstructions(inst || test);
                          }}
                          className="inline-flex items-center gap-1.5 border border-input bg-background hover:bg-accent text-xs font-semibold px-3 py-2 rounded-lg"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          <span>Syllabus</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onToast('Test session starting...', 'success')}
                          className="inline-flex items-center gap-1.5 bg-[#5a4bda] text-white hover:bg-[#493abf] text-xs font-semibold px-4 py-2 rounded-lg"
                        >
                          <span>Start Test</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: ANNOUNCEMENTS */}
          {activeMainTab === 'announcements' && (
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">Batch Announcements</h2>
              {announcementsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton-shimmer h-28 rounded-xl" />
                  ))}
                </div>
              ) : announcements.length === 0 ? (
                <div className="p-10 text-center border border-dashed rounded-xl bg-card">
                  <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="font-semibold text-foreground">No recent announcements.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Stay tuned on our official Telegram channel for live updates.
                  </p>
                  <a
                    href="https://t.me/GBFreestudy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 mt-4 bg-[#5a4bda] text-white text-xs font-semibold px-4 py-2 rounded-lg"
                  >
                    Join GB STUDY Telegram
                  </a>
                </div>
              ) : (
                <div className="space-y-4">
                  {announcements.map((ann) => (
                    <div key={ann._id} className="border border-border rounded-xl p-5 bg-card">
                      <h4 className="font-bold text-foreground text-base mb-1">{ann.title || 'Announcement'}</h4>
                      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                        {ann.message}
                      </p>
                      {ann.imageUrl && (
                        <div className="mt-3 max-w-md rounded-lg overflow-hidden border">
                          <img src={ann.imageUrl} alt="Announcement visual" className="w-full h-auto" />
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-3">
                        Posted: {ann.createdAt ? new Date(ann.createdAt).toLocaleDateString() : 'Recent'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Video Player Modal with Attached Notes & Previous Server Watch Link */}
      {(activeLectureSchedule || activeLectureMeta) && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-2 sm:p-5 backdrop-blur-xs">
          <div className="bg-background border border-border rounded-xl overflow-hidden max-w-5xl w-full max-h-[95vh] flex flex-col shadow-2xl">
            {/* Player Header */}
            <div className="flex items-center justify-between p-3.5 border-b border-border bg-card">
              <div className="min-w-0 pr-4">
                <h3 className="font-bold text-foreground text-sm sm:text-base line-clamp-1">
                  {activeLectureSchedule?.topic || activeLectureMeta?.topic || 'Class Lecture'}
                </h3>
                <p className="text-xs text-muted-foreground">
                  GB STUDY Player • {batch.name || batch.batchName}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setActiveLectureSchedule(null);
                    setActiveLectureMeta(null);
                  }}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Video Viewport */}
            <div className="relative aspect-video w-full bg-black flex items-center justify-center overflow-hidden">
              {videoLoading ? (
                <div className="text-white text-center space-y-2">
                  <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent animate-spin rounded-full mx-auto" />
                  <p className="text-xs text-gray-300">Connecting stream from server...</p>
                </div>
              ) : activeLectureSchedule?.url ? (
                <iframe
                  src={getYoutubeEmbed(activeLectureSchedule.url)}
                  title={activeLectureSchedule.topic}
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : activeLectureMeta?.videoDetails?.videoUrl ? (
                <iframe
                  src={getYoutubeEmbed(activeLectureMeta.videoDetails.videoUrl)}
                  title={activeLectureMeta.topic}
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : (
                <div className="text-center p-6 text-white space-y-3">
                  <Play className="w-12 h-12 text-[#5a4bda] mx-auto opacity-80" />
                  <p className="text-sm font-semibold">Stream connected to previous server</p>
                  <p className="text-xs text-gray-400 max-w-md">
                    This encrypted DRM lecture can also be opened on the previous server player with 1 click.
                  </p>
                  <a
                    href={`https://s2-cdn.pwnexus.eu.cc/watch?batchId=${batchId}&SubjectId=${selectedSubject?._id}&ChildId=${activeLectureMeta?._id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[#5a4bda] text-white text-xs font-semibold px-4 py-2.5 rounded-lg hover:bg-[#493abf]"
                  >
                    <span>Open in Previous Server Player</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>

            {/* Attached Notes & Controls Bar */}
            <div className="p-3.5 bg-card border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-foreground">Attached Notes & DPPs:</span>
                {activeLectureSchedule?.notes && activeLectureSchedule.notes.length > 0 ? (
                  activeLectureSchedule.notes.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => openPdfViewer(note.url, note.title)}
                      className="inline-flex items-center gap-1.5 bg-muted hover:bg-[#7567ee] hover:text-white text-foreground px-2.5 py-1 rounded-md transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{note.label}: {note.title.slice(0, 20)}...</span>
                    </button>
                  ))
                ) : (
                  <span className="text-muted-foreground text-[11px]">Notes available in Notes tab</span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <a
                  href={`https://s2-cdn.pwnexus.eu.cc/watch?batchId=${batchId}&SubjectId=${selectedSubject?._id}&ChildId=${activeLectureMeta?._id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary hover:underline font-semibold text-xs"
                >
                  <span>Previous Server Watch Link</span>
                  <ExternalLink className="w-3 h-3" />
                </a>

                <a
                  href="https://t.me/GBFreestudy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:underline font-semibold text-xs"
                >
                  <span>Telegram</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* In-app PDF Viewer Modal */}
      {activePdfUrl && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-2 sm:p-5 backdrop-blur-xs">
          <div className="bg-background border border-border rounded-xl overflow-hidden max-w-5xl w-full h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-3.5 border-b border-border bg-card">
              <div className="min-w-0 pr-4">
                <h3 className="font-bold text-foreground text-sm sm:text-base line-clamp-1">
                  {activePdfTitle}
                </h3>
                <p className="text-xs text-muted-foreground">Class Notes PDF Viewer</p>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={activePdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  className="inline-flex items-center gap-1 bg-[#5a4bda] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#493abf]"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </a>
                <button
                  type="button"
                  onClick={() => setActivePdfUrl(null)}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 w-full h-full bg-neutral-900 relative">
              <object
                data={activePdfUrl}
                type="application/pdf"
                className="w-full h-full"
              >
                <iframe
                  src={`https://docs.google.com/viewer?url=${encodeURIComponent(activePdfUrl)}&embedded=true`}
                  title={activePdfTitle}
                  className="w-full h-full border-0"
                />
              </object>
            </div>
          </div>
        </div>
      )}

      {/* Test Instructions Modal */}
      {testInstructions && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-6 backdrop-blur-xs">
          <div className="bg-background border border-border rounded-xl overflow-hidden max-w-2xl w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-foreground text-base">Test Syllabus & Guidelines</h3>
              <button
                type="button"
                onClick={() => setTestInstructions(null)}
                className="p-1 rounded hover:bg-muted"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-sm text-foreground space-y-2 max-h-96 overflow-y-auto">
              <p className="font-semibold">{testInstructions.name || 'Mock Test Guidelines'}</p>
              <div className="p-3 bg-muted rounded-lg text-xs space-y-1">
                <p>• Each question has 4 marks for correct and -1 for incorrect.</p>
                <p>• Attempt all sections within the allotted duration.</p>
                <p>• Solutions and rank analysis will be generated post-submission.</p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setTestInstructions(null)}
                className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
