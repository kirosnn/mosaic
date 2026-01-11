import { TextAttributes } from "@opentui/core";

export function App() {
  return (
<box flexGrow={1} justifyContent="center" alignItems="center">
<box flexDirection="row">
  <box flexDirection="column" alignItems="flex-start" marginRight={2}>
    <text attributes={TextAttributes.BOLD}>{'███╗   ███╗'}</text>
    <text attributes={TextAttributes.BOLD}>{'████╗ ████║'}</text>
    <text attributes={TextAttributes.BOLD}>{'███╔████╔███║'}</text>
  </box>
  <box flexDirection="column" alignItems="flex-start">
    <text attributes={TextAttributes.DIM}>Mosaic welcomes you !</text>
    <text attributes={TextAttributes.DIM}>Mosaic CLI v0.0.5.01</text>
    <text attributes={TextAttributes.DIM}>Now are you ready to configure it ?</text>
  </box>
</box>
<box marginTop={1}>
  <text attributes={TextAttributes.DIM}>Press Enter to continue...</text>
</box>
</box>
  );
}

export default App;