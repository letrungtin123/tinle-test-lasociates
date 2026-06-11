// ============================================================
// Block Transformer — Open edX blocks → FE Course/Module/Lesson
// Converts the flat block map from Open edX into the nested
// Course → Module → Lesson structure used by the FE.
// ============================================================

import type { BlocksResponse, Block, VideoBlockData } from "@/api/types";
import type { Course, Module, Lesson } from "@/data/types";

/**
 * Transform the Open edX blocks response into the FE Course structure.
 * Maps: course → chapters (Modules) → sequentials (Lessons)
 */
export function transformBlocksToCourse(data: BlocksResponse): Course {
  const { root, blocks } = data;
  const rootBlock = blocks[root];

  if (!rootBlock) {
    return { id: root, title: "Unknown Course", modules: [] };
  }

  const chapters = getChildrenOfType(rootBlock, blocks, "chapter");

  return {
    id: root,
    title: rootBlock.display_name,
    modules: chapters.map((chapter) => {
      const sequentials = getChildrenOfType(chapter, blocks, "sequential");

      // Tính tổng duration (giây) từ tất cả video blocks trong chapter
      const totalDurationSec = calcModuleDuration(chapter, blocks);

      const lessons = sequentials.map((seq) => {
        const lessonType = detectLessonType(seq, blocks);

        // ── Tính completion từ LEAF blocks ──
        // Open edX chỉ trả completion cho leaf blocks (html, video, problem),
        // sequential/chapter luôn = 0. Phải aggregate từ children.
        const seqCompletion = calcAggregatedCompletion(seq, blocks);

        const lesson: Lesson = {
          id: seq.id,
          title: seq.display_name,
          completed: seqCompletion >= 1.0,
          type: lessonType,
        };
        return lesson;
      });

      // Tính progress % từ completion aggregate của các sequentials
      const completedLessons = lessons.filter((l) => l.completed).length;
      const totalLessons = lessons.length;
      const progressPercent =
        totalLessons > 0
          ? Math.round((completedLessons / totalLessons) * 100)
          : 0;

      const module: Module = {
        id: chapter.id,
        title: chapter.display_name,
        completed: progressPercent === 100,
        progress: `${progressPercent}%`,
        duration: totalDurationSec > 0 ? formatDuration(totalDurationSec) : undefined,
        lessons,
      };

      return module;
    }),
  };
}

// ── Helpers ──

function getChildrenOfType(
  parent: Block,
  blocks: Record<string, Block>,
  type: string
): Block[] {
  return (parent.children || [])
    .map((id) => blocks[id])
    .filter((b): b is Block => b != null && b.type === type);
}

/**
 * Tính completion aggregate từ leaf blocks.
 * Open edX blocks API chỉ trả completion cho leaf blocks (html, video, problem).
 * Sequential/chapter luôn trả 0. Hàm này đệ quy tìm tất cả leaf blocks
 * và tính trung bình completion.
 *
 * Một sequential "hoàn thành" khi tất cả leaf blocks đều completion = 1.0
 */
const LEAF_TYPES = new Set(["html", "video", "problem", "la_crossword", "la_sortable", "la_diagram", "la_faq", "la_pdf", "la_single_quiz", "la_multi_quiz", "discussion", "done"]);

function calcAggregatedCompletion(
  block: Block,
  blocks: Record<string, Block>
): number {
  // Nếu là leaf block → trả completion trực tiếp
  if (LEAF_TYPES.has(block.type)) {
    return block.completion ?? 0;
  }

  // Đệ quy tìm leaf blocks
  const children = (block.children || [])
    .map((id) => blocks[id])
    .filter(Boolean);

  if (children.length === 0) {
    return block.completion ?? 0;
  }

  const leafCompletions: number[] = [];
  function collectLeaves(b: Block) {
    if (LEAF_TYPES.has(b.type)) {
      leafCompletions.push(b.completion ?? 0);
    } else {
      (b.children || []).forEach((childId) => {
        const child = blocks[childId];
        if (child) collectLeaves(child);
      });
    }
  }
  collectLeaves(block);

  if (leafCompletions.length === 0) return 0;
  return leafCompletions.reduce((a, b) => a + b, 0) / leafCompletions.length;
}

/**
 * Tính tổng thời lượng video (giây) cho 1 chapter (module).
 * Đi sâu: chapter → sequential → vertical → video blocks
 */
function calcModuleDuration(
  chapter: Block,
  blocks: Record<string, Block>
): number {
  let totalSeconds = 0;
  const sequentials = getChildrenOfType(chapter, blocks, "sequential");

  for (const seq of sequentials) {
    const verticals = getChildrenOfType(seq, blocks, "vertical");
    for (const v of verticals) {
      const children = (v.children || [])
        .map((id) => blocks[id])
        .filter(Boolean);
      for (const c of children) {
        if (c.type === "video") {
          const svd = c.student_view_data as VideoBlockData | undefined;
          if (svd?.duration && svd.duration > 0) {
            totalSeconds += svd.duration;
          }
        }
      }
    }
  }

  return totalSeconds;
}

/**
 * Xác định loại bài học bằng cách chui vào vertical → components
 */
function detectLessonType(
  sequential: Block,
  blocks: Record<string, Block>
): "video" | "quiz" | "slide" {
  const verticals = getChildrenOfType(sequential, blocks, "vertical");
  for (const v of verticals) {
    const children = (v.children || [])
      .map((id) => blocks[id])
      .filter(Boolean);
    for (const c of children) {
      if (c.type === "video") return "video";
      if (c.type === "problem") return "quiz";
      if (c.type === "la_crossword") return "quiz";
      if (c.type === "la_sortable") return "quiz";
    }
  }
  return "slide";
}

/**
 * Format giây → HH:MM:SS hoặc MM:SS
 */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

