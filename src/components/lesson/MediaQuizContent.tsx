// ============================================================
// MediaQuizContent — Hiển thị quiz (single/multi) kèm media
//
// Dùng cho cả la_single_quiz và la_multi_quiz.
// Media: ảnh (1 = đơn, ≥2 = carousel), video YouTube.
// Quiz: radio (single) hoặc checkbox (multi).
// Submit: gọi XBlock json_handler submit_answers.
//
// UI Flow:
// 1. Màn hình init: Hiện tiêu đề + hướng dẫn, KHÔNG hiện media
// 2. Click "Bắt đầu" → hiện media + câu hỏi + đáp án
// 3. Submit → gọi API → markBlockComplete + refetch progress
// ============================================================

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getBlockDetail, submitSingleQuizAnswer, submitMultiQuizAnswer } from "@/api/blocks";
import { CheckCircle2, XCircle, Loader2, Info, Lightbulb, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/useAuthStore";
import { useBlockSubmitStore } from "@/stores/useBlockSubmitStore";
import { markBlockComplete } from "@/api/progress";
import { refetchProgressWithRetry } from "@/lib/progressRefetch";
import { LessonImageCarousel } from "@/components/lesson/LessonImageCarousel";
import DOMPurify from "dompurify";

// ── Types ──

interface QuizChoice {
  id: string;
  html: string;
}

interface QuizStudentViewData {
  display_name: string;
  question_html: string;
  choices: QuizChoice[];
  images: string[];
  video_url: string;
  explanation_html: string;
  hints: string[];
  completed: boolean;
  score: number;
}

// ── Helper: extract YouTube ID ──

function extractYoutubeId(input: string): string {
  if (!input) return "";
  const regexes = [
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const r of regexes) {
    const m = input.match(r);
    if (m) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(input.trim())) return input.trim();
  return "";
}

// ── Main Component ──

interface MediaQuizContentProps {
  usageKey: string;
  mode: "single" | "multi";
}

export function MediaQuizContent({ usageKey, mode }: MediaQuizContentProps) {
  const qc = useQueryClient();
  const { courseId } = useParams();
  const user = useAuthStore((s) => s.user);
  const username = user?.username;

  const [started, setStarted] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [showHints, setShowHints] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Fetch block detail
  const { data: blockData, isLoading } = useQuery({
    queryKey: ["block-detail", usageKey, username],
    queryFn: () => getBlockDetail(usageKey, username),
    staleTime: 0,
  });

  const svd = blockData?.student_view_data as unknown as QuizStudentViewData | undefined;

  // Khôi phục kết quả từ session store
  if (svd && !started && resultMessage === null) {
    const cached = useBlockSubmitStore.getState().getResult(usageKey);
    const currentFingerprint = JSON.stringify(svd.choices.map(c => c.id + '|' + c.html));
    if (cached && cached.contentFingerprint === currentFingerprint && cached.resultMessage) {
      // Sẽ set state ngay khi mount
      setTimeout(() => {
        setResultMessage(cached.resultMessage);
        setIsCorrect(cached.isCorrect);
        setStarted(true);
        if (cached.answers) {
          const ans = cached.answers[usageKey];
          if (Array.isArray(ans)) {
            setSelected(new Set(ans));
          } else if (typeof ans === 'string') {
            setSelected(new Set([ans]));
          }
        }
      }, 0);
    }
  }

  // ── Handlers ──

  const handleSelect = useCallback((choiceId: string) => {
    if (resultMessage !== null) return;
    if (mode === "single") {
      setSelected(new Set([choiceId]));
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(choiceId)) {
          next.delete(choiceId);
        } else {
          next.add(choiceId);
        }
        return next;
      });
    }
  }, [mode, resultMessage]);

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: async () => {
      const arr = Array.from(selected);
      if (mode === "single") {
        return submitSingleQuizAnswer(usageKey, arr[0]);
      } else {
        return submitMultiQuizAnswer(usageKey, arr);
      }
    },
    onSuccess: async (data) => {
      const correct = data.status === "correct";
      setIsCorrect(correct);
      setResultMessage(data.message);

      // Lưu vào session store
      const fp = svd ? JSON.stringify(svd.choices.map(c => c.id + '|' + c.html)) : '';
      useBlockSubmitStore.getState().setResult(usageKey, {
        resultMessage: data.message,
        isCorrect: correct,
        answers: { [usageKey]: Array.from(selected) },
        contentFingerprint: fp,
      });

      // CHỈ khi trả lời ĐÚNG mới gọi markBlockComplete và cập nhật tiến độ sidebar
      if (correct && courseId && username) {
        try {
          await markBlockComplete(username, courseId, usageKey);
        } catch (e) {
          console.error("Failed to mark block complete:", e);
        }

        qc.invalidateQueries({ queryKey: ["block-detail", usageKey] });
        // Refetch progress với retry để bắt kịp backend aggregation
        refetchProgressWithRetry(qc);
      }
      // Nếu trả lời SAI → KHÔNG gọi API completion, KHÔNG invalidate queries → sidebar giữ nguyên
    },
    onError: () => {
      setIsCorrect(false);
      setResultMessage("Có lỗi xảy ra khi nộp bài. Vui lòng thử lại.");
    },
  });

  const handleSubmit = useCallback(() => {
    if (selected.size === 0) return;
    submitMutation.mutate();
  }, [selected, submitMutation]);

  const handleRetry = useCallback(() => {
    setSelected(new Set());
    setResultMessage(null);
    setIsCorrect(null);
    setShowHints(false);
  }, []);

  // ── Render States ──

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!svd) {
    return (
      <div className="text-center p-10 mt-6 rounded-2xl border border-muted bg-muted/20">
        <p className="text-muted-foreground">Không tải được dữ liệu quiz.</p>
      </div>
    );
  }

  const youtubeId = extractYoutubeId(svd.video_url);
  const hasImages = svd.images && svd.images.length > 0;
  const hasVideo = youtubeId.length === 11;
  const hasMedia = hasImages || hasVideo;

  // ── Màn hình Hướng dẫn (Chưa bắt đầu) — KHÔNG hiện media ──
  if (!started) {
    return (
      <div className="rounded-3xl border-2 border-primary/10 bg-[#F4F9FF] dark:bg-slate-900/50 p-8 shadow-sm relative overflow-hidden">
        {/* Trang trí góc phải */}
        <div className="absolute right-0 top-0 -mr-16 -mt-16 w-64 h-64 opacity-20 pointer-events-none">
          <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
            <path fill="#0247A6" d="M44.7,-76.4C58.9,-69.2,71.8,-59.1,81.3,-46.3C90.8,-33.5,96.8,-18,97.7,-2.1C98.6,13.8,94.2,30.3,85.6,44.8C77,59.3,64.2,71.9,49.2,80.3C34.2,88.7,17.1,92.9,0.5,92.1C-16.1,91.3,-32.2,85.4,-46.8,76.5C-61.4,67.6,-74.6,55.7,-83.5,41.1C-92.4,26.5,-97.1,9.2,-95.7,-7.4C-94.3,-24,-86.7,-39.9,-75.6,-51.9C-64.5,-63.9,-49.9,-71.9,-35.5,-78.9C-21.1,-85.9,-10.5,-91.9,2.8,-96.5C16.1,-101.1,30.5,-83.6,44.7,-76.4Z" transform="translate(100 100)" />
          </svg>
        </div>

        <div className="mb-2 flex items-center gap-2">
          <span
            className="rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-widest"
            style={{ backgroundColor: "#43FDD7", color: "#000" }}
          >
            {mode === "single" ? "Trắc nghiệm" : "Trắc nghiệm nhiều đáp án"}
          </span>
          {hasMedia && (
            <span
              className="rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ backgroundColor: "#FFE066", color: "#000" }}
            >
              {hasImages && hasVideo ? "Có ảnh & video" : hasImages ? "Có hình ảnh" : "Có video"}
            </span>
          )}
        </div>
        <h2 className="mb-8 text-[28px] 2xl:text-[34px] font-semibold leading-[36px] 2xl:leading-[42px] text-foreground">
          {svd.display_name || (mode === "single" ? "Trắc nghiệm 1 đáp án" : "Trắc nghiệm nhiều đáp án")}
        </h2>

        <div className="mb-8 pl-4 border-l-4 border-primary">
          <h3 className="text-xl font-bold mb-4">Hướng dẫn</h3>
          <ul className="space-y-3 text-[14px]">
            <li>
              <b>1. Xem nội dung:</b> {hasMedia ? "Xem hình ảnh/video đính kèm, " : ""}đọc kỹ câu hỏi bên dưới.
            </li>
            <li>
              <b>2. Chọn đáp án:</b> {mode === "single" ? "Chọn 1 đáp án đúng nhất." : "Chọn tất cả các đáp án đúng."}
            </li>
            <li>
              <b>3. Nộp bài:</b> Nhấn xác nhận để hệ thống chấm điểm.
            </li>
          </ul>
        </div>

        <Button
          onClick={() => setStarted(true)}
          className="h-12 rounded-full px-8 font-bold text-[15px] shadow-lg transition-transform hover:scale-105"
        >
          Bắt đầu <Play className="ml-2 h-4 w-4" />
        </Button>
      </div>
    );
  }

  // ── Main Quiz UI — hiện media + câu hỏi + đáp án ──
  return (
    <div className="rounded-3xl border-2 border-primary/20 bg-[#F4F9FF] dark:bg-slate-900/50 p-6 md:p-10 shadow-sm relative overflow-hidden">
      {/* Badge */}
      <div className="mb-2 flex items-center gap-2">
        <span
          className="rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider"
          style={{ backgroundColor: "#43FDD7", color: "#000" }}
        >
          {mode === "single" ? "Trắc nghiệm" : "Trắc nghiệm nhiều đáp án"}
        </span>
      </div>

      {/* Title */}
      <h2 className="mb-4 text-[28px] 2xl:text-[34px] font-semibold leading-[36px] 2xl:leading-[42px] text-foreground">
        {svd.display_name || (mode === "single" ? "Trắc nghiệm 1 đáp án" : "Trắc nghiệm nhiều đáp án")}
      </h2>

      {/* Media — video trước ảnh, có padding */}
      {hasMedia && (
        <div className="mb-8 space-y-4">
          {hasVideo && (
            <div className="p-1 rounded-2xl bg-gradient-to-br from-primary/10 via-secondary/5 to-primary/5 border border-primary/10 shadow-sm">
              <div className="aspect-video w-full rounded-xl overflow-hidden bg-black shadow-inner">
                <iframe
                  width="100%" height="100%"
                  src={`https://www.youtube.com/embed/${youtubeId}?rel=0`}
                  title="YouTube Video"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          )}
          {hasImages && (
            svd.images.length >= 2
              ? <LessonImageCarousel images={svd.images.map((url, i) => ({ src: url, alt: `Ảnh ${i + 1}` }))} onImageClick={(src) => setLightboxSrc(src)} />
              : (
                <div
                  className="relative w-full rounded-2xl overflow-hidden bg-muted/20 flex items-center justify-center cursor-zoom-in"
                  onClick={() => setLightboxSrc(svd.images[0])}
                >
                  <img src={svd.images[0]} alt="Quiz" className="w-full max-h-[450px] object-contain" />
                </div>
              )
          )}
        </div>
      )}

      {/* Question */}
      {svd.question_html && (
        <div className="mb-8 pl-4 border-l-4 border-primary">
          <div
            className="text-[15px] text-foreground/80 leading-relaxed prose dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(svd.question_html) }}
          />
        </div>
      )}

      {/* Type hint */}
      <div className="mb-4 flex items-center gap-2 text-[14px] font-medium text-muted-foreground bg-muted/30 w-fit px-3 py-1.5 rounded-md border border-border/50">
        <Info className="h-4 w-4 text-muted-foreground" />
        <span>
          {mode === "single" ? "Chỉ chọn 1 đáp án." : "Được phép chọn nhiều đáp án."}
        </span>
      </div>

      {/* Choices */}
      <div className="w-full max-w-2xl mx-auto mb-8 space-y-4">
        {svd.choices.map((choice, index) => {
          const isSelected = selected.has(choice.id);
          const isDisabled = resultMessage !== null;
          const labelLetter = String.fromCharCode(65 + index);

          return (
            <label
              key={choice.id}
              className={`group flex w-full cursor-pointer items-center gap-4 rounded-2xl p-4 text-left transition-all ${
                isSelected
                  ? "bg-primary/5 ring-1 ring-primary"
                  : "bg-muted/40 hover:bg-muted/80"
              } ${isDisabled ? "cursor-not-allowed opacity-70" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                if (!isDisabled) handleSelect(choice.id);
              }}
            >
              <input
                type={mode === "single" ? "radio" : "checkbox"}
                name={usageKey}
                value={choice.id}
                checked={isSelected}
                readOnly
                disabled={isDisabled}
                className="hidden"
              />

              {/* A, B, C, D Box */}
              <div
                className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-[16px] font-bold transition-colors ${
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-foreground shadow-sm"
                }`}
              >
                {labelLetter}
              </div>

              <span className="flex-1 text-[15px] font-medium leading-relaxed text-foreground">
                {choice.html}
              </span>

              {/* Checkmark */}
              {isSelected && (
                <div className="shrink-0 pl-2">
                  <CheckCircle2 className="h-6 w-6 text-primary fill-primary text-primary-foreground" />
                </div>
              )}
            </label>
          );
        })}
      </div>

      {/* Explanation — hiện khi đúng */}
      {isCorrect && svd.explanation_html && (
        <div className="mb-6">
          <div className="rounded-xl bg-success/10 border border-success/20 p-5">
            <div className="flex items-center gap-2 mb-3 text-success">
              <Info className="h-5 w-5" />
            </div>
            <div
              className="prose prose-sm prose-success dark:prose-invert max-w-none text-[14px] leading-relaxed text-foreground/90"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(svd.explanation_html) }}
            />
          </div>
        </div>
      )}

      {/* Hints — hiện khi user click button (giống QuizContent/Problem) */}
      {showHints && svd.hints && svd.hints.length > 0 && (
        <div className="mb-6">
          <div className="rounded-xl bg-warning/10 border border-warning/20 p-5">
            <div className="flex items-center gap-2 mb-3 text-warning">
              <Lightbulb className="h-5 w-5" />
              <span className="font-bold text-sm tracking-wide uppercase">Gợi ý</span>
            </div>
            <div className="space-y-2">
              {svd.hints.map((hint, idx) => (
                <div key={idx} className="text-[14px] leading-relaxed text-foreground/90">
                  <span className="font-semibold mr-1">Gợi ý {idx + 1}:</span> {hint}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Result banner */}
      {resultMessage && (
        <div
          className={`flex items-center gap-3 rounded-xl p-4 mb-6 ${
            isCorrect
              ? "bg-success/10 border border-success/20"
              : "bg-destructive/10 border border-destructive/20"
          }`}
        >
          {isCorrect ? (
            <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 text-destructive shrink-0" />
          )}
          <p className="text-sm font-medium text-foreground">{resultMessage}</p>
        </div>
      )}

      {/* Nút nộp bài / Thử lại + Xem gợi ý (giống QuizContent layout) */}
      <div className="flex items-center justify-between border-t border-primary/10 pt-6 mt-4">
        {/* Nút xem gợi ý (bên trái) */}
        <div>
          {svd.hints && svd.hints.length > 0 && !showHints && !isCorrect && (
            <button
              onClick={() => setShowHints(true)}
              className="flex items-center gap-2 rounded-full border-2 border-warning/30 bg-warning/5 px-5 py-2.5 text-[13px] font-semibold text-warning transition-all hover:bg-warning/10 active:scale-[0.97]"
            >
              <Lightbulb className="h-4 w-4" />
              Xem gợi ý
            </button>
          )}
        </div>

        {/* Nút xác nhận / thử lại (bên phải) */}
        <div className="flex gap-3">
          {!resultMessage ? (
            <button
              disabled={submitMutation.isPending || selected.size === 0}
              onClick={handleSubmit}
              className="rounded-full bg-primary px-8 py-3 text-[14px] font-bold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-2"
            >
              {submitMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Xác nhận
            </button>
          ) : !isCorrect ? (
            <button
              onClick={handleRetry}
              className="rounded-full bg-secondary text-secondary-foreground px-8 py-3 text-[14px] font-bold shadow-sm transition-all hover:bg-secondary/80 active:scale-[0.97] flex items-center gap-2"
            >
              Thử lại
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Image Lightbox ── */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
          onClick={() => setLightboxSrc(null)}
        >
          <img
            src={lightboxSrc}
            alt="Phóng to"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl"
            onClick={() => setLightboxSrc(null)}
          />
        </div>
      )}
    </div>
  );
}

// ── Convenience exports ──

export function SingleQuizContent({ usageKey }: { usageKey: string }) {
  return <MediaQuizContent usageKey={usageKey} mode="single" />;
}

export function MultiQuizContent({ usageKey }: { usageKey: string }) {
  return <MediaQuizContent usageKey={usageKey} mode="multi" />;
}
