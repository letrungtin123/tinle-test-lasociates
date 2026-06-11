// ============================================================
// useLessonDetail Hook — Giải mã nội dung bài học từ course blocks
// Sequential → Vertical(s) → Components (video/html/problem)
// Mỗi Vertical = 1 Unit (trang) riêng biệt
// ============================================================

import { useParams } from "react-router-dom";
import { useCourseBlocksRaw } from "@/hooks/useCourses";
import type { LessonDetail, UnitDetail, UnitComponent } from "@/data/types";
import type { Block, VideoBlockData } from "@/api/types";
import { rewriteStaticUrls, sanitizeUrlToRelative } from "@/transformers/staticUrlRewriter";

/**
 * Hook lấy chi tiết bài học từ cấu trúc blocks của course.
 * Trả về mảng `units` (Verticals) giữ nguyên thứ tự từ Studio.
 */
export function useLessonDetail(lessonId: string) {
  const { courseId } = useParams();
  const { data: blocksData, isLoading } = useCourseBlocksRaw(courseId || "");

  let lesson: LessonDetail | null = null;

  if (blocksData?.blocks && lessonId) {
    const blocks = blocksData.blocks;
    const sequentialBlock = blocks[lessonId];

    if (sequentialBlock) {
      // Lấy danh sách Units (Verticals) theo đúng thứ tự children
      const units = buildUnits(sequentialBlock, blocks, courseId || "");

      // Backward-compat: flatten tất cả components để lấy legacy fields
      const allComponents = units.flatMap((u) => u.components);

      // Xác định loại bài học chung (dựa trên component đầu tiên thấy)
      const type = determineLessonType(allComponents);

      // Tìm chapter cha để lấy module tag
      const { moduleTag, lessonNumber } = getModuleInfo(
        sequentialBlock,
        blocks,
        blocksData.root
      );

      // Legacy fields (cho các component chưa migrate)
      const firstVideo = allComponents.find((c) => c.type === "video");
      const firstProblem = allComponents.find((c) => c.type === "problem");
      const htmlContents = allComponents
        .filter((c) => c.type === "html")
        .map((c) => c.htmlContent || "")
        .filter(Boolean);

      lesson = {
        id: sequentialBlock.id,
        type,
        moduleTag,
        lessonNumber,
        title: sequentialBlock.display_name || "Chưa có tiêu đề",
        videoThumbnail: null,
        videoDuration: firstVideo?.videoDuration || "",
        videoCurrentTime: "00:00",
        objectives: [],
        description: "",
        bulletPoints: [],
        mentors: [],
        units,
        // Legacy backward-compat
        _videoUrl: firstVideo?.videoUrl || null,
        _problemUsageKey: firstProblem?.problemUsageKey || null,
        _htmlBlocks: allComponents.filter((c) => c.type === "html").map((c) => c.id),
        _htmlContent: htmlContents.join("\n") || null,
        _studentViewUrl: sanitizeUrlToRelative(allComponents[0]?.studentViewUrl || sequentialBlock.student_view_url || null),
      };
    }
  }

  return { lesson, isLoading };
}

// ── Helpers ──

/**
 * Xây dựng mảng UnitDetail từ sequential → vertical(s) → components.
 * Giữ nguyên thứ tự children array từ Open edX.
 */
function buildUnits(
  sequentialBlock: Block,
  blocks: Record<string, Block>,
  courseId: string
): UnitDetail[] {
  const verticalIds = sequentialBlock.children || [];

  return verticalIds
    .map((vid) => blocks[vid])
    .filter((b): b is Block => b != null && b.type === "vertical")
    .map((vertical) => {
      const componentIds = vertical.children || [];
      const components: UnitComponent[] = componentIds
        .map((cid) => blocks[cid])
        .filter(Boolean)
        .map((block) => buildComponent(block, courseId));

      return {
        id: vertical.id,
        title: vertical.display_name || "",
        components,
      };
    });
}

/**
 * Build 1 UnitComponent từ 1 Block (video/html/problem).
 */
function buildComponent(
  block: Block,
  courseId: string
): UnitComponent {
  const comp: UnitComponent = {
    id: block.id,
    type: block.type,
    displayName: block.display_name || "",
    studentViewUrl: sanitizeUrlToRelative(block.student_view_url || null),
  };

  if (block.type === "video") {
    const videoData = block.student_view_data as VideoBlockData | undefined;
    let videoUrl: string | null = null;
    if (videoData?.encoded_videos) {
      videoUrl = resolveVideoUrl(videoData.encoded_videos);
    }
    if (!videoUrl && block.student_view_url) {
      videoUrl = block.student_view_url;
    }
    comp.videoUrl = sanitizeUrlToRelative(videoUrl);
    comp.videoDuration = videoData?.duration ? formatDuration(videoData.duration) : "";
  }

  if (block.type === "html") {
    const svd = block.student_view_data as Record<string, unknown> | undefined;
    const rawHtml = (svd?.data as string) || (svd?.html as string) || null;
    // Rewrite /static/xxx URLs → LMS asset URLs (student_view_data trả raw HTML chưa rewrite)
    comp.htmlContent = rawHtml ? rewriteStaticUrls(rawHtml, courseId) : null;
  }

  if (block.type === "problem") {
    comp.problemUsageKey = block.id;
  }

  if (block.type === "la_crossword") {
    comp.crosswordUsageKey = block.id;
  }

  if (block.type === "la_sortable") {
    comp.sortableUsageKey = block.id;
  }

  if (block.type === "la_faq") {
    comp.faqUsageKey = block.id;
  }

  if (block.type === "la_pdf") {
    const svd = block.student_view_data as Record<string, unknown> | undefined;
    comp.pdfUrl = (svd?.pdf_url as string) || null;
  }

  if (block.type === "la_diagram") {
    try {
      const svd = block.student_view_data as any;
      if (svd) {
        // XBlock spreads diagram_data into root of student_view_data
        // So svd may contain: { display_name, completed, diagrams, start_diagram_id }
        // Or legacy: { display_name, completed, nodes, edges }
        // Or wrapped: { display_name, completed, diagram_data: {...} }
        let parsed: any = null;

        if (svd.diagram_data) {
          // Wrapped format
          parsed = typeof svd.diagram_data === 'string'
            ? JSON.parse(svd.diagram_data)
            : svd.diagram_data;
        } else if (svd.diagrams) {
          // New spread format: diagrams array at root
          parsed = {
            diagrams: svd.diagrams,
            start_diagram_id: svd.start_diagram_id,
          };
        } else if (Array.isArray(svd.nodes)) {
          // Legacy spread format: nodes/edges at root
          parsed = {
            diagrams: [{
              id: 'default',
              name: block.display_name || 'Sơ đồ',
              nodes: svd.nodes,
              edges: svd.edges || []
            }],
            start_diagram_id: 'default'
          };
        }

        if (parsed) {
          parsed.display_name = block.display_name;
          comp.diagramData = parsed;
        }
      }
    } catch (e) {
      console.error("Failed to parse diagram_data", e);
    }
  }
  if (block.type === "la_single_quiz") {
    comp.singleQuizUsageKey = block.id;
    const svd = block.student_view_data as Record<string, unknown> | undefined;
    if (svd) {
      comp.quizImages = Array.isArray(svd.images) ? svd.images as string[] : [];
      comp.quizVideoUrl = (svd.video_url as string) || null;
    }
  }

  if (block.type === "la_multi_quiz") {
    comp.multiQuizUsageKey = block.id;
    const svd = block.student_view_data as Record<string, unknown> | undefined;
    if (svd) {
      comp.quizImages = Array.isArray(svd.images) ? svd.images as string[] : [];
      comp.quizVideoUrl = (svd.video_url as string) || null;
    }
  }

  return comp;
}

/**
 * Xác định loại bài học từ tất cả components.
 */
function determineLessonType(
  components: UnitComponent[]
): "video" | "quiz" | "slide" {
  for (const c of components) {
    if (c.type === "video") return "video";
    if (c.type === "problem") return "quiz";
    if (c.type === "la_crossword") return "quiz";
    if (c.type === "la_sortable") return "quiz";
    if (c.type === "la_diagram") return "quiz";
    if (c.type === "la_single_quiz") return "quiz";
    if (c.type === "la_multi_quiz") return "quiz";
    if (c.type === "la_faq") return "slide";
    if (c.type === "la_pdf") return "slide";
  }
  if (components.some((c) => c.type === "html")) return "slide";
  return "video";
}

/**
 * Tìm chapter cha và vị trí bài học trong module.
 */
function getModuleInfo(
  sequentialBlock: Block,
  blocks: Record<string, Block>,
  rootId: string
): { moduleTag: string; lessonNumber: string } {
  const rootBlock = blocks[rootId];
  if (!rootBlock?.children) return { moduleTag: "", lessonNumber: "" };

  for (let chIdx = 0; chIdx < rootBlock.children.length; chIdx++) {
    const chapter = blocks[rootBlock.children[chIdx]];
    if (!chapter?.children) continue;

    const seqIndex = chapter.children.indexOf(sequentialBlock.id);
    if (seqIndex !== -1) {
      return {
        moduleTag: `MODULE ${String(chIdx + 1).padStart(2, "0")}`,
        lessonNumber: `Bài ${seqIndex + 1} / ${chapter.children.length}`,
      };
    }
  }

  return { moduleTag: "", lessonNumber: "" };
}

/**
 * Format thời lượng từ giây sang MM:SS.
 */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Chọn URL video tốt nhất.
 */
function resolveVideoUrl(
  encoded: Record<string, { url: string; file_size?: number }>
): string | null {
  const priorities = ["hls", "desktop_mp4", "desktop_webm", "fallback", "youtube"];
  for (const key of priorities) {
    if (encoded[key]?.url) return encoded[key].url;
  }
  const first = Object.values(encoded)[0];
  return first?.url || null;
}
