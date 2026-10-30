import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const BANNER_SLIDES = [
  {
    id: 1,
    image: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/2cd05c71-3897-4e88-9c73-3e307e0dde03.jpg",
    alt: "Batch Announcement Banner 1"
  },
  {
    id: 2,
    image: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/4f17deae-eab1-4b19-b5cb-2bb2291d60e5.jpg",
    alt: "Batch Announcement Banner 2"
  },
  {
    id: 3,
    image: "https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/afeb7785-0e5e-4fc9-95e7-57b328032009.jpg",
    alt: "Batch Announcement Banner 3"
  }
];

export const BannerCarousel: React.FC = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (isHovered) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % BANNER_SLIDES.length);
    }, 4500);
    return () => clearInterval(interval);
  }, [isHovered]);

  const prevSlide = () => {
    setCurrentIndex((prev) => (prev === 0 ? BANNER_SLIDES.length - 1 : prev - 1));
  };

  const nextSlide = () => {
    setCurrentIndex((prev) => (prev + 1) % BANNER_SLIDES.length);
  };

  return (
    <div 
      className="relative mt-6 w-full aspect-[3917/738] min-h-[110px] sm:min-h-[160px] md:min-h-[200px] overflow-hidden rounded-xl border border-border shadow-xs group bg-neutral-900/5 dark:bg-neutral-100/5 select-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Slides */}
      <div 
        className="flex w-full h-full transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${currentIndex * 100}%)` }}
      >
        {BANNER_SLIDES.map((slide) => (
          <div key={slide.id} className="min-w-full w-full h-full flex-shrink-0 flex items-center justify-center relative">
            <img
              src={slide.image}
              alt={slide.alt}
              className="w-full h-full object-contain object-center"
              loading="lazy"
            />
          </div>
        ))}
      </div>

      {/* Prev / Next controls */}
      <button
        type="button"
        onClick={prevSlide}
        aria-label="Previous banner"
        className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white p-2 rounded-full opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-10"
      >
        <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
      </button>
      <button
        type="button"
        onClick={nextSlide}
        aria-label="Next banner"
        className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white p-2 rounded-full opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-10"
      >
        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
      </button>

      {/* Dots indicator */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10 bg-black/30 backdrop-blur-xs px-2.5 py-1 rounded-full">
        {BANNER_SLIDES.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setCurrentIndex(i)}
            aria-label={`Go to slide ${i + 1}`}
            className={`h-2 rounded-full transition-all cursor-pointer ${
              currentIndex === i ? 'w-6 bg-white shadow-xs' : 'w-2 bg-white/60 hover:bg-white/90'
            }`}
          />
        ))}
      </div>
    </div>
  );
};
