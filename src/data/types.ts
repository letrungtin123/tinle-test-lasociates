// ============================================================
// L&A Onboarding LMS — FE Data Types
// (Extracted from mock.ts — used across all components)
// ============================================================

export interface User {
  name: string;
  role: string;
  joinDate: string;
  avatar: string | null;
  streak: number;
  overallProgress: number;
}

export interface Lesson {
  id: string;
  title: string;
  completed: boolean;
  active?: boolean;
  type?: "video" | "quiz" | "slide";
}

export interface Module {
  id: string;
  title: string;
  progress?: string;
  duration?: string;          // Tổng thời lượng video (MM:SS), tính từ blocks API
  completed: boolean;
  lessons: Lesson[];
}

export interface Course {
  id: string;
  title: string;
  modules: Module[];
}

export interface UnitComponent {
  id: string;
  type: "video" | "html" | "problem" | string;
  displayName: string;
  videoUrl?: string | null;
  videoDuration?: string;
  htmlContent?: string | null;
  problemUsageKey?: string | null;
  crosswordUsageKey?: string | null;
  sortableUsageKey?: string | null;
  faqUsageKey?: string | null;
  pdfUrl?: string | null;
  diagramData?: any;
  singleQuizUsageKey?: string | null;
  multiQuizUsageKey?: string | null;
  quizImages?: string[];
  quizVideoUrl?: string | null;
  studentViewUrl?: string | null;
}

export interface UnitDetail {
  id: string;                        // vertical block id
  title: string;
  components: UnitComponent[];
}

export interface LessonDetail {
  id: string;
  moduleTag: string;
  lessonNumber: string;
  title: string;
  type?: "video" | "quiz" | "slide";
  videoThumbnail: string | null;
  videoDuration: string;
  videoCurrentTime: string;
  objectives: string[];
  description: string;
  bulletPoints: { label: string; text: string }[];
  mentors: Mentor[];
  // Units (Verticals) bên trong Subsection này, theo thứ tự
  units: UnitDetail[];
  // Backward-compat legacy fields (kept for existing code)
  _videoUrl?: string | null;
  _problemUsageKey?: string | null;
  _htmlBlocks?: string[];
  _htmlContent?: string | null;
  _studentViewUrl?: string | null;
}

export interface Mentor {
  id?: number;
  username?: string;
  name: string;
  full_name?: string;
  role: string;
  company: string;
  avatar: string | null;
  email?: string;
  phone_number?: string;
  bio?: string;
  profile_image_url?: string | null;
  profile_image_url_full?: string | null;
}

export interface Notification {
  id: string;
  icon: "badge" | "course" | "system";
  title: string;
  message: string;
  time: string;
  read: boolean;
}

export interface ContinueCourse {
  id: string;
  moduleLabel: string;
  lessonLabel: string;
  title: string;
  thumbnail: string | null;
  categories?: Array<{ id: number; name: string; slug: string }>;
}
