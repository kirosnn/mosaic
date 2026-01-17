import { useState, useEffect, useRef } from 'react'
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { execSync } from 'child_process'
import { getInputHistory } from '../utils/history'

export interface InputSubmitMeta {
  isPaste?: boolean
  pastedContent?: string
}

interface CustomInputProps {
  onSubmit: (value: string, meta?: InputSubmitMeta) => void
  placeholder?: string
  password?: boolean
  focused?: boolean
  pasteRequestId?: number
  disableHistory?: boolean
}

export function CustomInput({ onSubmit, placeholder = '', password = false, focused = true, pasteRequestId = 0, disableHistory = false }: CustomInputProps) {
  const [value, setValue] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [terminalWidth, setTerminalWidth] = useState(process.stdout.columns || 80)
  const [pasteBuffer, setPasteBuffer] = useState('')
  const [inPasteMode, setInPasteMode] = useState(false)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [currentInput, setCurrentInput] = useState('')
  const [inputHistory, setInputHistory] = useState<string[]>([])

  const pasteFlagRef = useRef(false)
  const pastedContentRef = useRef('')
  const desiredCursorColRef = useRef<number | null>(null)

  const normalizePastedText = (text: string) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  const addPastedBlock = (pastedText: string) => {
    const normalized = normalizePastedText(pastedText)
    if (!normalized) return

    setValue(prev => prev.slice(0, cursorPosition) + normalized + prev.slice(cursorPosition))
    setCursorPosition(prev => prev + normalized.length)
    pasteFlagRef.current = true
    pastedContentRef.current = normalized
  }

  useEffect(() => {
    setInputHistory(getInputHistory())
  }, [])

  useEffect(() => {
    const handleResize = () => {
      setTerminalWidth(process.stdout.columns || 80)
    }
    process.stdout.on('resize', handleResize)
    return () => {
      process.stdout.off('resize', handleResize)
    }
  }, [])

  useEffect(() => {
    if (!focused) return

    process.stdout.write('\x1b[?2004h')

    return () => {
      process.stdout.write('\x1b[?2004l')
    }
  }, [focused])

  const pasteFromClipboard = () => {
    try {
      let clipboardText = ''
      if (process.platform === 'win32') {
        clipboardText = execSync('powershell.exe -command "Get-Clipboard"', { encoding: 'utf8', timeout: 2000 })
      } else if (process.platform === 'darwin') {
        clipboardText = execSync('pbpaste', { encoding: 'utf8', timeout: 2000 })
      } else {
        clipboardText = execSync('xclip -selection clipboard -o', { encoding: 'utf8', timeout: 2000 })
      }
      if (clipboardText) {
        addPastedBlock(clipboardText)
      }
    } catch (error) {
    }
  }

  useEffect(() => {
    if (!focused) return
    if (!pasteRequestId) return
    pasteFromClipboard()
  }, [pasteRequestId, focused])

  useKeyboard((key) => {
    if (!focused) return

    const typedDisplay = value.replace(/\n/g, ' ')
    const displayValueRaw = typedDisplay
    const displayCursorPos = cursorPosition
    const lineWidth = Math.max(10, terminalWidth - 4)
    const displayLines = displayValueRaw.length > 0
      ? Array.from({ length: Math.ceil(displayValueRaw.length / lineWidth) }, (_, i) => displayValueRaw.slice(i * lineWidth, (i + 1) * lineWidth))
      : ['']
    const boundedDisplayCursorPos = Math.max(0, Math.min(displayValueRaw.length, displayCursorPos))
    const currentCursorLine = displayValueRaw.length === 0 ? 0 : Math.min(displayLines.length - 1, Math.floor(boundedDisplayCursorPos / lineWidth))
    const currentCursorCol = boundedDisplayCursorPos >= displayValueRaw.length
      ? displayLines[Math.max(0, displayLines.length - 1)]!.length
      : (boundedDisplayCursorPos % lineWidth)

    if (key.sequence && key.sequence.includes('\x1b[200~')) {
      setInPasteMode(true)
      setPasteBuffer('')
      return
    }

    if (key.sequence && key.sequence.includes('\x1b[201~')) {
      setInPasteMode(false)
      if (pasteBuffer) {
        addPastedBlock(pasteBuffer)
        setPasteBuffer('')
      }
      return
    }

    if (inPasteMode) {
      setPasteBuffer(prev => prev + (key.sequence || ''))
      return
    }

    if (key.name === 'return') {
      const meta: InputSubmitMeta | undefined = pasteFlagRef.current
        ? { isPaste: true, pastedContent: pastedContentRef.current }
        : undefined
      onSubmit(value, meta)
      setValue('')
      setCursorPosition(0)
      setHistoryIndex(-1)
      setCurrentInput('')
      setInputHistory(getInputHistory())
      pasteFlagRef.current = false
      pastedContentRef.current = ''
      desiredCursorColRef.current = null
    } else if (key.name === 'backspace') {
      desiredCursorColRef.current = null
      if (cursorPosition > 0) {
        setValue(prev => prev.slice(0, cursorPosition - 1) + prev.slice(cursorPosition))
        setCursorPosition(prev => prev - 1)
      }
    } else if (key.name === 'delete') {
      desiredCursorColRef.current = null
      if (key.ctrl || key.meta) {
        setValue('')
        setCursorPosition(0)
        pasteFlagRef.current = false
        pastedContentRef.current = ''
      } else if (cursorPosition < value.length) {
        setValue(prev => prev.slice(0, cursorPosition) + prev.slice(cursorPosition + 1))
      }
    } else if (key.name === 'up') {
      if (currentCursorLine > 0) {
        if (desiredCursorColRef.current === null) {
          desiredCursorColRef.current = currentCursorCol
        }
        const targetLine = currentCursorLine - 1
        const targetCol = desiredCursorColRef.current
        const targetLineLen = displayLines[targetLine]!.length
        const newDisplayPos = (targetLine * lineWidth) + Math.min(targetCol, targetLineLen)
        setCursorPosition(Math.min(value.length, newDisplayPos))
        return
      }

      if (disableHistory) return

      desiredCursorColRef.current = null
      if (inputHistory.length === 0) return

      if (historyIndex === -1) {
        setCurrentInput(value)
        const newIndex = inputHistory.length - 1
        setHistoryIndex(newIndex)
        setValue(inputHistory[newIndex]!)
        setCursorPosition(inputHistory[newIndex]!.length)
      } else if (historyIndex > 0) {
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        setValue(inputHistory[newIndex]!)
        setCursorPosition(inputHistory[newIndex]!.length)
      }
    } else if (key.name === 'down') {
      if (currentCursorLine < displayLines.length - 1) {
        if (desiredCursorColRef.current === null) {
          desiredCursorColRef.current = currentCursorCol
        }
        const targetLine = currentCursorLine + 1
        const targetCol = desiredCursorColRef.current
        const targetLineLen = displayLines[targetLine]!.length
        const newDisplayPos = (targetLine * lineWidth) + Math.min(targetCol, targetLineLen)
        setCursorPosition(Math.min(value.length, newDisplayPos))
        return
      }

      if (disableHistory) return

      desiredCursorColRef.current = null
      if (historyIndex === -1) return

      if (historyIndex < inputHistory.length - 1) {
        const newIndex = historyIndex + 1
        setHistoryIndex(newIndex)
        setValue(inputHistory[newIndex]!)
        setCursorPosition(inputHistory[newIndex]!.length)
      } else {
        setHistoryIndex(-1)
        setValue(currentInput)
        setCursorPosition(currentInput.length)
      }
    } else if (key.name === 'left') {
      desiredCursorColRef.current = null
      setCursorPosition(prev => Math.max(0, prev - 1))
    } else if (key.name === 'right') {
      desiredCursorColRef.current = null
      setCursorPosition(prev => Math.min(value.length, prev + 1))
    } else if (key.name === 'home') {
      desiredCursorColRef.current = null
      setCursorPosition(0)
    } else if (key.name === 'end') {
      desiredCursorColRef.current = null
      setCursorPosition(value.length)
    } else if (key.sequence && key.sequence.length > 1 && !key.ctrl && !key.meta && !key.name) {
      addPastedBlock(key.sequence)
      setHistoryIndex(-1)
      desiredCursorColRef.current = null
    } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      const char = key.sequence
      setValue(prev => prev.slice(0, cursorPosition) + char + prev.slice(cursorPosition))
      setCursorPosition(prev => prev + char.length)
      setHistoryIndex(-1)
      desiredCursorColRef.current = null
    }
  })

  const typedDisplay = value.replace(/\n/g, ' ')
  const displayValue = password && value ? '•'.repeat(value.length) : typedDisplay
  const cursorChar = '█'
  const isEmpty = value.length === 0

  const lineWidth = Math.max(10, terminalWidth - 4)

  const wrapTextWithCursor = (text: string, cursorPos: number, maxWidth: number): { lines: string[], cursorLine: number, cursorCol: number } => {
    if (text.length === 0) {
      return { lines: [''], cursorLine: 0, cursorCol: 0 }
    }

    const safeCursorPos = Math.max(0, Math.min(text.length, cursorPos))
    const lines: string[] = []
    for (let i = 0; i < text.length; i += maxWidth) {
      lines.push(text.slice(i, i + maxWidth))
    }

    let cursorLine: number
    let cursorCol: number

    if (safeCursorPos >= text.length) {
      cursorLine = lines.length - 1
      cursorCol = lines[cursorLine]!.length
    } else {
      cursorLine = Math.floor(safeCursorPos / maxWidth)
      cursorCol = safeCursorPos % maxWidth
    }

    cursorLine = Math.max(0, Math.min(lines.length - 1, cursorLine))
    cursorCol = Math.max(0, Math.min(lines[cursorLine]!.length, cursorCol))

    return { lines, cursorLine, cursorCol }
  }

  if (isEmpty) {
    if (!placeholder) {
      return (
        <box flexDirection="column" flexGrow={1} width="100%">
          <box flexDirection="row">
            <text>{cursorChar}</text>
          </box>
        </box>
      )
    }
    return (
      <box flexDirection="column" flexGrow={1} width="100%">
        <box flexDirection="row">
          <text>{cursorChar}</text>
          {placeholder.slice(1) && <text attributes={TextAttributes.DIM}>{placeholder.slice(1)}</text>}
        </box>
      </box>
    )
  }

  const { lines, cursorLine, cursorCol } = wrapTextWithCursor(displayValue, cursorPosition, lineWidth)

  const renderedLines = lines.map((line, lineIndex) => {
    if (lineIndex === cursorLine) {
      const beforeCursor = line.slice(0, cursorCol)
      const afterCursor = line.slice(cursorCol)
      return beforeCursor + cursorChar + afterCursor
    }
    return line || ' '
  })

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      {renderedLines.map((renderedLine, lineIndex) => (
        <box key={lineIndex} flexDirection="row">
          <text>{renderedLine}</text>
        </box>
      ))}
    </box>
  )
}