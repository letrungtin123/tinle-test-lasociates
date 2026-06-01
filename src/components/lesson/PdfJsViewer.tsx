// ============================================================
// PdfJsViewer — Render PDF bằng PDF.js (canvas-based)
//
// Ưu điểm so với iframe: kiểm soát được link behavior,
// link trong PDF luôn mở tab mới thay vì navigate tab hiện tại.
// ============================================================

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import * as pdfjsLib from "pdfjs-dist";

// Worker — tạo trực tiếp qua new Worker(), Vite xử lý pattern này native
pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(
  new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
  { type: "module" }
);

interface PdfJsViewerProps {
  url: string;
  isFullscreen: boolean;
  className?: string;
  /** Gọi khi PDF.js không load được → parent có thể fallback về iframe */
  onError?: () => void;
}

export function PdfJsViewer({ url, isFullscreen, className, onError }: PdfJsViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTasksRef = useRef<pdfjsLib.RenderTask[]>([]);
  // Cache ArrayBuffer để không re-fetch khi fullscreen toggle
  const pdfDataRef = useRef<ArrayBuffer | null>(null);

  // Render pages từ PDFDocumentProxy đã load sẵn
  const renderPages = useCallback(async (pdfDoc: pdfjsLib.PDFDocumentProxy) => {
    const container = containerRef.current;
    if (!container) return;

    // Cancel render tasks cũ
    renderTasksRef.current.forEach((task) => {
      try { task.cancel(); } catch { /* ignore */ }
    });
    renderTasksRef.current = [];

    // Clear container
    container.innerHTML = "";

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);

      // Scale PDF fit width
      const containerWidth = container.clientWidth;
      const unscaledViewport = page.getViewport({ scale: 1 });
      const scale = containerWidth / unscaledViewport.width;
      const viewport = page.getViewport({ scale });

      // Wrapper cho mỗi page
      const pageWrapper = document.createElement("div");
      pageWrapper.style.position = "relative";
      pageWrapper.style.width = `${viewport.width}px`;
      pageWrapper.style.height = `${viewport.height}px`;
      pageWrapper.style.margin = "0 auto";
      if (pageNum > 1) {
        pageWrapper.style.marginTop = "4px";
      }

      // Canvas
      const canvas = document.createElement("canvas");
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.style.display = "block";
      pageWrapper.appendChild(canvas);

      // Render
      const renderTask = page.render({ canvas, viewport });
      renderTasksRef.current.push(renderTask);
      await renderTask.promise;

      // Link annotations → tạo <a target="_blank"> overlay
      const annotations = await page.getAnnotations();
      for (const annot of annotations) {
        const linkUrl = annot.url || annot.unsafeUrl;
        if (annot.subtype === "Link" && linkUrl) {
          const [x1, y1, x2, y2] = annot.rect;
          const left = x1 * scale;
          const top = (unscaledViewport.height - y2) * scale;
          const width = (x2 - x1) * scale;
          const height = (y2 - y1) * scale;

          const linkEl = document.createElement("a");
          linkEl.href = linkUrl;
          linkEl.target = "_blank";
          linkEl.rel = "noopener noreferrer";
          linkEl.style.cssText = `
            position: absolute;
            left: ${left}px;
            top: ${top}px;
            width: ${width}px;
            height: ${height}px;
            z-index: 2;
            cursor: pointer;
            background: transparent;
            transition: background-color 0.15s;
          `;
          linkEl.addEventListener("mouseenter", () => {
            linkEl.style.backgroundColor = "rgba(59, 130, 246, 0.15)";
          });
          linkEl.addEventListener("mouseleave", () => {
            linkEl.style.backgroundColor = "transparent";
          });
          pageWrapper.appendChild(linkEl);
        }
      }

      container.appendChild(pageWrapper);
    }
  }, []);

  // Load PDF lần đầu (fetch + parse)
  const loadPdf = useCallback(async (pdfUrl: string) => {
    const container = containerRef.current;
    if (!container) return;

    try {
      setIsLoading(true);
      setError(null);

      // Chuyển absolute URL → relative để đi qua proxy
      let fetchUrl = pdfUrl;
      try {
        const parsed = new URL(pdfUrl, window.location.origin);
        if (parsed.origin !== window.location.origin) {
          fetchUrl = parsed.pathname + parsed.search;
        }
      } catch { /* giữ nguyên */ }

      // Fetch + cache ArrayBuffer
      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      pdfDataRef.current = await response.arrayBuffer();

      const loadingTask = pdfjsLib.getDocument({ data: pdfDataRef.current.slice(0) });
      const pdfDoc = await loadingTask.promise;
      pdfDocRef.current = pdfDoc;

      await renderPages(pdfDoc);
      setIsLoading(false);
    } catch (err) {
      if (err instanceof Error && err.message.includes("cancel")) return;
      console.error("PDF.js render error:", err);
      setError("Không thể tải tài liệu PDF");
      setIsLoading(false);
      onError?.();
    }
  }, [renderPages, onError]);

  // Load PDF khi url thay đổi
  useEffect(() => {
    if (url) {
      loadPdf(url);
    }
    return () => {
      renderTasksRef.current.forEach((task) => {
        try { task.cancel(); } catch { /* ignore */ }
      });
      if (pdfDocRef.current) {
        pdfDocRef.current.cleanup();
        pdfDocRef.current = null;
      }
    };
  }, [url, loadPdf]);

  // Re-render khi toggle fullscreen (container width thay đổi) — KHÔNG fetch lại
  useEffect(() => {
    const pdfDoc = pdfDocRef.current;
    if (!pdfDoc || isLoading) return;

    const timer = setTimeout(async () => {
      try {
        await renderPages(pdfDoc);
      } catch (err) {
        console.error("PDF.js re-render error:", err);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [isFullscreen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className={cn("flex items-center justify-center text-muted-foreground", className)}>
        <p className="text-sm font-medium">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white dark:bg-slate-900">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground font-medium">Đang tải tài liệu...</p>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full h-full overflow-y-auto bg-white dark:bg-slate-900"
      />
    </div>
  );
}
