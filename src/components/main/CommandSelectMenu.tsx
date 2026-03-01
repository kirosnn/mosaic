import { useEffect, useRef, useState } from "react";
import { TextAttributes } from "@cascadetui/core";
import { useKeyboard } from "@cascadetui/react";
import type { SelectOption } from "../../utils/commands/types";

interface CommandSelectMenuProps {
  title: string;
  options: SelectOption[];
  modalWidth: number;
  modalHeight: number;
  shortcutsOpen: boolean;
  onSelect: (value: string) => void;
  onClose: () => void;
}

export function CommandSelectMenu({
  title,
  options,
  modalWidth,
  modalHeight,
  shortcutsOpen,
  onSelect,
  onClose,
}: CommandSelectMenuProps) {
  const scrollboxRef = useRef<any>(null);

  const [selectedIndex, setSelectedIndex] = useState(() => {
    const activeIndex = options.findIndex((opt) => opt.active);
    return activeIndex >= 0 ? activeIndex : 0;
  });
  const [hoveredOptionId, setHoveredOptionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredOptions = options.filter(
    (opt) =>
      searchQuery === "" ||
      opt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      opt.description.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  useEffect(() => {
    const sb = scrollboxRef.current;
    if (sb?.verticalScrollBar) sb.verticalScrollBar.visible = false;
    if (sb?.horizontalScrollBar) sb.horizontalScrollBar.visible = false;
  }, []);

  const findNextEnabledIndex = (
    currentIndex: number,
    direction: "up" | "down",
  ): number => {
    if (filteredOptions.length === 0) return 0;

    let newIndex = currentIndex;

    do {
      newIndex =
        direction === "down"
          ? newIndex === filteredOptions.length - 1
            ? 0
            : newIndex + 1
          : newIndex === 0
            ? filteredOptions.length - 1
            : newIndex - 1;

      if (!filteredOptions[newIndex]?.disabled) {
        return newIndex;
      }
    } while (newIndex !== currentIndex);

    return currentIndex;
  };

  useKeyboard((key) => {
    if (shortcutsOpen) return;

    if (key.name === "escape") {
      if (searchQuery) {
        setSearchQuery("");
      } else {
        onClose();
      }
    } else if (key.name === "up" || key.name === "k") {
      setSelectedIndex((prev) => findNextEnabledIndex(prev, "up"));
    } else if (key.name === "down" || key.name === "j") {
      setSelectedIndex((prev) => findNextEnabledIndex(prev, "down"));
    } else if (key.name === "return") {
      const option = filteredOptions[selectedIndex];
      if (option && !option.disabled) {
        onSelect(option.value);
      }
    } else if (key.name === "backspace") {
      setSearchQuery((prev) => prev.slice(0, -1));
    } else if (
      key.sequence &&
      key.sequence.length === 1 &&
      /^[a-zA-Z0-9 \-_]$/.test(key.sequence)
    ) {
      setSearchQuery((prev) => prev + key.sequence);
    }
  });

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
          backgroundColor="#111111"
          onMouseDown={(event: any) => event?.stopPropagation?.()}
        >
          <box
            flexDirection="row"
            justifyContent="space-between"
            width="100%"
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            marginBottom={1}
          >
            <text attributes={TextAttributes.BOLD} fg="white">
              {title}
            </text>
            <box flexDirection="row">
              <text fg="#666666">esc </text>
              <text attributes={TextAttributes.DIM} fg="#444444">
                close
              </text>
            </box>
          </box>

          <box marginBottom={1} paddingLeft={2} paddingRight={2} width="100%">
            <text fg="#666666">{searchQuery || "Search"}</text>
          </box>

          <scrollbox
            ref={scrollboxRef}
            flexDirection="column"
            width="100%"
            flexGrow={1}
            verticalScrollbarOptions={{
              showArrows: false,
              trackOptions: {
                backgroundColor: "#111111",
                foregroundColor: "#111111",
              },
            }}
            horizontalScrollbarOptions={{
              showArrows: false,
              trackOptions: {
                backgroundColor: "#111111",
                foregroundColor: "#111111",
              },
            }}
          >
            {filteredOptions.length === 0 ? (
              <box paddingLeft={2} paddingTop={1}>
                <text fg="#666666">No results found</text>
              </box>
            ) : (
              filteredOptions.map((option, index) => {
                const isSelected = index === selectedIndex;
                const isHovered = hoveredOptionId === option.value;
                const isDisabled = option.disabled;
                const showCategory =
                  index === 0 ||
                  option.category !== filteredOptions[index - 1]?.category;

                return (
                  <box key={`opt-${option.value}`} flexDirection="column" width="100%">
                    {showCategory && option.category && (
                      <box paddingLeft={2} paddingTop={1} paddingBottom={0}>
                        <text fg="#d9f755ff" attributes={TextAttributes.BOLD}>
                          {option.category}
                        </text>
                      </box>
                    )}

                    <box
                      flexDirection="row"
                      width="100%"
                      backgroundColor={
                        isSelected ? "#ff8c00" : isHovered ? "#222222" : "transparent"
                      }
                      paddingLeft={2}
                      paddingRight={2}
                      paddingTop={0}
                      paddingBottom={0}
                      onMouseOver={() => {
                        if (!isDisabled) {
                          setHoveredOptionId(option.value);
                          setSelectedIndex(index);
                        }
                      }}
                      onMouseOut={() => {
                        if (hoveredOptionId === option.value) {
                          setHoveredOptionId(null);
                        }
                      }}
                      onMouseDown={(event: any) => {
                        if (isDisabled) return;
                        event?.stopPropagation?.();
                        onSelect(option.value);
                      }}
                    >
                      <box flexDirection="row" justifyContent="space-between" width="100%">
                        <box flexDirection="row">
                          <text
                            fg={isSelected ? "black" : isDisabled ? "#666666" : "white"}
                            attributes={isSelected ? TextAttributes.BOLD : TextAttributes.NONE}
                          >
                            {option.name}
                          </text>
                          <text fg={isSelected ? "#333333" : "#666666"} marginLeft={1}>
                            {option.description}
                          </text>
                        </box>

                        <box flexDirection="row">
                          {option.badge !== undefined && (
                            <text fg={isSelected ? "black" : "#666666"}>{option.badge}</text>
                          )}
                          {option.active && option.badge === undefined && (
                            <text fg={isSelected ? "black" : "#666666"}>Connected</text>
                          )}
                        </box>
                      </box>
                    </box>
                  </box>
                );
              })
            )}
          </scrollbox>
        </box>
      </box>
    </box>
  );
}