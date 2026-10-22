import { useLayoutEffect, useRef } from "react";
import { playCue } from "./audio";

interface CardSlot {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  anchor: number;
  end: number;
  selecting: boolean;
  dragging: boolean;
  updated: boolean;
  initial: Set<string>;
  slots: CardSlot[];
}

/** Mouse/pen range selection; touch keeps native tapping and page scrolling. */
export function useHandRangeSelection(
  handKey: string,
  onChange: (ids: string[]) => void,
) {
  const ref = useRef<HTMLDivElement>(null);
  // Kept across effect resets so a hand update cannot turn a drag release into a click.
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    const hand = ref.current;
    if (!hand) return;
    let gesture: Gesture | null = null;

    const finish = () => {
      const previous = gesture;
      gesture = null;
      hand.removeAttribute("data-drag-selecting");
      if (!previous) return;
      if (previous.dragging) suppressClick.current = true;
      if (hand.hasPointerCapture(previous.pointerId))
        hand.releasePointerCapture(previous.pointerId);
    };

    const pointerDown = (event: PointerEvent) => {
      finish();
      suppressClick.current = false;
      if (
        event.button !== 0 ||
        !event.isPrimary ||
        event.pointerType === "touch"
      )
        return;
      const card =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>("button[data-card-id]")
          : null;
      if (!card || !hand.contains(card)) return;
      const cards = [
        ...hand.querySelectorAll<HTMLButtonElement>("button[data-card-id]"),
      ];
      const anchor = cards.indexOf(card);
      if (anchor < 0) return;
      const bounds = hand.getBoundingClientRect();
      const initial = new Set(
        cards
          .filter((item) => item.getAttribute("aria-pressed") === "true")
          .map((item) => item.dataset.cardId!),
      );
      gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        anchor,
        end: anchor,
        selecting: !initial.has(card.dataset.cardId!),
        dragging: false,
        updated: false,
        initial,
        // Use layout positions, not animated card transforms. Include the lifted
        // top edge so already selected cards remain easy to sweep over.
        slots: cards.map((item) => {
          const painted = item.getBoundingClientRect();
          const left =
            bounds.left + hand.clientLeft + item.offsetLeft + window.scrollX;
          const top =
            bounds.top + hand.clientTop + item.offsetTop + window.scrollY;
          return {
            id: item.dataset.cardId!,
            left,
            right: left + item.offsetWidth,
            top: Math.min(top, painted.top + window.scrollY),
            bottom: top + item.offsetHeight,
          };
        }),
      };
    };

    const pointerMove = (event: PointerEvent) => {
      const current = gesture;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!(event.buttons & 1)) {
        finish();
        return;
      }
      if (
        !current.dragging &&
        Math.hypot(
          event.clientX - current.startX,
          event.clientY - current.startY,
        ) < 5
      )
        return;
      if (!current.dragging) {
        current.dragging = true;
        suppressClick.current = true;
        // Capture only after movement: a normal click still belongs to its card.
        hand.setPointerCapture(event.pointerId);
        hand.setAttribute("data-drag-selecting", "true");
      }
      event.preventDefault();
      const x = event.clientX + window.scrollX;
      const y = event.clientY + window.scrollY;
      const hit = current.slots.findIndex(
        (slot) =>
          x >= slot.left &&
          x <= slot.right &&
          y >= slot.top &&
          y <= slot.bottom,
      );
      // Moving through a gap or outside the hand keeps the last range intact.
      const end = hit < 0 ? current.end : hit;
      const next = new Set(current.initial);
      for (
        let index = Math.min(current.anchor, end);
        index <= Math.max(current.anchor, end);
        index++
      ) {
        const id = current.slots[index].id;
        if (current.selecting) next.add(id);
        else next.delete(id);
      }
      if (end !== current.end || !current.updated) {
        current.end = end;
        current.updated = true;
        onChange(
          current.slots
            .filter((slot) => next.has(slot.id))
            .map((slot) => slot.id),
        );
        playCue("select");
      }
    };

    const pointerUp = (event: PointerEvent) => {
      if (gesture?.pointerId !== event.pointerId) return;
      finish();
    };
    const cancel = finish;
    const click = (event: MouseEvent) => {
      if (event.detail === 0 || !suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const preventDrag = (event: DragEvent) => event.preventDefault();

    hand.addEventListener("pointerdown", pointerDown);
    hand.addEventListener("click", click, true);
    hand.addEventListener("dragstart", preventDrag);
    hand.addEventListener("lostpointercapture", cancel);
    window.addEventListener("pointermove", pointerMove, { passive: false });
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      cancel();
      hand.removeEventListener("pointerdown", pointerDown);
      hand.removeEventListener("click", click, true);
      hand.removeEventListener("dragstart", preventDrag);
      hand.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("resize", cancel);
    };
  }, [handKey, onChange]);

  return ref;
}
