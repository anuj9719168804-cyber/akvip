import { Batch, SubjectItem, ChapterItem, LectureItem, AnnouncementItem, ScheduleClass } from '../types';

export interface ExtractedNote {
  id: string; title: string; label: string;
  subject?: string; date?: string; url: string; fileName: string;
  batchId?: string; subjectId?: string; pdfId?: string; attachmentId?: string;
}

export interface ScheduleDetailResponse {
  _id: string; topic: string; url?: string; urlType?: string;
  videoDetails?: any; notes: ExtractedNote[]; isLive?: boolean;
}

// ── Safe fetch — never throws JSON parse errors ───────────
async function safeFetch(input: RequestInfo, init?: RequestInit): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(input, init);
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      const t = text.trim();
      // CDN returned plain-text error
      if (t === 'Forbidden' || t === 'Unauthorized' || t.startsWith('Access denied')) {
        data = { success: false, message: 'Session expired. Reconnecting automatically...' };
      } else {
        data = { success: false, message: t.slice(0, 120) };
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e: any) {
    console.warn('[api] fetch error:', e?.message);
    return { ok: false, status: 0, data: null };
  }
}

const FALLBACK_BATCHES: Batch[] = [
  { _id: "698ad3519549b300a5e1cc6a", name: "Arjuna JEE 2027", batchName: "Arjuna JEE 2027", byName: "For IIT-JEE Aspirants", startDate: "13 Apr 2026", endDate: "01 Jul 2028", language: "Hinglish", previewImage: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/bb464a1b-1525-48df-8c4e-a7e607038bf7.jpeg", feeTotal: 3199, type: "E_BATCH", slug: "arjuna-jee-2027-243495" },
  { _id: "6779345c20fa0756e4a7fd08", name: "Lakshya JEE 2027", batchName: "Lakshya JEE 2027", byName: "For JEE Aspirants", startDate: "26 Mar 2026", endDate: "01 Jul 2027", language: "Hinglish", previewImage: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/840830ff-b6f8-41c0-b969-f7f31bad92db.jpeg", feeTotal: 2499, type: "E_BATCH", slug: "lakshya-jee-2027-181537" },
  { _id: "698ad35209494b495cfcc9c4", name: "Prayas 2027", batchName: "Prayas 2027", byName: "For IIT-JEE Aspirants", startDate: "22 Apr 2026", endDate: "01 Jul 2027", language: "Hinglish", previewImage: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/6a95f5ca-dd0c-47a2-b208-02c695c0f037.png", feeTotal: 2499, type: "E_BATCH", slug: "prayas-2027-746901" },
  { _id: "697cddabf050baa08837223e", name: "PARISHRAM 2027 (Class 12th)", batchName: "PARISHRAM 2027 (Class 12th)", byName: "For Class 12th CBSE students", startDate: "23 Apr 2026", endDate: "01 Apr 2027", language: "Hinglish", previewImage: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/503428a1-41c2-4251-88b3-aa816ec9cffc.png", feeTotal: 2500, type: "E_BATCH", slug: "parishram-2027--class-12th--570280" },
  { _id: "69897f0a4c12aeb013d4ea52", name: "Yakeen 2027", batchName: "Yakeen 2027", byName: "For NEET Aspirants", startDate: "15 Apr 2026", endDate: "01 Jul 2027", language: "Hinglish", previewImage: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/ae0f6c39-5c61-443e-8645-862da0d70c41.png", feeTotal: 3800, type: "E_BATCH", slug: "yakeen-2027-995984" },
  { _id: "6991ad489f94154c02bf305e", name: "UDAAN 2028 (Class 10th)", batchName: "UDAAN 2028 (Class 10th)", byName: "For Class 10th CBSE Students", startDate: "07 Apr 2027", endDate: "31 Mar 2028", language: "Hinglish", previewImage: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/9c6bd137-cad9-452a-84a5-b8f50b6dbe47.PNG", feeTotal: 3520, type: "REGULAR", slug: "udaan-2028--class-10th--019551" },
];

export async function fetchAllBatches(page = 1): Promise<{ batches: Batch[]; totalPages: number }> {
  const { ok, data } = await safeFetch(`/api/AllBatches?page=${page}`);
  if (ok && data?.success !== false) {
    const raw = data?.batches || data?.data || [];
    return { batches: Array.isArray(raw) && raw.length > 0 ? raw : (page === 1 ? FALLBACK_BATCHES : []), totalPages: data?.totalPages || 50 };
  }
  return { batches: page === 1 ? FALLBACK_BATCHES : [], totalPages: 1 };
}

export async function searchBatches(query: string, page = 1): Promise<{ batches: Batch[]; totalPages: number }> {
  if (!query.trim()) return fetchAllBatches(page);
  const { ok, data } = await safeFetch(`/api/searchBatch?name=${encodeURIComponent(query)}&page=${page}`);
  if (ok && data?.success !== false) {
    const raw = data?.batches || data?.data || [];
    return { batches: Array.isArray(raw) ? raw : [], totalPages: data?.totalPages || 1 };
  }
  const filtered = FALLBACK_BATCHES.filter(b => (b.name || b.batchName || '').toLowerCase().includes(query.toLowerCase()));
  return { batches: filtered, totalPages: 1 };
}

export async function fetchBatchDetails(batchId: string): Promise<any> {
  const { ok, data } = await safeFetch(`/api/BatchInfo?BatchId=${encodeURIComponent(batchId)}&Type=details`);
  if (ok && data?.success !== false) return data?.data || data;
  const found = FALLBACK_BATCHES.find(b => b._id === batchId || b.batchId === batchId);
  return {
    _id: batchId, name: found?.name || found?.batchName || 'Batch',
    batchName: found?.name || found?.batchName || 'Batch', byName: found?.byName || 'For Aspirants',
    previewImage: found?.previewImage || '', startDate: found?.startDate || 'Starting Soon',
    endDate: found?.endDate || 'Valid for Exam Session',
    subjects: [
      { _id: 'sub_physics', subject: 'Physics By Expert Faculty' },
      { _id: 'sub_chemistry', subject: 'Chemistry By Expert Faculty' },
      { _id: 'sub_maths', subject: 'Mathematics / Biology By Expert Faculty' },
    ],
  };
}

export async function fetchSubjectChapters(batchId: string, subjectId: string, page = 1): Promise<ChapterItem[]> {
  const { ok, data } = await safeFetch(`/api/SubjectInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&page=${page}`);
  if (ok && data) return Array.isArray(data.data) ? data.data : [];
  return [];
}

export async function fetchTopicContent(batchId: string, subjectId: string, topicId: string, contentType: string, page = 1): Promise<LectureItem[]> {
  if (contentType === 'dpps') {
    const { ok, data } = await safeFetch(`/api/dpp-list?batchId=${encodeURIComponent(batchId)}&batchSubjectId=${encodeURIComponent(subjectId)}&chapterId=${encodeURIComponent(topicId)}&page=${page}&limit=20`);
    if (ok && data) {
      const items = Array.isArray(data.data) ? data.data : (data.data?.items || []);
      if (items.length > 0) return items;
    }
  }
  const { ok, data } = await safeFetch(`/api/TopicInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&TopicId=${encodeURIComponent(topicId)}&ContentType=${contentType}&page=${page}`);
  if (ok && data) return Array.isArray(data.data) ? data.data : [];
  return [];
}

export async function fetchLectureSchedule(batchId: string, subjectId: string, contentId: string): Promise<ScheduleDetailResponse | null> {
  const { ok, data } = await safeFetch(`/api/Schedule?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&ContentId=${encodeURIComponent(contentId)}`);
  if (!ok || !data || data.success === false) return null;

  const item = data.data?.data || data.data || data;
  if (!item?._id) return null;

  const rawHomework = Array.isArray(item.homeworkIds) ? item.homeworkIds : [];
  const notes: ExtractedNote[] = [];
  for (const hw of rawHomework) {
    for (const att of (Array.isArray(hw.attachmentIds) ? hw.attachmentIds : [])) {
      const baseUrl = att.baseUrl || '';
      const key = att.key || '';
      // FIX: HAR shows some attachments have empty key — skip those
      if (!key) continue;
      const directUrl = baseUrl && key ? `${baseUrl}${key}` : '';
      const title = hw.topic || hw.name || att.name || 'Class Notes';
      notes.push({
        id: att._id || key || `${item._id}-${hw._id}`,
        title, label: hw.note || (/dpp|test/i.test(title) ? 'DPP' : 'Notes'),
        subject: item.batchSubjectId || '', date: hw.createdAt ? new Date(hw.createdAt).toLocaleDateString() : '',
        url: directUrl, fileName: att.name || `${title}.pdf`,
        batchId, subjectId, pdfId: item._id, attachmentId: att._id,
      });
    }
  }

  let videoUrl = item.url || item.videoDetails?.videoUrl || '';
  // FIX 1: penpencilvdo ke liye HAMESHA video-url endpoint call karo
  // (pehle !videoUrl check tha — isliye call hi nahi hoti thi kyunki item.url already set hota hai)
  // FIX 2: signedUrl already complete URL hoti hai — base se concatenate mat karo
  if (item.urlType === 'penpencilvdo') {
    const { ok: vok, data: vdata } = await safeFetch(
      `/api/video-url?batch_id=${encodeURIComponent(batchId)}&subject_id=${encodeURIComponent(subjectId)}&video_id=${encodeURIComponent(contentId)}`
    );
    if (vok && vdata?.data) {
      // HAR confirmed: url = base path, signedUrl = "?start=...&Signature=...&Policy=..."
      // signedUrl query string hai — base ke saath concatenate karo
      const base   = vdata.data.url || '';
      const signed = vdata.data.signedUrl || '';
      if (base && signed && signed.startsWith('?')) {
        videoUrl = `${base}${signed}`;   // complete signed CloudFront URL
      } else {
        videoUrl = base || signed;        // fallback
      }
    }
  }
  if (!videoUrl && item.videoDetails?.image) {
    const match = item.videoDetails.image.match(/vi\/([a-zA-Z0-9_-]+)/);
    if (match) videoUrl = `https://www.youtube-nocookie.com/embed/${match[1]}?autoplay=1`;
  }

  return {
    _id: item._id,
    topic: item.topic || item.videoDetails?.name || 'Class Lecture',
    url: videoUrl,
    urlType: item.urlType || (videoUrl.includes('youtube') ? 'youtube' : 'penpencilvdo'),
    videoDetails: item.videoDetails,
    notes,
    isLive: item.isLive || item.status === 'LIVE',
  };
}

export async function fetchTodaysSchedule(batchId: string): Promise<ScheduleClass[]> {
  const { ok, data } = await safeFetch('/api/todays-schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId }),
  });
  if (ok && data) return Array.isArray(data.data) ? data.data : [];
  return [];
}

export async function fetchAnnouncements(batchId: string, page = 1): Promise<AnnouncementItem[]> {
  const { ok, data } = await safeFetch(`/api/BatchInfo?BatchId=${encodeURIComponent(batchId)}&Type=announcement&page=${page}`);
  if (ok && data) {
    const list = data.data?.data || data.data || [];
    return Array.isArray(list) ? list : [];
  }
  return [];
}

export async function fetchBatchTests(batchId: string): Promise<any[]> {
  const { ok, data } = await safeFetch(`/api/batch-tests?batchId=${encodeURIComponent(batchId)}`);
  if (ok && data) {
    const list = data.data?.data || data.data || data.tests || [];
    return Array.isArray(list) ? list : [];
  }
  return [];
}

export async function fetchTestInstructions(testId: string, batchId: string): Promise<any> {
  const { ok, data } = await safeFetch(`/api/test-instructions?testId=${encodeURIComponent(testId)}&batchId=${encodeURIComponent(batchId)}`);
  if (ok && data) return data.data || data;
  return null;
}
