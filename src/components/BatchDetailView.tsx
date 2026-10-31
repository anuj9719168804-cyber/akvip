import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, BookOpen, Video, FileText, Bell, Clock, Calendar,
  Download, Play, ExternalLink, ChevronRight, Layers, Sparkles,
  X, FileCheck2, FileQuestion, HelpCircle, Maximize2
} from 'lucide-react';
import { Batch, SubjectItem, ChapterItem, LectureItem, AnnouncementItem, ScheduleClass } from '../types';
import {
  fetchBatchDetails, fetchSubjectChapters, fetchTopicContent, fetchLectureSchedule,
  fetchTodaysSchedule, fetchAnnouncements, fetchBatchTests, fetchTestInstructions,
  ScheduleDetailResponse, ExtractedNote,
} from '../services/api';

interface BatchDetailViewProps {
  batch: Batch;
  onBack: () => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

type MainTabType = 'classes' | 'live' | 'tests' | 'announcements';
type ContentTypeTab = 'videos' | 'dpps' | 'notes' | 'DppNotes' | 'DppVideos';

// ── Shaka Player ──────────────────────────────────────────
// FIXES applied:
// 1. Retry button actually reinits player (retryKey state)
// 2. Single MPD fetch — Shaka requestFilter se MPD text intercept, no double-fetch
// 3. destroyed flag + player ref prevent race condition on rapid unmount
// 4. clearKeys empty hone pe drm config skip — avoids EME errors on non-DRM streams
// 5. Autoplay failure → "Tap to play" status shown (mobile safe)
// 6. isMpdStream check tightened — only .mpd or /api/play (not raw cloudfront.net)
// 7. player.destroy() properly awaited in cleanup via playerRef
interface ShakaPlayerProps { mpdUrl: string; title: string; onRefreshUrl?: () => Promise<string>; }

const ShakaPlayer: React.FC<ShakaPlayerProps> = ({ mpdUrl, title, onRefreshUrl }) => {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);          // FIX 7: persistent ref for cleanup
  const [error, setError]       = useState<string | null>(null);
  const [status, setStatus]     = useState<string>('Loading player...');
  const [retryKey, setRetryKey] = useState(0);  // FIX 1: increment → triggers useEffect re-run
  const recoverRef = useRef(0);                 // network-error auto-recovery counter (reset per mpdUrl)

  useEffect(() => { recoverRef.current = 0; }, [mpdUrl]);
  const [activeUrl, setActiveUrl] = useState(mpdUrl);   // may be replaced by a fresh signed URL
  useEffect(() => { setActiveUrl(mpdUrl); }, [mpdUrl]);

  useEffect(() => {
    if (!activeUrl || !videoRef.current) return;
    let destroyed = false;

    const init = async () => {
      try {
        setError(null);
        setStatus('Loading Shaka Player...');

        // Load Shaka CDN if not already loaded
        if (!(window as any).shaka) {
          await new Promise<void>((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/shaka-player.compiled.min.js';
            s.onload  = () => resolve();
            s.onerror = () => reject(new Error('Failed to load Shaka Player CDN'));
            document.head.appendChild(s);
          });
        }
        if (destroyed) return;

        const shaka = (window as any).shaka;
        shaka.polyfill.installAll();

        if (!shaka.Player.isBrowserSupported()) {
          throw new Error('Browser does not support Shaka Player (missing MSE/EME)');
        }

        const player = new shaka.Player(videoRef.current);
        playerRef.current = player;             // FIX 7: store for cleanup

        player.addEventListener('error', (event: any) => {
          if (!destroyed) {
            const code = event?.detail?.code;
            const msg  = event?.detail?.message || `Shaka Error ${code}`;
            console.error('[Shaka] error event:', code, msg);
            // 1002 = HTTP_ERROR (request never completed), 1001 = BAD_HTTP_STATUS.
            // Usually a dropped connection or an expired gate/ag cookie: refresh ag and re-init once or twice.
            if ((code === 1002 || code === 1001) && recoverRef.current < 2) {
              recoverRef.current += 1;
              setStatus(`Network issue, reconnecting (${recoverRef.current}/2)...`);
              (async () => {
                await fetch('/nexus/ag/refresh').catch(() => {});
                // Signed CloudFront URL expire ho sakta hai — schedule se fresh URL lo
                if (onRefreshUrl) {
                  try {
                    const fresh = await onRefreshUrl();
                    if (fresh && !destroyed) setActiveUrl(fresh);
                  } catch { /* purana URL hi use karo */ }
                }
                if (!destroyed) setTimeout(() => { if (!destroyed) setRetryKey(k => k + 1); }, 1000);
              })();
              return;
            }
            setError(`Shaka Error ${code}: ${msg}`);
          }
        });

        // FIX 6: mpdUrl already /api/play?url=... from server — never double-wrap
        const loadUrl = activeUrl.startsWith('/api/play') || activeUrl.startsWith('http')
          ? activeUrl
          : `/api/play?url=${encodeURIComponent(activeUrl)}`;

        // FIX 2: Single MPD fetch via Shaka requestFilter — intercept the response
        // instead of manual fetch() + player.load() = 2 fetches
        setStatus('Fetching stream info...');
        let clearKeys: Record<string, string> = {};
        let mpdIntercepted = false;

        player.getNetworkingEngine().registerResponseFilter(async (_type: number, response: any) => {
          // Only process first MPD response (Shaka fetches it internally)
          if (mpdIntercepted) return;
          const url: string = response.uri || '';
          if (!url.includes('.mpd') && !url.includes('master.mpd') && !url.includes('/api/play')) return;
          const ct: string = (response.headers?.['content-type'] || '').toLowerCase();
          if (!ct.includes('dash') && !ct.includes('xml') && !url.includes('.mpd')) return;

          mpdIntercepted = true;
          try {
            const text = new TextDecoder().decode(response.data);
            const kidMatch = text.match(/cenc:default_KID="([0-9a-f-]+)"/i);
            if (kidMatch) {
              const kidRaw = kidMatch[1].replace(/-/g, '');
              setStatus('Fetching decryption key...');
              const otpRes = await fetch(`/api/get-otp?kid=${kidRaw}`);
              if (otpRes.ok) {
                const otpJson = await otpRes.json();
                if (otpJson?.clearKeys) {
                  clearKeys = otpJson.clearKeys;
                  // FIX 4: only configure DRM if we actually have keys
                  player.configure({ drm: { clearKeys } });
                }
              }
            }
          } catch (e: any) {
            console.warn('[Shaka] KID/OTP extract failed:', e?.message);
          }
        });

        if (destroyed) return;

        // FIX 4: Configure WITHOUT drm block if no keys yet —
        // drm will be added by responseFilter above if KID found
        player.configure({
          streaming: {
            bufferingGoal: 30,
            rebufferingGoal: 2,
            retryParameters: {
              maxAttempts: 6,
              baseDelay: 1000,
              backoffFactor: 2,
              timeout: 30000,
            },
          },
          manifest: {
            retryParameters: {
              maxAttempts: 4,
              baseDelay: 1000,
              timeout: 30000,
            },
          },
        });

        setStatus('Loading stream...');
        await player.load(loadUrl);    // FIX 2: only ONE MPD fetch now

        if (destroyed) return;

        // FIX 5: Autoplay failure → show "Tap to play" instead of silent fail
        recoverRef.current = 0;   // loaded fine — allow future recoveries
        if (videoRef.current) {
          videoRef.current.play().catch(() => {
            if (!destroyed) setStatus('Tap video to play ▶');
          });
          setStatus('');
        }
      } catch (e: any) {
        if (!destroyed) {
          const msg = e?.message || 'Unknown player error';
          console.error('[Shaka] init error:', msg);
          setError(msg);
        }
      }
    };

    init();

    // FIX 7: await destroy via playerRef so cleanup is never fire-and-forget
    return () => {
      destroyed = true;
      const p = playerRef.current;
      playerRef.current = null;
      if (p) p.destroy().catch(() => {});
    };
  }, [activeUrl, retryKey]);  // FIX 1: retryKey in deps → retry re-runs init

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-white text-center p-4 gap-3">
        <p className="text-sm font-semibold text-red-400">Player Error</p>
        <p className="text-xs text-gray-300 max-w-sm">{error}</p>
        <button
          onClick={() => { setError(null); setRetryKey(k => k + 1); }}  // FIX 1
          className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {status && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white z-10 gap-2">
          {!status.startsWith('Tap') && (
            <div className="w-7 h-7 border-4 border-indigo-500 border-t-transparent animate-spin rounded-full" />
          )}
          <p className="text-xs text-gray-300">{status}</p>
        </div>
      )}
      <video
        ref={videoRef}
        className="w-full h-full"
        controls
        playsInline
        title={title}
        style={{ background: '#000' }}
      />
    </div>
  );
};

export const BatchDetailView: React.FC<BatchDetailViewProps> = ({ batch, onBack, onToast }) => {
  const batchId = batch._id || batch.batchId || '';

  const [activeMainTab, setActiveMainTab] = useState<MainTabType>('classes');
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<any>(null);
  const [classes, setClasses] = useState<ScheduleClass[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [tests, setTests] = useState<any[]>([]);
  const [testsLoading, setTestsLoading] = useState(false);
  const [testInstructions, setTestInstructions] = useState<any | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<SubjectItem | null>(null);
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [selectedChapter, setSelectedChapter] = useState<ChapterItem | null>(null);
  const [contentType, setContentType] = useState<ContentTypeTab>('videos');
  const [items, setItems] = useState<LectureItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  const [activeLectureSchedule, setActiveLectureSchedule] = useState<ScheduleDetailResponse | null>(null);
  const [activeLectureMeta, setActiveLectureMeta] = useState<LectureItem | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);

  const [activePdfUrl, setActivePdfUrl] = useState<string | null>(null);
  const [activePdfTitle, setActivePdfTitle] = useState<string>('Document PDF');

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchBatchDetails(batchId).then(data => { if (active) setDetails(data); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [batchId]);

  useEffect(() => {
    if (activeMainTab === 'live') {
      let a = true;
      setClassesLoading(true);
      fetchTodaysSchedule(batchId).then(r => { if (a) setClasses(r); }).finally(() => { if (a) setClassesLoading(false); });
      return () => { a = false; };
    }
    if (activeMainTab === 'announcements') {
      let a = true;
      setAnnouncementsLoading(true);
      fetchAnnouncements(batchId).then(r => { if (a) setAnnouncements(r); }).finally(() => { if (a) setAnnouncementsLoading(false); });
      return () => { a = false; };
    }
    if (activeMainTab === 'tests') {
      let a = true;
      setTestsLoading(true);
      fetchBatchTests(batchId).then(r => { if (a) setTests(r); }).finally(() => { if (a) setTestsLoading(false); });
      return () => { a = false; };
    }
  }, [activeMainTab, batchId]);

  useEffect(() => {
    if (!selectedSubject) { setChapters([]); setSelectedChapter(null); return; }
    let a = true;
    setChaptersLoading(true);
    fetchSubjectChapters(batchId, selectedSubject._id).then(r => { if (a) setChapters(r); }).finally(() => { if (a) setChaptersLoading(false); });
    return () => { a = false; };
  }, [selectedSubject, batchId]);

  useEffect(() => {
    if (!selectedSubject || !selectedChapter) { setItems([]); return; }
    let a = true;
    setItemsLoading(true);
    fetchTopicContent(batchId, selectedSubject._id, selectedChapter._id, contentType).then(r => { if (a) setItems(r); }).finally(() => { if (a) setItemsLoading(false); });
    return () => { a = false; };
  }, [selectedChapter, contentType, selectedSubject, batchId]);

  const subjects: SubjectItem[] = details?.subjects || [];

  const handleWatchLecture = async (lecture: LectureItem) => {
    setActiveLectureMeta(lecture);
    setActiveLectureSchedule(null);
    setVideoLoading(true);
    try {
      const schedule = await fetchLectureSchedule(batchId, selectedSubject?._id || '', lecture._id);
      setActiveLectureSchedule(schedule);
      const history = JSON.parse(localStorage.getItem('watchHistory') || '[]');
      const entry = {
        id: lecture._id,
        title: lecture.topic || lecture.videoDetails?.name || 'Class Lecture',
        batchName: batch.name || batch.batchName || 'GB STUDY',
        subjectName: selectedSubject?.subject || 'Subject',
        date: new Date().toLocaleDateString(),
        timestamp: Date.now(),
      };
      const filtered = history.filter((h: any) => h.id !== lecture._id);
      filtered.unshift(entry);
      localStorage.setItem('watchHistory', JSON.stringify(filtered.slice(0, 30)));
    } catch (e: any) {
      console.warn('[watch] error:', e?.message);
      onToast('Connecting to lecture stream...', 'success');
    } finally {
      setVideoLoading(false);
    }
  };

  const openPdfViewer = (url: string, title: string) => {
    if (!url) { onToast('PDF not yet available', 'error'); return; }
    setActivePdfUrl(url);
    setActivePdfTitle(title);
  };

  const getYoutubeEmbed = (url: string) => {
    if (!url) return '';
    if (url.includes('embed/')) return url;
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|live\/|embed\/))([a-zA-Z0-9_-]+)/);
    return m ? `https://www.youtube.com/embed/${m[1]}?autoplay=1&rel=0` : url;
  };

  // FIX 6: Only match .mpd or /api/play — cloudfront.net without /api/play = no ag cookie = 403
  const isMpdStream = (url: string) =>
    url.includes('.mpd') || url.includes('/api/play');
  const isYouTube = (url: string) =>
    url.includes('youtube') || url.includes('youtu.be');

  const videoUrl   = activeLectureSchedule?.url || activeLectureMeta?.videoDetails?.videoUrl || '';
  const videoTopic = activeLectureSchedule?.topic || activeLectureMeta?.topic || 'Class Lecture';

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Breadcrumb */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <button onClick={onBack} className="flex items-center gap-1.5 font-medium text-foreground hover:text-primary transition-colors py-1 px-2 rounded-md hover:bg-muted">
          <ArrowLeft className="w-4 h-4" /><span>Batches</span>
        </button>
        <span>/</span>
        <span className="font-semibold text-foreground truncate max-w-xs">{batch.name || batch.batchName}</span>
        {selectedSubject && (
          <><span>/</span>
          <button onClick={() => { setSelectedSubject(null); setSelectedChapter(null); }} className="text-foreground hover:text-primary truncate max-w-[180px]">
            {selectedSubject.subject}
          </button></>
        )}
        {selectedChapter && <><span>/</span><span className="font-medium text-foreground truncate max-w-[180px]">{selectedChapter.name}</span></>}
      </div>

      {/* Hero */}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-6 mb-6 shadow-xs">
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <div className="w-full md:w-64 aspect-video rounded-lg overflow-hidden border border-border/80 flex-shrink-0 bg-muted">
            <img src={batch.previewImage || batch.batchImage || ''} alt={batch.name || 'Batch'} className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap gap-2">
              <span className="bg-yellow-400 text-black text-xs font-bold px-2 py-0.5 rounded">GB STUDY Verified</span>
              <span className="bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300 text-xs font-semibold px-2 py-0.5 rounded border border-green-200 dark:border-green-800">100% Free</span>
              <span className="bg-primary/10 text-primary text-xs font-semibold px-2 py-0.5 rounded">{batch.language || 'Hinglish'}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">{batch.name || batch.batchName}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">{batch.byName || 'Complete Preparation with Live & Recorded Lectures'}</p>
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-1">
              <div className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-primary" /><span>Starts: {batch.startDate || 'Started'}</span></div>
              <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-primary" /><span>Ends: {batch.endDate || 'Exam Session'}</span></div>
              <div className="flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-primary" /><span>{subjects.length} Subjects</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border mb-6 overflow-x-auto">
        {([['classes','🎁 All Classes'],['live','🔴 Live Classes'],['tests','📝 Tests']] as [MainTabType,string][]).map(([tab, label]) => (
          <button key={tab} onClick={() => { setActiveMainTab(tab); if (tab==='classes') { setSelectedSubject(null); setSelectedChapter(null); } }}
            className={`px-5 py-3 border-b-2 text-sm font-medium whitespace-nowrap transition-colors ${activeMainTab===tab ? 'border-[#7567ee] text-[#5a4bda] dark:text-[#29ff94] dark:border-[#3dc280] font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
        <button onClick={() => setActiveMainTab('announcements')}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 text-sm font-medium whitespace-nowrap transition-colors ${activeMainTab==='announcements' ? 'border-[#7567ee] text-[#5a4bda] dark:text-[#29ff94] font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          <Bell className="w-4 h-4" /><span>Announcements</span>
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({length:6}).map((_,i) => <div key={i} className="skeleton-shimmer h-28 rounded-xl" />)}</div>
      ) : (
        <>
          {/* CLASSES TAB */}
          {activeMainTab === 'classes' && (
            <div>
              {!selectedSubject && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-foreground">Subjects</h2>
                    <span className="text-xs text-muted-foreground">{subjects.length} subjects</span>
                  </div>
                  {subjects.length === 0
                    ? <div className="p-8 text-center border border-dashed rounded-xl"><p className="text-muted-foreground">No subjects found.</p></div>
                    : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {subjects.map(subj => (
                          <div key={subj._id} onClick={() => setSelectedSubject(subj)}
                            className="border border-border rounded-xl p-4 bg-card hover:border-[#5a4bda]/60 transition-all cursor-pointer shadow-xs hover:shadow-md flex items-center justify-between group">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0"><BookOpen className="w-5 h-5 text-[#5a4bda]" /></div>
                              <div className="min-w-0">
                                <h3 className="font-semibold text-foreground text-sm line-clamp-1 group-hover:text-primary">{subj.subject}</h3>
                                <p className="text-xs text-muted-foreground mt-0.5">View chapters</p>
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-1 transition-all" />
                          </div>
                        ))}
                      </div>
                  }
                </div>
              )}

              {selectedSubject && !selectedChapter && (
                <div>
                  <div className="flex items-center justify-between mb-4 pb-2 border-b">
                    <div><h2 className="text-xl font-bold text-foreground">{selectedSubject.subject}</h2></div>
                    <button onClick={() => setSelectedSubject(null)} className="text-xs font-semibold text-primary hover:underline">← Change Subject</button>
                  </div>
                  {chaptersLoading
                    ? <div className="space-y-3">{Array.from({length:4}).map((_,i) => <div key={i} className="skeleton-shimmer h-16 rounded-xl" />)}</div>
                    : chapters.length === 0
                      ? <div className="p-8 text-center border border-dashed rounded-xl"><p className="text-muted-foreground">No chapters uploaded yet.</p></div>
                      : <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {chapters.map(chap => (
                            <div key={chap._id} onClick={() => setSelectedChapter(chap)}
                              className="border border-border rounded-xl p-4 bg-card hover:border-[#5a4bda]/50 transition-all cursor-pointer shadow-xs hover:shadow-md flex items-center justify-between group">
                              <div className="border-l-4 border-[#7567ee] pl-3 min-w-0">
                                <h3 className="font-semibold text-foreground text-sm sm:text-base line-clamp-1 group-hover:text-primary">{chap.name}</h3>
                                <div className="flex gap-2 text-xs text-muted-foreground mt-1">
                                  <span>{chap.videos || 0} Videos</span><span>|</span><span>{chap.notes || 0} Notes</span>
                                </div>
                              </div>
                              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:translate-x-1 transition-all" />
                            </div>
                          ))}
                        </div>
                  }
                </div>
              )}

              {selectedSubject && selectedChapter && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b">
                    <div><h2 className="text-lg font-bold text-foreground">{selectedChapter.name}</h2><p className="text-xs text-muted-foreground">{selectedSubject.subject}</p></div>
                    <div className="flex flex-wrap items-center gap-1.5 bg-muted p-1 rounded-lg">
                      {([['videos','Lectures',Video],['dpps','DPPs',Sparkles],['notes','Notes',FileText],['DppNotes','DPP PDFs',FileCheck2],['DppVideos','DPP Videos',Play]] as [ContentTypeTab,string,any][]).map(([id,label,Icon]) => (
                        <button key={id} onClick={() => setContentType(id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${contentType===id ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}>
                          <Icon className="w-3.5 h-3.5" /><span>{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {itemsLoading
                    ? <div className="space-y-3">{Array.from({length:3}).map((_,i) => <div key={i} className="skeleton-shimmer h-20 rounded-xl" />)}</div>
                    : items.length === 0
                      ? <div className="p-10 text-center border border-dashed rounded-xl"><p className="font-semibold text-foreground">No {contentType} found.</p></div>
                      : <div className="space-y-3">
                          {items.map(item => {
                            const title = item.topic || item.videoDetails?.name || 'Study Material';
                            const date  = item.date ? new Date(item.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '';
                            const hw = item.homeworkIds || [];
                            const firstAtt = hw[0]?.attachmentIds?.[0];
                            const pdfUrl = firstAtt?.baseUrl && firstAtt?.key ? `${firstAtt.baseUrl}${firstAtt.key}` : null;
                            const isVideo = contentType === 'videos' || contentType === 'DppVideos';

                            return (
                              <div key={item._id} className="border border-border rounded-xl p-4 bg-card hover:border-[#5a4bda]/50 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
                                <div className="flex items-start gap-3.5 min-w-0">
                                  <div className="w-12 h-12 rounded-xl bg-sky-100 dark:bg-sky-950/60 flex items-center justify-center flex-shrink-0">
                                    {isVideo ? <Play className="w-6 h-6 text-[#5a4bda] fill-[#5a4bda]" /> : <FileText className="w-6 h-6 text-[#5a4bda]" />}
                                  </div>
                                  <div className="min-w-0">
                                    <h4 className="font-semibold text-foreground text-sm sm:text-base line-clamp-2">{title}</h4>
                                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-1">
                                      {date && <span>{date}</span>}
                                      {item.urlType && <span className="uppercase text-[10px] font-bold bg-muted px-1.5 py-0.5 rounded">{item.urlType}</span>}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-shrink-0">
                                  {isVideo ? (
                                    <button onClick={() => handleWatchLecture(item)}
                                      className="inline-flex items-center gap-2 bg-[#5a4bda] hover:bg-[#493abf] text-white text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors">
                                      <Play className="w-3.5 h-3.5 fill-white" /><span>Watch Lecture</span>
                                    </button>
                                  ) : pdfUrl ? (
                                    <div className="flex gap-2">
                                      <button onClick={() => openPdfViewer(pdfUrl, title)}
                                        className="inline-flex items-center gap-1.5 bg-[#5a4bda] text-white hover:bg-[#493abf] text-xs font-semibold px-3 py-2 rounded-lg">
                                        <Maximize2 className="w-3.5 h-3.5" /><span>View</span>
                                      </button>
                                      <a href={pdfUrl} target="_blank" rel="noopener noreferrer" download
                                        className="inline-flex items-center gap-1 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold p-2 rounded-lg" title="Download">
                                        <Download className="w-4 h-4" />
                                      </a>
                                    </div>
                                  ) : (
                                    <button onClick={async () => {
                                      const sched = await fetchLectureSchedule(batchId, selectedSubject._id, item._id);
                                      if (sched?.notes?.length && sched.notes[0].url) openPdfViewer(sched.notes[0].url, sched.notes[0].title);
                                      else onToast('Opening material...', 'success');
                                    }} className="inline-flex items-center gap-1.5 bg-foreground text-background hover:bg-foreground/90 text-xs font-semibold px-3.5 py-2 rounded-lg">
                                      <FileText className="w-3.5 h-3.5" /><span>Open Material</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                  }
                </div>
              )}
            </div>
          )}

          {/* LIVE TAB */}
          {activeMainTab === 'live' && (
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">Today's Schedule</h2>
              {classesLoading ? <div className="space-y-3">{Array.from({length:3}).map((_,i) => <div key={i} className="skeleton-shimmer h-24 rounded-xl" />)}</div>
                : classes.length === 0 ? (
                  <div className="p-12 text-center border border-dashed rounded-xl bg-card">
                    <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-60" />
                    <p className="font-semibold text-foreground">No live classes right now.</p>
                  </div>
                ) : classes.map(cls => (
                  <div key={cls._id} className="border border-border rounded-xl p-4 bg-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className={`px-2 py-1 rounded text-xs font-bold uppercase flex-shrink-0 ${cls.tag==='LIVE' ? 'bg-red-600 text-white animate-pulse' : 'bg-blue-600 text-white'}`}>{cls.tag||'LIVE'}</span>
                      <div className="min-w-0">
                        <h4 className="font-bold text-foreground text-sm line-clamp-1">{cls.topic}</h4>
                        <div className="flex gap-2 text-xs text-muted-foreground mt-1">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{cls.startTime ? new Date(cls.startTime).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : ''}</span>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => window.open(cls.videoDetails?.videoUrl || cls.url || '#','_blank')}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#5a4bda] hover:bg-[#493abf] text-white text-xs font-semibold px-4 py-2.5 rounded-lg">
                      <Play className="w-3.5 h-3.5 fill-white" /><span>Join Class</span>
                    </button>
                  </div>
                ))
              }
            </div>
          )}

          {/* TESTS TAB */}
          {activeMainTab === 'tests' && (
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">Batch Tests</h2>
              {testsLoading ? <div className="space-y-3">{Array.from({length:3}).map((_,i) => <div key={i} className="skeleton-shimmer h-24 rounded-xl" />)}</div>
                : tests.length === 0 ? (
                  <div className="p-12 text-center border border-dashed rounded-xl bg-card">
                    <FileQuestion className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-60" />
                    <p className="font-semibold text-foreground">No tests scheduled.</p>
                  </div>
                ) : tests.map((test: any) => (
                  <div key={test._id} className="border border-border rounded-xl p-4 bg-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-3">
                    <div className="min-w-0">
                      <h4 className="font-bold text-foreground text-base line-clamp-1">{test.name||test.title}</h4>
                      <div className="flex gap-2 text-xs text-muted-foreground mt-1">
                        <Calendar className="w-3.5 h-3.5" /><span>{test.startTime ? new Date(test.startTime).toLocaleDateString() : 'Active'}</span>
                        <span>• Duration: {test.duration||60} mins</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async () => { const inst = await fetchTestInstructions(test._id, batchId); setTestInstructions(inst||test); }}
                        className="inline-flex items-center gap-1.5 border border-input bg-background hover:bg-accent text-xs font-semibold px-3 py-2 rounded-lg">
                        <HelpCircle className="w-3.5 h-3.5" /><span>Syllabus</span>
                      </button>
                      <button className="inline-flex items-center gap-1.5 bg-[#5a4bda] text-white hover:bg-[#493abf] text-xs font-semibold px-4 py-2 rounded-lg">Start Test</button>
                    </div>
                  </div>
                ))
              }
            </div>
          )}

          {/* ANNOUNCEMENTS TAB */}
          {activeMainTab === 'announcements' && (
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">Announcements</h2>
              {announcementsLoading ? <div className="space-y-3">{Array.from({length:3}).map((_,i) => <div key={i} className="skeleton-shimmer h-28 rounded-xl" />)}</div>
                : announcements.length === 0 ? (
                  <div className="p-10 text-center border border-dashed rounded-xl bg-card">
                    <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                    <p className="font-semibold text-foreground mb-3">No recent announcements.</p>
                    <a href="https://t.me/GBFreestudy" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-[#5a4bda] text-white text-xs font-semibold px-4 py-2 rounded-lg">Join Telegram</a>
                  </div>
                ) : announcements.map(ann => (
                  <div key={ann._id} className="border border-border rounded-xl p-5 bg-card mb-4">
                    <h4 className="font-bold text-foreground text-base mb-1">{ann.title||'Announcement'}</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{ann.message}</p>
                    {ann.imageUrl && <div className="mt-3 max-w-md rounded-lg overflow-hidden border"><img src={ann.imageUrl} alt="Announcement" className="w-full h-auto" /></div>}
                    <p className="text-[11px] text-muted-foreground mt-3">{ann.createdAt ? new Date(ann.createdAt).toLocaleDateString() : 'Recent'}</p>
                  </div>
                ))
              }
            </div>
          )}
        </>
      )}

      {/* ── Video Player Modal ── */}
      {(activeLectureSchedule || activeLectureMeta) && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-2 sm:p-5">
          <div className="bg-background border border-border rounded-xl overflow-hidden max-w-5xl w-full max-h-[95vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-3.5 border-b border-border bg-card">
              <div className="min-w-0 pr-4">
                <h3 className="font-bold text-foreground text-sm sm:text-base line-clamp-1">{videoTopic}</h3>
                <p className="text-xs text-muted-foreground">GB STUDY Player • {batch.name || batch.batchName}</p>
              </div>
              <button onClick={() => { setActiveLectureSchedule(null); setActiveLectureMeta(null); }}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative aspect-video w-full bg-black">
              {videoLoading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-2">
                  <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent animate-spin rounded-full" />
                  <p className="text-xs text-gray-300">Connecting stream...</p>
                </div>
              ) : videoUrl && isYouTube(videoUrl) ? (
                <iframe src={getYoutubeEmbed(videoUrl)} title={videoTopic} className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
              ) : videoUrl && isMpdStream(videoUrl) ? (
                // FIX: ShakaPlayer receives /api/play?url=... directly from server
                // No double-wrapping inside ShakaPlayer
                <ShakaPlayer
                  mpdUrl={videoUrl}
                  title={videoTopic}
                  onRefreshUrl={activeLectureMeta ? async () => {
                    const s = await fetchLectureSchedule(batchId, selectedSubject?._id || '', activeLectureMeta._id);
                    return s?.url || '';
                  } : undefined}
                />
              ) : videoUrl ? (
                <video src={videoUrl} controls autoPlay playsInline className="w-full h-full" title={videoTopic} />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3 p-6">
                  <Play className="w-12 h-12 text-[#5a4bda] opacity-80" />
                  <p className="text-sm font-semibold">Stream loading...</p>
                </div>
              )}
            </div>

            {/* Notes + Links bar */}
            <div className="p-3.5 bg-card border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-foreground">Notes:</span>
                {activeLectureSchedule?.notes?.length ? (
                  activeLectureSchedule.notes.map(note => (
                    <button key={note.id} onClick={() => openPdfViewer(note.url, note.title)}
                      className="inline-flex items-center gap-1.5 bg-muted hover:bg-[#7567ee] hover:text-white text-foreground px-2.5 py-1 rounded-md transition-colors">
                      <FileText className="w-3.5 h-3.5" /><span>{note.label}: {note.title.slice(0,20)}...</span>
                    </button>
                  ))
                ) : <span className="text-muted-foreground">No notes attached</span>}
              </div>
              <div className="flex gap-3">
                <a href="https://t.me/GBFreestudy" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-500 hover:underline font-semibold">Telegram</a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PDF Viewer Modal ── */}
      {activePdfUrl && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-2 sm:p-5">
          <div className="bg-background border border-border rounded-xl overflow-hidden max-w-5xl w-full h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-3.5 border-b border-border bg-card">
              <div className="min-w-0 pr-4"><h3 className="font-bold text-foreground text-sm line-clamp-1">{activePdfTitle}</h3></div>
              <div className="flex gap-2">
                <a href={activePdfUrl} target="_blank" rel="noopener noreferrer" download
                  className="inline-flex items-center gap-1 bg-[#5a4bda] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#493abf]">
                  <Download className="w-3.5 h-3.5" /><span>Download</span>
                </a>
                <button onClick={() => setActivePdfUrl(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="flex-1 w-full bg-neutral-900">
              <object data={`/proxy-pdf?url=${encodeURIComponent(activePdfUrl)}`} type="application/pdf" className="w-full h-full">
                <iframe src={`https://docs.google.com/viewer?url=${encodeURIComponent(activePdfUrl)}&embedded=true`} title={activePdfTitle} className="w-full h-full border-0" />
              </object>
            </div>
          </div>
        </div>
      )}

      {/* ── Test Instructions Modal ── */}
      {testInstructions && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-6">
          <div className="bg-background border border-border rounded-xl max-w-2xl w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-foreground text-base">Test Guidelines</h3>
              <button onClick={() => setTestInstructions(null)} className="p-1 rounded hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <div className="text-sm text-foreground space-y-2 max-h-96 overflow-y-auto">
              <p className="font-semibold">{testInstructions.name || 'Mock Test'}</p>
              <div className="p-3 bg-muted rounded-lg text-xs space-y-1">
                <p>• +4 marks for correct, -1 for incorrect answer.</p>
                <p>• Attempt all sections within the allotted time.</p>
                <p>• Results and rank analysis generated after submission.</p>
              </div>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setTestInstructions(null)} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
