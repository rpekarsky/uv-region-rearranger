export function HintsPanel() {
  return (
    <ul className="hints">
      <li>
        <strong>Left zone</strong> — source geometry (drawing, vertex edits)
      </li>
      <li>
        <strong>Right zone</strong> — transforms (rotate / scale / move)
      </li>
      <li>Drop image into a zone → loads as Original / Transformed</li>
      <li>Drop JSON anywhere → loads regions</li>
      <li>
        <kbd>N</kbd> — new region
      </li>
      <li>dblclick on left → start polygon at click</li>
      <li>
        <kbd>Enter</kbd> — close polygon
      </li>
      <li>
        <kbd>Esc</kbd> — cancel / deselect
      </li>
      <li>
        <kbd>Del</kbd> — delete region
      </li>
      <li>
        <kbd>H</kbd> / <kbd>V</kbd> — flip
      </li>
      <li>RMB-drag — pan zone</li>
      <li>RMB-tap on vertex — remove</li>
      <li>wheel — zoom around cursor</li>
      <li>dblclick edge — add vertex</li>
      <li>
        <kbd>shift</kbd>+rotate — snap 15°
      </li>
      <li>
        <kbd>Ctrl</kbd>+<kbd>Z</kbd> — undo
      </li>
      <li>
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> — redo
      </li>
    </ul>
  );
}
