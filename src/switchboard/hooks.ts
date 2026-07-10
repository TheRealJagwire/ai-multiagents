import { useEffect, useRef } from "preact/hooks";

// Grows a <textarea> to fit its content up to maxPx, then scrolls internally
// rather than growing further — used anywhere a plain <input> was too small
// to paste a multi-line instruction into.
export function useAutoGrow(value: string, maxPx = 130) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
  }, [value]);
  return ref;
}
