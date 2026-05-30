// ============================================================
// PdfContent — Hiển thị tài liệu PDF nhúng từ Google Drive
//
// Passive block: completion được FE tự mark khi learner vào unit.
// Layout clean với header bar + fullscreen toggle.
// Chế độ mini: toolbar ẩn, không cho zoom.
// Chế độ fullscreen: xem toàn màn hình.
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
 * Với URL trực tiếp (asset), ẩn toolbar, fit width.
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
  const overlayRef = useRef<HTMLDivElement>(null);

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

  // Khi thoát fullscreen → reload iframe để PDF viewer reset kích thước
  useEffect(() => {
    const handler = () => {
      const isFull = !!document.fullscreenElement;
      setIsFullscreen(isFull);
      if (!isFull) {
        setIsLoading(true);
        setIframeKey((k) => k + 1);
      }
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Overlay luôn active: chặn zoom (Ctrl+wheel và trackpad pinch),
  // cho scroll thường đi qua bằng cách tạm tắt overlay.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handler = (e: WheelEvent) => {
      if (e.ctrlKey) {
        // Chặn zoom: Ctrl+scroll hoặc trackpad pinch
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Scroll thường: tạm tắt overlay để wheel event tiếp theo đến iframe
      el.style.pointerEvents = "none";
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { el.style.pointerEvents = "auto"; }, 80);
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
      if (timer) clearTimeout(timer);
    };
  }, [isFullscreen]);

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
            <p className="text-[11px] text-white/40 font-medium">Nhấn toàn màn hình để xem chi tiết</p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
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

      {/* ── PDF iframe ── */}
      <div
        className={cn(
          "relative bg-white dark:bg-slate-900",
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
        <iframe
          key={iframeKey}
          src={embedUrl}
          title={svd.display_name}
          className={cn("w-full h-full border-0", isLoading ? "invisible" : "")}
          allow="autoplay"
          loading="lazy"
          onLoad={() => setIsLoading(false)}
        />
        {/* Overlay luôn active ở mini mode: chặn zoom (Ctrl+wheel + trackpad pinch),
            scroll thường tự động pass-through qua iframe */}
        {!isFullscreen && (
          <div
            ref={overlayRef}
            className="absolute inset-0 z-[5]"
            style={{ pointerEvents: "auto" }}
          />
        )}
      </div>
    </div>
  );
}
