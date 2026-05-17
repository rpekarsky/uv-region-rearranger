import { useRef } from 'react';
import { useEditorStore } from '../store';

// Hook for "lazy" action bracketing: beginAction is deferred until the first
// real mutation (.note()) instead of firing on user intent (focus / mousedown).
// This prevents bogus undo entries when the user clicks into a control but
// leaves without changing anything.
//
// Usage in a component:
//   const lazy = useLazyAction();
//   <input onChange={(v) => { lazy.note(); doMutation(v); }} onBlur={lazy.end} />
export function useLazyAction(): { note: () => void; end: () => void } {
  const begunRef = useRef(false);
  return {
    note: () => {
      if (!begunRef.current) {
        useEditorStore.getState().beginAction();
        begunRef.current = true;
      }
    },
    end: () => {
      if (begunRef.current) {
        useEditorStore.getState().endAction();
        begunRef.current = false;
      }
    },
  };
}
