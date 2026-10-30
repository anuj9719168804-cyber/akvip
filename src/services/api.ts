import { Batch, SubjectItem, ChapterItem, LectureItem, AnnouncementItem, ScheduleClass } from '../types';

export interface ExtractedNote {
  id: string;
  title: string;
  label: string;
  subject?: string;
  date?: string;
  url: string;
  fileName: string;
  batchId?: string;
  subjectId?: string;
  pdfId?: string;
  attachmentId?: string;
}

export interface ScheduleDetailResponse {
  _id: string;
  topic: string;
  url?: string;
  urlType?: string;
  videoDetails?: any;
  notes: ExtractedNote[];
  isLive?: boolean;
}

const FALLBACK_BATCHES: Batch[] = [
  {
    _id: "698ad3519549b300a5e1cc6a",
    name: "Arjuna JEE 2027",
    batchName: "Arjuna JEE 2027",
    byName: "For IIT-JEE Aspirants",
    startDate: "13 Apr 2026",
    endDate: "01 Jul 2028",
    language: "Hinglish",
    previewImage: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/bb464a1b-1525-48df-8c4e-a7e607038bf7.jpeg",
    feeTotal: 3199,
    type: "E_BATCH",
    slug: "arjuna-jee-2027-243495"
  },
  {
    _id: "6779345c20fa0756e4a7fd08",
    name: "Lakshya JEE 2027",
    batchName: "Lakshya JEE 2027",
    byName: "For JEE Aspirants",
    startDate: "26 Mar 2026",
    endDate: "01 Jul 2027",
    language: "Hinglish",
    previewImage: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/840830ff-b6f8-41c0-b969-f7f31bad92db.jpeg",
    feeTotal: 2499,
    type: "E_BATCH",
    slug: "lakshya-jee-2027-181537"
  },
  {
    _id: "698ad35209494b495cfcc9c4",
    name: "Prayas 2027",
    batchName: "Prayas 2027",
    byName: "For IIT-JEE Aspirants",
    startDate: "22 Apr 2026",
    endDate: "01 Jul 2027",
    language: "Hinglish",
    previewImage: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/6a95f5ca-dd0c-47a2-b208-02c695c0f037.png",
    feeTotal: 2499,
    type: "E_BATCH",
    slug: "prayas-2027-746901"
  },
  {
    _id: "697cddabf050baa08837223e",
    name: "PARISHRAM 2027 (Class 12th)",
    batchName: "PARISHRAM 2027 (Class 12th)",
    byName: "For Class 12th CBSE students",
    startDate: "23 Apr 2026",
    endDate: "01 Apr 2027",
    language: "Hinglish",
    previewImage: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/503428a1-41c2-4251-88b3-aa816ec9cffc.png",
    feeTotal: 2500,
    type: "E_BATCH",
    slug: "parishram-2027--class-12th--570280"
  },
  {
    _id: "69897f0a4c12aeb013d4ea52",
    name: "Yakeen 2027",
    batchName: "Yakeen 2027",
    byName: "For NEET Aspirants",
    startDate: "15 Apr 2026",
    endDate: "01 Jul 2027",
    language: "Hinglish",
    previewImage: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/ae0f6c39-5c61-443e-8645-862da0d70c41.png",
    feeTotal: 3800,
    type: "E_BATCH",
    slug: "yakeen-2027-995984"
  },
  {
    _id: "6991ad489f94154c02bf305e",
    name: "UDAAN 2028 (Class 10th)",
    batchName: "UDAAN 2028 (Class 10th)",
    byName: "For Class 10th CBSE Students",
    startDate: "07 Apr 2027",
    endDate: "31 Mar 2028",
    language: "Hinglish",
    previewImage: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/9c6bd137-cad9-452a-84a5-b8f50b6dbe47.PNG",
    feeTotal: 3520,
    type: "REGULAR",
    slug: "udaan-2028--class-10th--019551"
  }
];

export async function fetchAllBatches(page = 1): Promise<{ batches: Batch[]; totalPages: number }> {
  try {
    const res = await fetch(`/api/AllBatches?page=${page}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    const rawBatches = data.batches || data.data || [];
    return {
      batches: Array.isArray(rawBatches) && rawBatches.length > 0 ? rawBatches : (page === 1 ? FALLBACK_BATCHES : []),
      totalPages: data.totalPages || 50,
    };
  } catch (error) {
    console.warn('API error fetching all batches, using fallback:', error);
    return {
      batches: page === 1 ? FALLBACK_BATCHES : [],
      totalPages: 1,
    };
  }
}

export async function searchBatches(query: string, page = 1): Promise<{ batches: Batch[]; totalPages: number }> {
  if (!query.trim()) {
    return fetchAllBatches(page);
  }
  try {
    const res = await fetch(`/api/searchBatch?name=${encodeURIComponent(query)}&page=${page}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    const rawBatches = data.batches || data.data || [];
    return {
      batches: Array.isArray(rawBatches) ? rawBatches : [],
      totalPages: data.totalPages || 1,
    };
  } catch (error) {
    console.warn('API error searching batches:', error);
    const filtered = FALLBACK_BATCHES.filter(b => 
      (b.name || b.batchName || '').toLowerCase().includes(query.toLowerCase())
    );
    return { batches: filtered, totalPages: 1 };
  }
}

export async function fetchBatchDetails(batchId: string): Promise<any> {
  try {
    const res = await fetch(`/api/BatchInfo?BatchId=${encodeURIComponent(batchId)}&Type=details`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const json = await res.json();
    return json.data || json;
  } catch (error) {
    console.warn('API error fetching batch details:', error);
    const found = FALLBACK_BATCHES.find(b => b._id === batchId || b.batchId === batchId);
    return {
      _id: batchId,
      name: found?.name || found?.batchName || "Batch",
      batchName: found?.name || found?.batchName || "Batch",
      byName: found?.byName || "For Aspirants",
      previewImage: found?.previewImage || "",
      startDate: found?.startDate || "Starting Soon",
      endDate: found?.endDate || "Valid for Exam Session",
      subjects: [
        { _id: 'sub_physics', subject: 'Physics By Expert Faculty' },
        { _id: 'sub_chemistry', subject: 'Chemistry By Expert Faculty' },
        { _id: 'sub_maths', subject: 'Mathematics / Biology By Expert Faculty' }
      ]
    };
  }
}

export async function fetchSubjectChapters(batchId: string, subjectId: string, page = 1): Promise<ChapterItem[]> {
  try {
    const res = await fetch(`/api/SubjectInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&page=${page}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  } catch (error) {
    console.warn('API error fetching subject chapters:', error);
    return [];
  }
}

export async function fetchTopicContent(
  batchId: string,
  subjectId: string,
  topicId: string,
  contentType: string,
  page = 1
): Promise<LectureItem[]> {
  try {
    // If DPP tab is requested, try dpp-list endpoint first
    if (contentType === 'dpps') {
      try {
        const dppRes = await fetch(`/api/dpp-list?batchId=${encodeURIComponent(batchId)}&batchSubjectId=${encodeURIComponent(subjectId)}&chapterId=${encodeURIComponent(topicId)}&page=${page}&limit=20`);
        if (dppRes.ok) {
          const dppJson = await dppRes.json();
          const items = Array.isArray(dppJson.data) ? dppJson.data : (dppJson.data?.items || []);
          if (items.length > 0) return items;
        }
      } catch (e) {
        console.warn('dpp-list call failed, fallback to TopicInfo', e);
      }
    }

    const res = await fetch(
      `/api/TopicInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&TopicId=${encodeURIComponent(topicId)}&ContentType=${contentType}&page=${page}`
    );
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  } catch (error) {
    console.warn('API error fetching topic content:', error);
    return [];
  }
}

// Fetch complete schedule and attachments for a lecture
export async function fetchLectureSchedule(
  batchId: string,
  subjectId: string,
  contentId: string
): Promise<ScheduleDetailResponse | null> {
  try {
    const res = await fetch(
      `/api/Schedule?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&ContentId=${encodeURIComponent(contentId)}`
    );
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const json = await res.json();
    const data = json.data?.data || json.data || json;

    if (!data) return null;

    // Extract notes & DPP attachments from homeworkIds
    const rawHomework = Array.isArray(data.homeworkIds) ? data.homeworkIds : [];
    const notes: ExtractedNote[] = [];

    for (const hw of rawHomework) {
      const attachments = Array.isArray(hw.attachmentIds) ? hw.attachmentIds : [];
      for (const att of attachments) {
        const baseUrl = att.baseUrl || '';
        const key = att.key || '';
        const directUrl = baseUrl && key ? `${baseUrl}${key}` : '';
        const title = hw.topic || hw.name || att.name || 'Class Notes';
        const label = hw.note || (/dpp|test/i.test(title) ? 'DPP' : 'Notes');

        notes.push({
          id: att._id || key || `${data._id}-${hw._id}`,
          title,
          label,
          subject: data.batchSubjectId || '',
          date: hw.createdAt ? new Date(hw.createdAt).toLocaleDateString() : '',
          url: directUrl,
          fileName: att.name || `${title}.pdf`,
          batchId,
          subjectId,
          pdfId: data._id,
          attachmentId: att._id,
        });
      }
    }

    // Determine working video URL
    let videoUrl = data.url || data.videoDetails?.videoUrl || '';
    if (!videoUrl && data.videoDetails?.image) {
      const match = data.videoDetails.image.match(/vi\/([a-zA-Z0-9_-]+)/);
      if (match) {
        videoUrl = `https://www.youtube-nocookie.com/embed/${match[1]}?autoplay=1`;
      }
    }

    return {
      _id: data._id,
      topic: data.topic || data.videoDetails?.name || 'Class Lecture',
      url: videoUrl,
      urlType: data.urlType || (videoUrl.includes('youtube') ? 'youtube' : 'penpencilvdo'),
      videoDetails: data.videoDetails,
      notes,
      isLive: data.isLive || data.status === 'LIVE',
    };
  } catch (error) {
    console.warn('API error fetching lecture schedule:', error);
    return null;
  }
}

export async function fetchTodaysSchedule(batchId: string): Promise<ScheduleClass[]> {
  try {
    const res = await fetch('/api/todays-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId }),
    });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  } catch (error) {
    console.warn('API error fetching today schedule:', error);
    return [];
  }
}

export async function fetchAnnouncements(batchId: string, page = 1): Promise<AnnouncementItem[]> {
  try {
    const res = await fetch(`/api/BatchInfo?BatchId=${encodeURIComponent(batchId)}&Type=announcement&page=${page}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const json = await res.json();
    const data = json.data?.data || json.data || [];
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn('API error fetching announcements:', error);
    return [];
  }
}

export async function fetchBatchTests(batchId: string): Promise<any[]> {
  try {
    const res = await fetch(`/api/batch-tests?batchId=${encodeURIComponent(batchId)}`);
    if (!res.ok) return [];
    const json = await res.json();
    const list = json.data?.data || json.data || json.tests || [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function fetchTestInstructions(testId: string, batchId: string): Promise<any> {
  try {
    const res = await fetch(`/api/test-instructions?testId=${encodeURIComponent(testId)}&batchId=${encodeURIComponent(batchId)}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || json;
  } catch {
    return null;
  }
}
