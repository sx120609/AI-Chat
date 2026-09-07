"use client";

import { useEffect, useRef, type RefObject } from "react";

const layers: HTMLElement[] = [];
const focusable = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), iframe, [tabindex="0"]';

export function useModalFocus(open: boolean, panel: RefObject<HTMLElement | null>, onClose: () => void, media = "(min-width: 0px)", layoutKey?: boolean) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const element = panel.current;
    if (!open || !element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const query = window.matchMedia(media);
    layers.push(element);
    const controls = () => {
      const navigation = element.closest(".workspace-shell")?.querySelector(".mobile-task-nav");
      return [...element.querySelectorAll<HTMLElement>(focusable), ...(navigation?.querySelectorAll<HTMLElement>(focusable) || [])].filter(item => item.getClientRects().length > 0);
    };
    if (query.matches) (controls()[0] || element).focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (layers.at(-1) !== element) return;
      const externalDialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(dialog => dialog !== element && !element.contains(dialog) && !dialog.contains(element) && !layers.includes(dialog) && dialog.getClientRects().length > 0);
      if (externalDialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      } else if (event.key === "Tab" && query.matches) {
        const items = controls();
        const first = items[0] || element;
        const last = items.at(-1) || element;
        if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement as HTMLElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      layers.splice(layers.indexOf(element), 1);
      document.removeEventListener("keydown", onKey, true);
      if (element.contains(document.activeElement) || document.activeElement === document.body) previous?.focus({ preventScroll: true });
    };
  }, [open, panel, media, layoutKey]);
}
