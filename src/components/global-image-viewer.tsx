"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, ExternalLink, X } from "lucide-react";

type ViewerImage = {
  alt: string;
  src: string;
};

const IMAGE_HREF_PATTERN =
  /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$|^data:image\/|\/api\/attachments\/|\/attachments\//i;

function isTinyOrDecorativeImage(image: HTMLImageElement) {
  const rect = image.getBoundingClientRect();

  return (
    image.getAttribute("aria-hidden") === "true" ||
    Boolean(image.closest("[data-image-viewer-ignore]")) ||
    rect.width < 44 ||
    rect.height < 44
  );
}

function imageFromClickTarget(target: EventTarget | null): ViewerImage | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const image = target.closest("img");
  const link = target.closest("a");
  const linkedImage = link?.querySelector("img") ?? null;
  const candidateImage = image ?? linkedImage;
  const linkHref = link instanceof HTMLAnchorElement ? link.href : "";

  if (candidateImage && !isTinyOrDecorativeImage(candidateImage)) {
    return {
      alt:
        candidateImage.getAttribute("alt") ||
        candidateImage.getAttribute("title") ||
        "图片预览",
      src:
        IMAGE_HREF_PATTERN.test(linkHref) && !linkHref.startsWith("javascript:")
          ? linkHref
          : candidateImage.currentSrc || candidateImage.src
    };
  }

  if (linkHref && IMAGE_HREF_PATTERN.test(linkHref) && !linkHref.startsWith("javascript:")) {
    return {
      alt: link?.textContent?.trim() || "图片预览",
      src: linkHref
    };
  }

  return null;
}

export function GlobalImageViewer() {
  const [image, setImage] = useState<ViewerImage | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const nextImage = imageFromClickTarget(event.target);

      if (!nextImage) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setImage(nextImage);
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (!image) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setImage(null);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [image]);

  if (!mounted || !image) {
    return null;
  }

  return createPortal(
    <div
      aria-label="图片查看器"
      className="fixed inset-0 z-[999] grid place-items-center bg-black/72 px-3 py-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-xl"
      onClick={() => setImage(null)}
      role="dialog"
    >
      <div className="pointer-events-none fixed left-3 right-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-[1000] flex items-center justify-between gap-2 sm:left-5 sm:right-5">
        <div className="min-w-0 truncate rounded-full border border-white/18 bg-white/14 px-3 py-2 text-xs font-medium text-white shadow-2xl backdrop-blur-2xl">
          {image.alt}
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          <a
            className="grid size-10 place-items-center rounded-full border border-white/20 bg-white/16 text-white shadow-2xl backdrop-blur-2xl transition hover:bg-white/24"
            download
            href={image.src}
            onClick={(event) => event.stopPropagation()}
            title="下载"
          >
            <Download className="size-4" />
          </a>
          <a
            className="grid size-10 place-items-center rounded-full border border-white/20 bg-white/16 text-white shadow-2xl backdrop-blur-2xl transition hover:bg-white/24"
            href={image.src}
            onClick={(event) => event.stopPropagation()}
            rel="noreferrer"
            target="_blank"
            title="打开原图"
          >
            <ExternalLink className="size-4" />
          </a>
          <button
            className="grid size-10 place-items-center rounded-full border border-white/20 bg-white/16 text-white shadow-2xl backdrop-blur-2xl transition hover:bg-white/24"
            onClick={(event) => {
              event.stopPropagation();
              setImage(null);
            }}
            title="关闭"
            type="button"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>
      <img
        alt={image.alt}
        className="max-h-[88dvh] max-w-full rounded-xl object-contain shadow-[0_24px_80px_rgba(0,0,0,0.4)]"
        onClick={(event) => event.stopPropagation()}
        src={image.src}
      />
    </div>,
    document.body
  );
}
