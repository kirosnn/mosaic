import { TextAttributes } from "@opentui/core";
import { VERSION } from "../../utils/version";
import { CustomInput } from "../CustomInput";

interface HomePageProps {
  onSubmit: (value: string) => void;
  pasteRequestId: number;
  shortcutsOpen: boolean;
}

export function HomePage({ onSubmit, pasteRequestId, shortcutsOpen }: HomePageProps) {
  return (
    <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
      <box flexDirection="column" alignItems="center" marginBottom={2}>
        <text fg="#ffca38" attributes={TextAttributes.BOLD}>███╗   ███╗</text>
        <text fg="#ffca38" attributes={TextAttributes.BOLD}>████╗ ████║</text>
        <text fg="#ffca38" attributes={TextAttributes.BOLD}>███╔████╔███║</text>
      </box>

      <box width="80%" maxWidth={80}>
        <box
          flexDirection="row"
          backgroundColor="#1a1a1a"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
        >
          <CustomInput
            onSubmit={onSubmit}
            placeholder="Ask anything..."
            focused={!shortcutsOpen}
            pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
          />
        </box>
      </box>

      <box position="absolute" bottom={1} right={2}>
        <text fg="gray" attributes={TextAttributes.DIM}>v{VERSION}</text>
      </box>
    </box>
  );
}
