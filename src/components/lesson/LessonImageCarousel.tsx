import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface LessonImageCarouselProps {
  images: { src: string; alt: string }[];
  onImageClick?: (src: string) => void;
}

export function LessonImageCarousel({ images, onImageClick }: LessonImageCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!images || images.length === 0) return null;

  const next = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((i) => (i + 1) % images.length);
  };

  const prev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((i) => (i - 1 + images.length) % images.length);
  };

  return (
    <div className="relative w-full mb-6 group rounded-2xl overflow-hidden bg-muted/20 flex flex-col items-center justify-center">
      {/* Container ảnh với fixed chiều cao tối đa để giữ layout ổn định */}
      <div 
        className="relative w-full h-[350px] md:h-[450px] 2xl:h-[550px] flex items-center justify-center p-4 cursor-zoom-in"
        onClick={() => onImageClick?.(images[currentIndex].src)}
      >
        <img
          src={images[currentIndex].src}
          alt={images[currentIndex].alt || `Image ${currentIndex + 1}`}
          className="max-w-full max-h-full object-contain transition-opacity duration-300"
        />

        {/* Nút điều hướng */}
        {images.length > 1 && (
          <>
            <button
              onClick={prev}
              className="absolute left-3 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Previous image"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={next}
              className="absolute right-3 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Next image"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}
      </div>

      {/* Dấu chấm chỉ báo */}
      {images.length > 1 && (
        <div className="flex justify-center gap-2 py-4">
          {images.map((_, idx) => (
            <button
              key={idx}
              onClick={(e) => {
                e.stopPropagation();
                setCurrentIndex(idx);
              }}
              className={`w-2 h-2 rounded-full transition-colors ${
                idx === currentIndex ? 'bg-primary' : 'bg-primary/20 hover:bg-primary/40'
              }`}
              aria-label={`Go to slide ${idx + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
