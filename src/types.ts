export interface Batch {
  _id: string;
  batchId?: string;
  name?: string;
  batchName?: string;
  byName?: string;
  startDate?: string;
  endDate?: string;
  language?: string;
  previewImage?: string;
  batchImage?: string;
  feeTotal?: number;
  batchPrice?: number;
  type?: string;
  template?: string;
  slug?: string;
  subBatches?: any[];
}

export interface Teacher {
  _id?: string;
  name?: string;
  imageUrl?: string;
  photoUrl?: string;
  subject?: string;
}

export interface SubjectItem {
  _id: string;
  subject: string;
  name?: string;
  imageId?: { baseUrl?: string; key?: string } | string;
  teacherName?: string;
  teacherImage?: string;
  description?: string;
}

export interface ChapterItem {
  _id: string;
  name: string;
  type?: string;
  notes?: number;
  exercises?: number;
  videos?: number;
  lectureVideos?: number;
  slug?: string;
}

export interface Attachment {
  _id?: string;
  baseUrl?: string;
  key?: string;
  name?: string;
}

export interface Homework {
  _id: string;
  topic: string;
  note?: string;
  actions?: string[];
  attachmentIds?: Attachment[];
}

export interface LectureItem {
  _id: string;
  topic: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  urlType?: string;
  url?: string;
  teachers?: string[];
  videoDetails?: {
    _id?: string;
    name?: string;
    image?: string;
    duration?: string;
    videoUrl?: string;
    embedCode?: string;
    description?: string;
  };
  homeworkIds?: Homework[];
  hasAttachment?: boolean;
}

export interface ScheduleClass {
  _id: string;
  topic: string;
  startTime?: string;
  endTime?: string;
  date?: string;
  urlType?: string;
  url?: string;
  teachers?: string[];
  videoDetails?: {
    name?: string;
    videoUrl?: string;
    image?: string;
  };
  tag?: string;
}

export interface AnnouncementItem {
  _id: string;
  title?: string;
  message?: string;
  createdAt?: string;
  imageUrl?: string;
  author?: string;
}

export type NavTab = 
  | 'study'
  | 'batches'
  | 'pi'
  | 'nexttoppers'
  | 'missionjeet'
  | 'vibrant'
  | 'sway'
  | 'mybatches'
  | 'history'
  | 'telegram'
  | 'contact';
