// ============================================================
// PdfContent — Hiển thị tài liệu PDF nhúng từ Google Drive
//
// Passive block: completion được FE tự mark khi learner vào unit.
// Layout clean với header bar + fullscreen toggle.
// Zoom: CSS transform scale qua Ctrl+wheel, không dùng native zoom.
// ============================================================

import { useQuery } from "@tanstack/react-query";
import { getBlockDetail } from "@/api/blocks";
import { FileText, Loader2, Maximize, Minimize, ExternalLink } from "lucide-react";
import { useAuthStore } from "@/stores/useAuthStore";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";

interface PdfData {
  display_name: string;
  pdf_url: string;
}

/**
 * Chuyển Google Drive share link → embed preview link.
 * Với URL trực tiếp (asset), ẩn toolbar + navpanes, fit width.
 */
function toEmbedUrl(url: string): string {
  if (!url.trim()) return "";
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch) {
    return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
  }
  return url.trim() + "#toolbar=0&navpanes=0&view=FitH";
}

export function PdfContent({ usageKey }: { usageKey: string }) {
  const username = useAuthStore((s) => s.user?.username);
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfWrapperRef = useRef<HTMLDivElement>(null);

  // ── Custom zoom via CSS transform ──
  const [scale, setScale] = useState(1);
  const [ctrlHeld, setCtrlHeld] = useState(false);

  // Track Ctrl key
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => { if (e.key === "Control") setCtrlHeld(true); };
    const onUp = (e: KeyboardEvent) => { if (e.key === "Control") setCtrlHeld(false); };
    // Ctrl released khi window mất focus
    const onBlur = () => setCtrlHeld(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Ctrl+wheel trên overlay → zoom bằng CSS transform
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((prev) => {
      const next = Math.round((prev + delta) * 10) / 10;
      return Math.min(Math.max(next, 0.5), 3);
    });
  }, []);

  // Double-click overlay → reset zoom
  const handleDoubleClick = useCallback(() => {
    setScale(1);
  }, []);

  const { data: blockData, isLoading: isQueryLoading } = useQuery({
    queryKey: ["block-detail", usageKey, username],
    queryFn: () => getBlockDetail(usageKey, username),
    staleTime: 30_000,
  });

  const svd = blockData?.student_view_data as unknown as PdfData | undefined;

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    } else {
      el.requestFullscreen();
      setIsFullscreen(true);
    }
  }, []);

  // Khi thoát fullscreen → reload iframe + reset zoom
  useEffect(() => {
    const handler = () => {
      const isFull = !!document.fullscreenElement;
      setIsFullscreen(isFull);
      if (!isFull) {
        setScale(1);
        setIsLoading(true);
        setIframeKey((k) => k + 1);
      }
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // ── Loading ──
  if (isQueryLoading) {
    return <Skeleton className="w-full rounded-2xl" style={{ height: "70vh" }} />;
  }

  // ── Empty / No URL ──
  if (!svd || !svd.pdf_url) {
    return (
      <div className="relative overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted/30 shadow-sm" style={{ height: "70vh" }}>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-muted/60">
            <FileText className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-medium">Tài liệu PDF</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Chưa có tài liệu nào được cấu hình</p>
        </div>
      </div>
    );
  }

  const embedUrl = toEmbedUrl(svd.pdf_url);
  const zoomPercent = Math.round(scale * 100);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden rounded-2xl shadow-lg border border-border/50 flex flex-col",
        isFullscreen ? "bg-white dark:bg-slate-900" : ""
      )}
    >
      {/* ── Header Bar ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-slate-800 to-slate-900 dark:from-slate-900 dark:to-slate-950 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-rose-500/20">
            <FileText className="h-4 w-4 text-rose-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{svd.display_name}</p>
            <p className="text-[11px] text-white/40 font-medium">Ctrl + cuộn chuột để zoom · Double-click để reset</p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Zoom indicator */}
          {scale !== 1 && (
            <button
              onClick={handleDoubleClick}
              className="flex items-center justify-center h-7 px-2 rounded-md text-[11px] font-semibold text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              title="Reset zoom"
            >
              {zoomPercent}%
            </button>
          )}

          {/* Mở trong tab mới */}
          <a
            href={svd.pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center w-8 h-8 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            title="Mở trong tab mới"
          >
            <ExternalLink className="h-4 w-4" />
          </a>

          {/* Fullscreen toggle */}
          <button
            onClick={toggleFullscreen}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            title={isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
          >
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* ── PDF iframe + zoom overlay ── */}
      <div
        ref={pdfWrapperRef}
        className={cn(
          "relative overflow-auto bg-white dark:bg-slate-900",
          isFullscreen ? "flex-1" : ""
        )}
        style={isFullscreen ? undefined : { height: "calc(70vh - 44px)" }}
      >
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white dark:bg-slate-900">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground font-medium">Đang tải tài liệu...</p>
            </div>
          </div>
        )}

        {/* Iframe với CSS transform zoom */}
        <iframe
          key={iframeKey}
          src={embedUrl}
          title={svd.display_name}
          className={cn("border-0 origin-top-left", isLoading ? "invisible" : "")}
          style={{
            width: `${100 / scale}%`,
            height: `${100 / scale}%`,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
          allow="autoplay"
          loading="lazy"
          onLoad={() => setIsLoading(false)}
        />

        {/* Overlay bắt Ctrl+wheel để zoom — chỉ active khi Ctrl đang giữ */}
        <div
          className="absolute inset-0 z-[5]"
          style={{ pointerEvents: ctrlHeld ? "auto" : "none" }}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
        />
      </div>
    </div>
  );
}
