import { VideoPlayer } from "@/components/lesson/VideoPlayer";
import { LessonSkeleton } from "@/components/skeletons/LessonSkeleton";
import { QuizContent } from "@/components/lesson/QuizContent";
import { UnitNavButtons } from "@/components/lesson/UnitNavButtons";
import { usePageLoading } from "@/hooks/usePageLoading";
import { useAppStore } from "@/stores/useAppStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { useLessonDetail } from "@/hooks/useLessonDetail";
import { useCourse, useCourseStructure, useCourseMentors } from "@/hooks/useCourses";
import { useCourseFiles } from "@/hooks/useCourseFiles";
import type { CourseFile } from "@/hooks/useCourseFiles";
import { BookOpen, Download, FileText, FileSpreadsheet, Presentation, MessageCircle, CheckCircle2, ChevronUp } from "lucide-react";
import { MentorSidebar } from "@/components/lesson/MentorSidebar";
import { LessonImageCarousel } from "@/components/lesson/LessonImageCarousel";
import { useParams, useNavigate } from "react-router-dom";
import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import { sanitizeUrlToRelative } from "@/transformers/staticUrlRewriter";

import { markBlocksComplete } from "@/api/progress";
import { refetchProgressWithRetry } from "@/lib/progressRefetch";
import { CrosswordContent } from "@/components/lesson/CrosswordContent";
import { SortableContent } from "@/components/lesson/SortableContent";
import { FaqContent } from "@/components/lesson/FaqContent";
import { PdfContent } from "@/components/lesson/PdfContent";
import DiagramContent from "@/components/lesson/DiagramContent";
import { CompleteCourseModal } from "@/components/lesson/CompleteCourseModal";
import { Course100PercentModal } from "@/components/lesson/Course100PercentModal";
import { WelcomeCourseModal } from "@/components/lesson/WelcomeCourseModal";
import { SectionCompleteModal } from "@/components/lesson/SectionCompleteModal";
import { useCourseCompletion } from "@/hooks/useProgress";
import { useCourseModalConfig } from "@/hooks/useModalConfig";
import LogoLanda from "@/assets/leandassociate.webp";

// ── Badge component (declared outside render to satisfy React Compiler) ──
const BadgeCyan = ({ children }: { children: React.ReactNode }) => (
  <span
    className="mb-1 inline-block rounded-full px-3 py-1 text-[10px] font-semibold leading-[14px] uppercase tracking-widest"
    style={{ backgroundColor: "#43FDD7", color: "#000" }}
  >
    {children}
  </span>
);

// Block types chỉ cần xem, không cần tương tác → auto-mark complete khi user navigate đến unit
const PASSIVE_BLOCK_TYPES = ["html", "video", "la_diagram", "la_faq", "la_pdf"];
const INTERACTIVE_BLOCK_TYPES = ["problem", "la_crossword", "la_sortable"];

export function LessonDetailPage() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const { completionPercent, isLoading: isProgressLoading } = useCourseCompletion(courseId);
  const { data: modalConfig } = useCourseModalConfig(courseId);
  const currentLessonId = useAppStore((s) => s.currentLessonId);
  const currentUnitIndex = useAppStore((s) => s.currentUnitIndex);
  const nextUnit = useAppStore((s) => s.nextUnit);
  const prevUnit = useAppStore((s) => s.prevUnit);
  const setCurrentLesson = useAppStore((s) => s.setCurrentLesson);
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const { isLoading: pageLoading } = usePageLoading(800, currentLessonId);
  const { lesson, isLoading: dataLoading } = useLessonDetail(currentLessonId);
  const { data: courseDetail } = useCourse(courseId || "");
  const { data: courseTree } = useCourseStructure(courseId || "");
  const { data: fetchedMentors } = useCourseMentors(courseId || "");
  const { data: refDocs = [] } = useCourseFiles(courseId || "");

  // Auto-select first lesson if none is selected or not in current course
  useEffect(() => {
    if (courseTree && courseTree.modules && courseTree.modules.length > 0) {
      let lessonExists = false;
      if (currentLessonId) {
        for (const mod of courseTree.modules) {
          if (mod.lessons.some((l) => l.id === currentLessonId)) {
            lessonExists = true;
            break;
          }
        }
      }

      if (!lessonExists) {
        const firstMod = courseTree.modules[0];
        if (firstMod && firstMod.lessons && firstMod.lessons.length > 0) {
          const firstLesson = firstMod.lessons[0];
          setCurrentLesson(firstMod.id, firstLesson.id);
        }
      }
    }
  }, [courseTree, currentLessonId, setCurrentLesson]);

  // Scroll to top khi đổi unit
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scrollContainer = document.getElementById("course-main-scroll");
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentUnitIndex]);

  // Lightbox state
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!lightboxSrc) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxSrc(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxSrc]);

  // Hook lắng nghe sự kiện scroll để hiện nút Back to Top
  const [showScrollTop, setShowScrollTop] = useState(false);
  useEffect(() => {
    const scrollContainer = document.getElementById("course-main-scroll");
    if (!scrollContainer) return;

    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      setShowScrollTop(target.scrollTop > 400);
    };

    scrollContainer.addEventListener("scroll", handleScroll);
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, []);

  // Kiểm tra bài học đã hoàn thành chưa
  const isCompleted = useMemo(() => {
    if (!courseTree || !lesson) return false;
    for (const mod of courseTree.modules) {
      const found = mod.lessons.find((l) => l.id === lesson.id);
      if (found) return found.completed;
    }
    return false;
  }, [courseTree, lesson]);

  // ── Mutation: Đánh dấu hoàn thành bài học ──
  // Open edX chỉ track completion cho LEAF blocks (html, video).
  // Problem blocks tự mark khi user submit quiz.
  // Nên khi click "Hoàn thành" → mark tất cả html/video blocks trong lesson.
  const leafBlockIds = useMemo(() => {
    if (!lesson) return [];
    return lesson.units.flatMap((unit) =>
      unit.components
        .filter((c) => c.type === "html" || c.type === "video" || c.type === "la_diagram" || c.type === "la_faq" || c.type === "la_pdf")
        .map((c) => c.id)
    );
  }, [lesson]);

  const completeMutation = useMutation({
    mutationFn: () =>
      markBlocksComplete(user?.username || "", courseId || "", leafBlockIds),
    onSuccess: () => {
      refetchProgressWithRetry(qc);
    },
  });


  // ✅ Hooks phải gọi TRƯỚC mọi early return
  const mentors = useMemo(() => {
    if (!fetchedMentors || fetchedMentors.length === 0) return [];
    return fetchedMentors.map((m) => ({
      id: m.id,
      username: m.username,
      name: m.name || m.full_name,
      full_name: m.full_name,
      role: m.role,
      company: '',
      email: m.email,
      phone_number: m.phone_number,
      bio: m.bio,
      avatar: sanitizeUrlToRelative(m.profile_image_url || null),
      profile_image_url: sanitizeUrlToRelative(m.profile_image_url || null),
      profile_image_url_full: sanitizeUrlToRelative(m.profile_image_url_full || null),
    }));
  }, [fetchedMentors]);

  // Unit navigation handlers
  const totalUnits = lesson?.units.length || 0;
  const currentUnit = lesson?.units[currentUnitIndex] || null;
  const isLastUnit = currentUnitIndex >= totalUnits - 1;

  // ── Auto-mark passive blocks (la_faq, html, video, la_diagram) khi user vào unit ──
  // Các block này chỉ cần xem, không cần tương tác → mark complete ngay khi navigate đến.
  // Đảm bảo khi unit có mix interactive (sortable/crossword/problem) + passive (faq/text/video),
  // submit xong interactive thì unit sẽ đạt 100% completion.
  useEffect(() => {
    if (!currentUnit || !user?.username || !courseId) return;

    // Chỉ auto-mark khi unit có MIX interactive + passive.
    // Khi unit chỉ có passive blocks → giữ logic cũ (click "Hoàn thành" / "Tiếp tục").
    const hasInteractive = currentUnit.components.some((c) => INTERACTIVE_BLOCK_TYPES.includes(c.type));
    if (!hasInteractive) return;

    const passiveIds = currentUnit.components
      .filter((c) => PASSIVE_BLOCK_TYPES.includes(c.type))
      .map((c) => c.id);

    if (passiveIds.length === 0) return;

    markBlocksComplete(user.username, courseId, passiveIds)
      .then(() => {
        refetchProgressWithRetry(qc);
      })
      .catch((e) => console.error("Failed to auto-mark passive blocks:", e));
  }, [currentUnit?.id, user?.username, courseId]);

  // Xác định next lesson & module trong toàn bộ course structure
  const { nextLessonId, nextModuleId } = useMemo(() => {
    let nLessonId: string | null = null;
    let nModuleId: string | null = null;
    if (courseTree && currentLessonId) {
      let foundCurrent = false;
      for (const mod of courseTree.modules) {
        for (const l of mod.lessons) {
          if (foundCurrent) {
            nLessonId = l.id;
            nModuleId = mod.id;
            break;
          }
          if (l.id === currentLessonId) {
            foundCurrent = true;
          }
        }
        if (nLessonId) break;
      }
    }
    return { nextLessonId: nLessonId, nextModuleId: nModuleId };
  }, [courseTree, currentLessonId]);

  const handleNextLesson = useCallback(() => {
    if (nextModuleId && nextLessonId) {
      setCurrentLesson(nextModuleId, nextLessonId);
      navigate(`/courses/${encodeURIComponent(courseId || "c1")}/lessons/${nextLessonId}`);
    }
  }, [nextModuleId, nextLessonId, setCurrentLesson, navigate, courseId]);

  const handleNext = useCallback(() => {
    // Tự động mark hoàn thành cho các block text/video ở Unit HIỆN TẠI
    if (currentUnit && user?.username && courseId) {
      const leafIdsToMark = currentUnit.components
        .filter((c) => c.type === "html" || c.type === "video" || c.type === "la_diagram" || c.type === "la_faq" || c.type === "la_pdf")
        .map((c) => c.id);

      if (leafIdsToMark.length > 0) {
        markBlocksComplete(user.username, courseId, leafIdsToMark)
          .catch((e) => console.error("Failed to auto-mark block on next:", e))
          .finally(() => {
            refetchProgressWithRetry(qc);
          });
      }
    }

    nextUnit(totalUnits);
  }, [currentUnit, user?.username, courseId, qc, nextUnit, totalUnits]);

  const handlePrev = useCallback(() => {
    prevUnit();
  }, [prevUnit]);

  const handleComplete = useCallback(() => {
    if (!isCompleted && leafBlockIds.length > 0) {
      completeMutation.mutate();
    }
  }, [isCompleted, leafBlockIds, completeMutation]);

  if (pageLoading || dataLoading) {
    return <LessonSkeleton />;
  }

  if (!lesson) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-4">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <BookOpen className="h-8 w-8 text-muted-foreground/50" />
        </div>
        <h2 className="mb-2 text-[20px] font-bold leading-[24px] text-foreground">
          Nội dung chưa sẵn sàng
        </h2>
        <p className="text-[14px] font-normal leading-[18px] text-muted-foreground max-w-md">
          Bài học này chưa có nội dung. Vui lòng chọn bài học khác hoặc liên hệ
          giảng viên.
        </p>
      </div>
    );
  }

  // Icon theo loại file
  function getDocIcon(ext: string) {
    if (["pdf", "doc", "docx"].includes(ext)) return FileText;
    if (["xls", "xlsx", "csv"].includes(ext)) return FileSpreadsheet;
    if (["ppt", "pptx"].includes(ext)) return Presentation;
    return FileText;
  }

  return (
    <div className="flex min-h-full w-full flex-col">
      {/* Main Area */}
      <div className="flex flex-1">
        {/* ── Left: Main Content ── */}
        <div className="flex-1 min-w-0" ref={contentRef}>
          <div className="w-full px-6 py-6 md:px-7 md:py-8 2xl:px-8 2xl:py-12">
            {/* Header: Module + Tiêu đề + Progress */}
            <div className="mb-4 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div className="flex-1">
                {/* Module tag + Lesson counter */}
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <span
                    className="inline-block rounded-full px-4 py-1.5 text-[10px] 2xl:text-[12px] font-bold leading-[14px] uppercase tracking-wider"
                    style={{ backgroundColor: "#43FDD7", color: "#000" }}
                  >
                    {lesson.moduleTag}
                  </span>
                  <span className="text-[14px] 2xl:text-[16px] font-normal leading-[18px] 2xl:leading-[22px] text-muted-foreground">
                    Lesson {Math.min(currentUnitIndex + 1, totalUnits)} of {totalUnits}
                  </span>
                </div>

                {/* Lesson Title */}
                <h1 className="text-[42px] 2xl:text-[52px] font-semibold leading-[48px] 2xl:leading-[58px] text-foreground">
                  {lesson.title}
                </h1>
              </div>

              {/* Progress Text (Right side) */}
              {totalUnits > 1 && (
                <div className="flex flex-col items-start md:items-end md:text-right shrink-0">
                  <div className="text-[36px] font-semibold leading-[40px] text-primary tracking-tight">
                    {Math.min(currentUnitIndex + 1, totalUnits)}<span className="text-[20px] font-semibold leading-[24px]">/{totalUnits}</span>
                  </div>
                  <div className="mt-2 text-[14px] font-semibold leading-[18px] text-foreground">
                    Phần đã hoàn thành
                  </div>
                </div>
              )}
            </div>

            {/* ── Unit Progress Bar full width ── */}
            {totalUnits > 1 && (
              <div className="mb-8 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                  style={{ width: `${((currentUnitIndex + 1) / totalUnits) * 100}%` }}
                />
              </div>
            )}

            {/* ── Row: Content + Right sidebar ── */}
            <div className="flex flex-col xl:flex-row gap-8 xl:gap-8">
              {/* ── Left Column ── */}
              <div className="flex-1 min-w-0 flex flex-col gap-5">
                {/* Render current Unit components */}
                {currentUnit?.components.map((comp) => {
                  if (comp.type === "video" && comp.videoUrl) {
                    return (
                      <div key={comp.id}>
                        <VideoPlayer lesson={lesson} videoUrl={comp.videoUrl} />
                      </div>
                    );
                  }

                  if (comp.type === "html" && comp.htmlContent) {
                    const cleanHtml = DOMPurify.sanitize(comp.htmlContent, {
                      FORBID_TAGS: ["script", "style"],
                      FORBID_ATTR: ["onerror", "onload", "onclick"],
                    });

                    let images: { src: string; alt: string }[] = [];
                    let finalHtml = cleanHtml;
                    let hasImage = false;
                    let isImageOnly = false;

                    try {
                      const parser = new DOMParser();
                      const doc = parser.parseFromString(cleanHtml, 'text/html');
                      const imgEls = doc.querySelectorAll('img');
                      hasImage = imgEls.length > 0;

                      // Kiểm tra xem nội dung chỉ có ảnh mà không có text thực sự
                      const cloneDoc = doc.cloneNode(true) as Document;
                      cloneDoc.querySelectorAll('img').forEach(img => img.remove());
                      const textOnly = cloneDoc.body.textContent?.trim() || '';
                      isImageOnly = hasImage && textOnly.length === 0;

                      if (imgEls.length >= 2) {
                        images = Array.from(imgEls).map(img => ({
                          src: img.getAttribute('src') || '',
                          alt: img.getAttribute('alt') || ''
                        }));

                        imgEls.forEach(img => img.remove());

                        doc.querySelectorAll('p').forEach(p => {
                          if (!p.textContent?.trim() && p.children.length === 0) {
                            p.remove();
                          }
                        });

                        finalHtml = doc.body.innerHTML;
                      }
                    } catch (e) {
                      console.error("Failed to parse HTML for carousel", e);
                    }

                    // Nếu chỉ có ảnh, không có text → render full width, không cần khung border cha
                    if (isImageOnly) {
                      return (
                        <div key={comp.id} className="w-full rounded-3xl border border-border shadow-sm bg-card overflow-hidden">
                          {images.length >= 2 ? (
                            <LessonImageCarousel
                              images={images}
                              onImageClick={(src) => setLightboxSrc(src)}
                            />
                          ) : (
                            <div
                              className="prose max-w-none [&_img]:!w-full [&_img]:!max-w-none [&_img]:!rounded-2xl [&_img]:!cursor-zoom-in [&_img]:!my-0 [&_p]:!m-0 [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0"
                              dangerouslySetInnerHTML={{ __html: finalHtml }}
                              onClick={(e) => {
                                const target = e.target as HTMLElement;
                                if (target.tagName === "IMG") {
                                  setLightboxSrc((target as HTMLImageElement).src);
                                }
                              }}
                            />
                          )}
                        </div>
                      );
                    }

                    // Carousel (2+ ảnh) → render carousel không border, text (nếu có) trong card riêng bên dưới
                    if (images.length >= 2) {
                      return (
                        <div key={comp.id} className="flex flex-col gap-5">
                          <LessonImageCarousel
                            images={images}
                            onImageClick={(src) => setLightboxSrc(src)}
                          />
                          {finalHtml.trim() && (
                            <div className="rounded-3xl border border-border px-8 py-7 shadow-sm bg-card">
                              <div
                                className="prose max-w-none text-[14px] 2xl:text-[16px] font-normal leading-[18px] 2xl:leading-[24px] text-foreground/80 dark:prose-invert dark:text-foreground [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0 [&_p]:!text-[14px] 2xl:[&_p]:!text-[16px] [&_p]:!font-normal [&_p]:!leading-[18px] 2xl:[&_p]:!leading-[24px] [&_span]:!text-[14px] 2xl:[&_span]:!text-[16px] [&_span]:!font-normal [&_span]:!leading-[18px] 2xl:[&_span]:!leading-[24px] [&_li]:!text-[14px] 2xl:[&_li]:!text-[16px] [&_li]:!font-normal [&_li]:!leading-[18px] 2xl:[&_li]:!leading-[24px] [&_div]:!text-[14px] 2xl:[&_div]:!text-[16px] [&_div]:!font-normal [&_div]:!leading-[18px] 2xl:[&_div]:!leading-[24px] [&_h1]:!text-[28px] 2xl:[&_h1]:!text-[34px] [&_h1]:!font-semibold [&_h1]:!leading-[36px] 2xl:[&_h1]:!leading-[42px] [&_h1]:!mt-6 [&_h1]:!mb-3 [&_h1]:!text-foreground [&_h2]:!text-[22px] 2xl:[&_h2]:!text-[26px] [&_h2]:!font-bold [&_h2]:!leading-[28px] 2xl:[&_h2]:!leading-[34px] [&_h2]:!mt-5 [&_h2]:!mb-2 [&_h2]:!text-foreground [&_h3]:!text-[18px] 2xl:[&_h3]:!text-[20px] [&_h3]:!font-semibold [&_h3]:!leading-[24px] 2xl:[&_h3]:!leading-[28px] [&_h3]:!mt-4 [&_h3]:!mb-1 [&_h3]:!text-foreground [&_img]:!cursor-zoom-in"
                                dangerouslySetInnerHTML={{ __html: finalHtml }}
                                onClick={(e) => {
                                  const target = e.target as HTMLElement;
                                  if (target.tagName === "IMG") {
                                    setLightboxSrc((target as HTMLImageElement).src);
                                  }
                                }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div key={comp.id} className="rounded-3xl border border-border px-8 py-7 shadow-sm bg-card">
                        {comp.displayName && !hasImage && (
                          <div className="mb-4 inline-block">
                            <BadgeCyan><span className="uppercase">{comp.displayName}</span></BadgeCyan>
                          </div>
                        )}
                        {finalHtml.trim() && (
                          <div
                            className="prose max-w-none text-[14px] 2xl:text-[16px] font-normal leading-[18px] 2xl:leading-[24px] text-foreground/80 dark:prose-invert dark:text-foreground [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0 [&_p]:!text-[14px] 2xl:[&_p]:!text-[16px] [&_p]:!font-normal [&_p]:!leading-[18px] 2xl:[&_p]:!leading-[24px] [&_span]:!text-[14px] 2xl:[&_span]:!text-[16px] [&_span]:!font-normal [&_span]:!leading-[18px] 2xl:[&_span]:!leading-[24px] [&_li]:!text-[14px] 2xl:[&_li]:!text-[16px] [&_li]:!font-normal [&_li]:!leading-[18px] 2xl:[&_li]:!leading-[24px] [&_div]:!text-[14px] 2xl:[&_div]:!text-[16px] [&_div]:!font-normal [&_div]:!leading-[18px] 2xl:[&_div]:!leading-[24px] [&_h1]:!text-[28px] 2xl:[&_h1]:!text-[34px] [&_h1]:!font-semibold [&_h1]:!leading-[36px] 2xl:[&_h1]:!leading-[42px] [&_h1]:!mt-6 [&_h1]:!mb-3 [&_h1]:!text-foreground [&_h2]:!text-[22px] 2xl:[&_h2]:!text-[26px] [&_h2]:!font-bold [&_h2]:!leading-[28px] 2xl:[&_h2]:!leading-[34px] [&_h2]:!mt-5 [&_h2]:!mb-2 [&_h2]:!text-foreground [&_h3]:!text-[18px] 2xl:[&_h3]:!text-[20px] [&_h3]:!font-semibold [&_h3]:!leading-[24px] 2xl:[&_h3]:!leading-[28px] [&_h3]:!mt-4 [&_h3]:!mb-1 [&_h3]:!text-foreground [&_img]:!cursor-zoom-in"
                            dangerouslySetInnerHTML={{ __html: finalHtml }}
                            onClick={(e) => {
                              const target = e.target as HTMLElement;
                              if (target.tagName === "IMG") {
                                setLightboxSrc((target as HTMLImageElement).src);
                              }
                            }}
                          />
                        )}
                      </div>
                    );
                  }


                  if (comp.type === "problem" && comp.problemUsageKey) {
                    return (
                      <QuizContent
                        key={comp.id}
                        problemUsageKey={comp.problemUsageKey}
                      />
                    );
                  }

                  if (comp.type === "la_crossword" && comp.crosswordUsageKey) {
                    return (
                      <CrosswordContent
                        key={comp.id}
                        usageKey={comp.crosswordUsageKey}
                      />
                    );
                  }

                  if (comp.type === "la_sortable" && comp.sortableUsageKey) {
                    return (
                      <SortableContent
                        key={comp.id}
                        usageKey={comp.sortableUsageKey}
                      />
                    );
                  }

                  if (comp.type === "la_diagram" && comp.diagramData) {
                    return (
                      <div key={comp.id} className="rounded-3xl border border-border p-4 shadow-sm bg-card">
                        <DiagramContent data={comp.diagramData} />
                      </div>
                    );
                  }

                  if (comp.type === "la_faq" && comp.faqUsageKey) {
                    return (
                      <FaqContent
                        key={comp.id}
                        usageKey={comp.faqUsageKey}
                      />
                    );
                  }

                  if (comp.type === "la_pdf" && comp.pdfUrl) {
                    return (
                      <PdfContent
                        key={comp.id}
                        usageKey={comp.id}
                      />
                    );
                  }

                  return null;
                })}

                {/* Fallback: Unit has no renderable component */}
                {currentUnit && currentUnit.components.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-border px-8 py-7 text-center text-[14px] font-normal leading-[18px] text-muted-foreground">
                    Phần này chưa có nội dung.
                  </div>
                )}



                {/* ── Navigation Buttons ── */}
                <UnitNavButtons
                  currentIndex={currentUnitIndex}
                  totalUnits={totalUnits}
                  onPrev={handlePrev}
                  onNext={handleNext}
                  onComplete={handleComplete}
                  isCompleting={completeMutation.isPending}
                  isCompleted={isCompleted}
                  isLastUnit={isLastUnit}
                  hideCompleteButton={currentUnit?.components.some((c) => ["problem", "la_crossword", "la_sortable"].includes(c.type)) || false}
                  onNextLesson={handleNextLesson}
                  hasNextLesson={!!nextLessonId}
                />
              </div>

              {/* ── Right sidebar content (xl+) ── */}
              <div className="hidden xl:flex w-[260px] shrink-0 flex-col gap-6">

                {/* MENTOR & COMPANY INFO CARD */}
                <div className="rounded-3xl border border-border shadow-sm bg-card flex flex-col">
                  {/* Top: Mentor section */}
                  <div className="px-8 pt-7 pb-2">
                    <BadgeCyan>Mentor</BadgeCyan>
                    <h3 className="mb-1 mt-1 text-[20px] font-semibold leading-[28px] text-foreground">
                      Người hướng dẫn
                    </h3>
                  </div>
                  <MentorSidebar mentors={mentors} />

                  {/* Divider */}
                  <div className="mx-8 border-t border-border/60" />

                  {/* Bottom: Company section */}
                  <div className="px-8 py-4">
                    <img
                      src={LogoLanda}
                      alt="Le & Associates"
                      className="h-6 w-auto object-contain object-left mb-4"
                    />
                    <p className="text-[14px] font-normal leading-[18px] text-muted-foreground">
                      Le & Associates (L&A), thành viên của L&A Holdings, hiện là
                      một trong những công ty hàng đầu tại Việt Nam trong dịch vụ nhân
                      lực và thuê ngoài.
                    </p>
                  </div>
                </div>

                {/* Tài liệu tham khảo — LANDA API: file unlocked trên Studio */}
                <div className="rounded-3xl bg-primary p-8 text-primary-foreground shadow-sm">
                  <h3 className="mb-4 text-[20px] font-semibold leading-[24px]">
                    Tài liệu tham khảo
                  </h3>
                  {refDocs.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {refDocs.slice(0, 8).map((doc: CourseFile) => {
                        const DocIcon = getDocIcon(doc.extension);
                        return (
                          <a
                            key={doc.id}
                            href={doc.fullUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between rounded-lg bg-white/10 px-3 py-2.5 text-[14px] font-normal leading-[18px] transition-colors hover:bg-white/20 gap-2"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <DocIcon className="h-4 w-4 shrink-0 opacity-80" />
                              <span className="truncate">{doc.display_name}</span>
                            </div>
                            <Download className="h-3.5 w-3.5 shrink-0 opacity-70" />
                          </a>
                        );
                      })}
                      {refDocs.length > 8 && (
                        <p className="mt-1 text-center text-[10px] font-semibold leading-[14px] text-primary-foreground/60">
                          +{refDocs.length - 8} tài liệu khác
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[14px] font-normal leading-[18px] text-primary-foreground/60 italic">
                      Chưa có tài liệu...
                    </p>
                  )}
                </div>

                {/* AI Mentor hint */}
                <div className="mt-2 rounded-2xl border border-border bg-card p-3 text-center shadow-sm">
                  <p className="mb-2 text-[10px] font-bold leading-[14px] text-primary tracking-widest uppercase">
                    AI MENTOR
                  </p>
                  <p className="text-[14px] font-normal leading-[18px] text-muted-foreground">
                    Bạn cần trợ giúp trong quá trình học?
                  </p>
                </div>

              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── AI Mentor floating button ── */}
      <div className="fixed bottom-8 right-8 z-30 flex flex-col gap-4">
        {/* Nút Cuộn Lên Đầu Trang */}
        <button
          onClick={() => {
            const scrollContainer = document.getElementById("course-main-scroll");
            if (scrollContainer) scrollContainer.scrollTo({ top: 0, behavior: "smooth" });
            else window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg transition-all hover:scale-110",
            showScrollTop ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0 pointer-events-none"
          )}
          title="Lên đầu trang"
        >
          <ChevronUp className="h-6 w-6" />
        </button>

        {/* Nút AI Mentor (Tạm ẩn)
        <button
          className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-110"
          title="AI Mentor"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
        */}
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-border py-6 text-center bg-muted/30">
        <p className="text-[14px] font-normal leading-[18px] text-muted-foreground">
          Copyright © 2017 Le & Associates
        </p>
      </footer>

      {courseId && <WelcomeCourseModal courseId={courseId} completionPercent={completionPercent} isLoading={isProgressLoading} config={modalConfig} />}
      {courseId && <CompleteCourseModal courseId={courseId} completionPercent={completionPercent} isLoading={isProgressLoading} config={modalConfig} />}
      {courseId && <Course100PercentModal courseId={courseId} completionPercent={completionPercent} isLoading={isProgressLoading} config={modalConfig} />}
      {courseId && courseTree && <SectionCompleteModal courseId={courseId} modules={courseTree.modules} />}

      {/* ── Image Lightbox ── */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxSrc(null)}
          style={{ animation: "fadeIn 0.15s ease" }}
        >
          <img
            src={lightboxSrc}
            alt=""
            className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-5 right-6 text-white/70 hover:text-white text-[32px] leading-none font-light transition-colors"
            onClick={() => setLightboxSrc(null)}
            aria-label="Đóng"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
