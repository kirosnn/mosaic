import { useState } from "react";
import { TextAttributes } from "@opentui/core";
import { CustomInput } from "../CustomInput";
import type { ImageAttachment } from "../../utils/images";

export interface UserMessageModalState {
  id: string;
  index: number;
  content: string;
  images: ImageAttachment[];
  mode: 'actions' | 'edit';
  editSeed?: string;
}

interface UserMessageModalProps {
  modal: UserMessageModalState;
  modalWidth: number;
  modalHeight: number;
  shortcutsOpen: boolean;
  isProcessing: boolean;
  onClose: () => void;
  onRetry: () => void;
  onOpenEdit: () => void;
  onCloseEdit: () => void;
  onEditSubmit: (value: string) => void;
  onCopy: () => void;
}

export function UserMessageModal({
  modal,
  modalWidth,
  modalHeight,
  shortcutsOpen,
  isProcessing,
  onClose,
  onRetry,
  onOpenEdit,
  onCloseEdit,
  onEditSubmit,
  onCopy,
}: UserMessageModalProps) {
  const [hoveredActionId, setHoveredActionId] = useState<string | null>(null);

  const modalActions = modal.mode === 'actions' ? [
    { id: "retry", label: "Retry message", onActivate: onRetry },
    { id: "edit", label: "Edit and retry", onActivate: onOpenEdit },
    { id: "copy", label: "Copy message text to clipboard", onActivate: onCopy }
  ] : [];

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      zIndex={20}
      onMouseDown={() => onClose()}
    >
      <box width="100%" height="100%" justifyContent="center" alignItems="center">
        <box
          flexDirection="column"
          width={modalWidth}
          height={modalHeight}
          backgroundColor="#141414"
          opacity={0.92}
          padding={1}
          onMouseDown={(event: any) => event?.stopPropagation?.()}
        >
          <box marginBottom={1} flexDirection="row" justifyContent="space-between" width="100%">
            <text attributes={TextAttributes.BOLD}>Message Actions</text>
            <box flexDirection="row">
              <text fg="white">esc </text>
              <text attributes={TextAttributes.DIM}>close</text>
            </box>
          </box>
          <box flexDirection="column" width="100%" flexGrow={1} overflow="hidden">
            {modal.mode === 'edit' ? (
              <box flexDirection="column" width="100%">
                <box marginBottom={1}>
                  <text attributes={TextAttributes.DIM}>Edit the message and press Enter to resend.</text>
                </box>
                <CustomInput
                  onSubmit={onEditSubmit}
                  placeholder="Edit message..."
                  focused={!shortcutsOpen}
                  pasteRequestId={0}
                  submitDisabled={isProcessing || shortcutsOpen}
                  maxWidth={Math.max(10, modalWidth - 6)}
                  initialValue={modal.editSeed ?? modal.content}
                  disableHistory
                />
                <box flexDirection="column" width="100%" marginTop={1}>
                  <box
                    flexDirection="row"
                    width="100%"
                    backgroundColor={hoveredActionId === 'edit-back' ? "#2a2a2a" : "transparent"}
                    paddingLeft={1}
                    paddingRight={1}
                    onMouseOver={() => setHoveredActionId('edit-back')}
                    onMouseOut={() => setHoveredActionId(null)}
                    onMouseDown={(event: any) => {
                      event?.stopPropagation?.();
                      onCloseEdit();
                    }}
                  >
                    <text fg="#ffca38">{'\u203A'} </text>
                    <text>Back to actions</text>
                  </box>
                </box>
              </box>
            ) : (
              <scrollbox
                flexDirection="column"
                width="100%"
                flexGrow={1}
                verticalScrollbarOptions={{
                  showArrows: false,
                  trackOptions: {
                    backgroundColor: "#141414",
                    foregroundColor: "#141414",
                  },
                }}
                horizontalScrollbarOptions={{
                  showArrows: false,
                  trackOptions: {
                    backgroundColor: "#141414",
                    foregroundColor: "#141414",
                  },
                }}
              >
                {modalActions.map((action) => {
                  const isHovered = hoveredActionId === action.id;
                  return (
                    <box
                      key={`user-modal-action-${action.id}`}
                      flexDirection="row"
                      width="100%"
                      backgroundColor={isHovered ? "#2a2a2a" : "transparent"}
                      paddingLeft={1}
                      paddingRight={1}
                      onMouseOver={() => setHoveredActionId(action.id)}
                      onMouseOut={() => setHoveredActionId(null)}
                      onMouseDown={(event: any) => {
                        event?.stopPropagation?.();
                        action.onActivate();
                      }}
                    >
                      <text fg="#ffca38">{'\u203A'} </text>
                      <text>{action.label}</text>
                    </box>
                  );
                })}
              </scrollbox>
            )}
          </box>
        </box>
      </box>
    </box>
  );
}
