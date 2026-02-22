import React, { useEffect } from "react";

interface SettingsModalProps {
  open: boolean;
  workspaceRoot: string;
  themeLabel: string;
  currentFile: string;
  onClose: () => void;
  onPickWorkspace: () => void;
  onToggleTheme: () => void;
  onRefresh: () => void;
}

export function SettingsModal(props: SettingsModalProps) {
  useEffect(() => {
    if (!props.open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          props.onClose();
        }
      }}
    >
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Workspace settings">
        <header className="settings-head">
          <div>
            <h2>Workspace settings</h2>
            <p>{props.workspaceRoot || "No workspace selected"}</p>
          </div>
          <button className="tiny-button" onClick={props.onClose}>
            Close
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-controls">
            <div className="settings-card">
              <h3>General</h3>
              <button onClick={props.onPickWorkspace}>Change workspace</button>
              <button onClick={props.onToggleTheme}>{`Theme ${props.themeLabel}`}</button>
              <button onClick={props.onRefresh}>Refresh files</button>
            </div>

            <div className="settings-card">
              <h3>Current file</h3>
              <p>{props.currentFile || "No file selected"}</p>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

