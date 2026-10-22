import { useLayoutEffect, useRef } from "react";

/**
 * Keeps the mobile hand reserve synchronized with the fixed action surface.
 * App owns the ActionBar markup; attach the returned ref to that element.
 */
export function useMobileActionArea<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      document.documentElement.style.setProperty(
        "--mobile-action-height",
        `${height}px`,
      );
    };
    update();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--mobile-action-height");
    };
  }, []);

  return ref;
}
