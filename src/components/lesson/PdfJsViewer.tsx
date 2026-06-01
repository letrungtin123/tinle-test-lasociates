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

// Worker path — dùng file từ node_modules qua CDN tương thích version
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface PdfJsViewerProps {
  url: string;
  isFullscreen: boolean;
  className?: string;
  /** Gọi khi PDF.js không load được → parent có thể fallback về iframe */
  onError?: () => void;
}

interface LinkAnnotation {
  url: string;
  rect: DOMRect;
}

export function PdfJsViewer({ url, isFullscreen, className, onError }: PdfJsViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageLinks, setPageLinks] = useState<LinkAnnotation[]>([]);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTasksRef = useRef<pdfjsLib.RenderTask[]>([]);

  // Render tất cả pages lên canvas, xếp dọc trong container scroll
  const renderPdf = useCallback(async (pdfUrl: string) => {
    const container = containerRef.current;
    if (!container) return;

    // Cleanup trước khi render mới
    renderTasksRef.current.forEach((task) => {
      try { task.cancel(); } catch { /* ignore */ }
    });
    renderTasksRef.current = [];

    try {
      setIsLoading(true);
      setError(null);
      setPageLinks([]);

      // Chuyển absolute URL → relative để đi qua Vite proxy (dev) / same-origin (prod)
      // VD: https://lms.example.com/asset-v1:... → /asset-v1:...
      let fetchUrl = pdfUrl;
      try {
        const parsed = new URL(pdfUrl, window.location.origin);
        if (parsed.origin !== window.location.origin) {
          fetchUrl = parsed.pathname + parsed.search;
        }
      } catch { /* URL không hợp lệ, giữ nguyên */ }

      // Fetch PDF qua app proxy → tránh CORS
      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();

      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdfDoc = await loadingTask.promise;
      pdfDocRef.current = pdfDoc;

      console.log("[PdfJsViewer] ✅ PDF loaded, pages:", pdfDoc.numPages);

      // Clear container
      container.innerHTML = "";

      const allLinks: LinkAnnotation[] = [];

      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);

        // Scale PDF để fit width container
        const containerWidth = container.clientWidth;
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = containerWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale });

        // Wrapper cho mỗi page (chứa canvas + link overlay)
        const pageWrapper = document.createElement("div");
        pageWrapper.style.position = "relative";
        pageWrapper.style.width = `${viewport.width}px`;
        pageWrapper.style.height = `${viewport.height}px`;
        pageWrapper.style.margin = "0 auto";
        if (pageNum > 1) {
          pageWrapper.style.marginTop = "4px";
        }

        // Canvas render PDF
        const canvas = document.createElement("canvas");

        // Hỗ trợ retina display
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        pageWrapper.appendChild(canvas);

        // Render page lên canvas
        const renderTask = page.render({ canvas, viewport });
        renderTasksRef.current.push(renderTask);
        await renderTask.promise;

        // Lấy annotations (links) → tạo overlay clickable
        const annotations = await page.getAnnotations();
        console.log(`[PdfJsViewer] Page ${pageNum} annotations:`, annotations.filter((a: Record<string, unknown>) => a.subtype === "Link"));
        for (const annot of annotations) {
          // pdfjs v6: link URL có thể ở annot.url hoặc annot.unsafeUrl
          const linkUrl = annot.url || annot.unsafeUrl;
          if (annot.subtype === "Link" && linkUrl) {
            const [x1, y1, x2, y2] = annot.rect;

            // Chuyển PDF coords (bottom-left origin) → DOM coords (top-left origin)
            const left = x1 * scale;
            const top = (unscaledViewport.height - y2) * scale;
            const width = (x2 - x1) * scale;
            const height = (y2 - y1) * scale;

            const linkEl = document.createElement("a");
            linkEl.href = linkUrl;
            linkEl.target = "_blank";
            linkEl.rel = "noopener noreferrer";
            linkEl.style.position = "absolute";
            linkEl.style.left = `${left}px`;
            linkEl.style.top = `${top}px`;
            linkEl.style.width = `${width}px`;
            linkEl.style.height = `${height}px`;
            linkEl.style.cursor = "pointer";
            // Không hiển thị background nhưng hover sẽ highlight nhẹ
            linkEl.style.backgroundColor = "transparent";
            linkEl.style.transition = "background-color 0.15s";
            linkEl.addEventListener("mouseenter", () => {
              linkEl.style.backgroundColor = "rgba(59, 130, 246, 0.12)";
            });
            linkEl.addEventListener("mouseleave", () => {
              linkEl.style.backgroundColor = "transparent";
            });

            pageWrapper.appendChild(linkEl);

            allLinks.push({
              url: annot.url,
              rect: new DOMRect(left, top, width, height),
            });
          }
        }

        container.appendChild(pageWrapper);
      }

      setPageLinks(allLinks);
      setIsLoading(false);
    } catch (err) {
      // Nếu bị cancel (do re-render) thì bỏ qua
      if (err instanceof Error && err.message.includes("cancel")) return;
      console.error("PDF.js render error:", err);
      setError("Không thể tải tài liệu PDF");
      setIsLoading(false);
      // Thông báo parent để fallback
      onError?.();
    }
  }, []);

  // Render khi url thay đổi
  useEffect(() => {
    if (url) {
      renderPdf(url);
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
  }, [url, renderPdf]);

  // Re-render khi toggle fullscreen (container width thay đổi)
  useEffect(() => {
    if (url && !isLoading) {
      // Delay nhỏ để container kịp resize
      const timer = setTimeout(() => renderPdf(url), 100);
      return () => clearTimeout(timer);
    }
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
        className="w-full h-full overflow-y-auto bg-gray-100 dark:bg-slate-800"
      />
    </div>
  );
}
