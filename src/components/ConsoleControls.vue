<template>
  <details class="console-controls">
    <summary>Console controls</summary>
    <div class="controls-copy">
      <p dir="auto">
        Open hosts, folders, files and messages from the transcript. Goal shows your task. Session
        shows your location and access. Hosts and Mail in the title bar open the local directory and
        inbox, including during a host session.
      </p>
      <p dir="auto">
        Type a command and press Enter, or use a shortcut. On small screens, open Commands. Choose a
        command, fill any fields and use Run. Run <code>help</code> to open the command reference.
        Select a command there to edit it. In an argument field, Enter moves to the next field and
        runs from the last.
      </p>
      <p dir="auto">
        Use <code>inspect</code> for a Unicode character or code point. Copy the character or use
        Insert in the active argument. With text selected, Replace changes just the selection.
        Earlier reads opens files and messages you’ve already opened. Use Back to work to return to
        your work.
      </p>
    </div>
  </details>
</template>

<style scoped>
.console-controls {
  max-inline-size: 76ch;
  font-family: var(--sans);
  font-size: 1rem;
  color: var(--text);
}
.console-controls summary {
  min-block-size: 44px;
  padding: 0 var(--space-2);
  align-content: center;
  background: var(--surface);
  cursor: pointer;
}
.console-controls summary:hover {
  background: var(--raised);
}
.console-controls[open] summary {
  margin-block-end: var(--space-2);
}
.controls-copy {
  padding-inline: var(--space-2);
}
.controls-copy p + p {
  margin-block-start: var(--space-2);
}
</style>
