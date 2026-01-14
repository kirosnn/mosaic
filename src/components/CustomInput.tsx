import { useState, useEffect } from 'react'
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { execSync } from 'child_process'
import { getInputHistory } from '../utils/history'

interface CustomInputProps {
  onSubmit: (value: string) => void
  placeholder?: string
  password?: boolean
  focused?: boolean
  pasteRequestId?: number
}

export function CustomInput({ onSubmit, placeholder = '', password = false, focused = true, pasteRequestId = 0 }: CustomInputProps) {
  const [value, setValue] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [terminalWidth, setTerminalWidth] = useState(process.stdout.columns || 80)
  const [pasteBuffer, setPasteBuffer] = useState('')
  const [inPasteMode, setInPasteMode] = useState(false)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [currentInput, setCurrentInput] = useState('')
  const [inputHistory, setInputHistory] = useState<string[]>([])

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
        clipboardText = execSync('powershell.exe -command "Get-Clipboard"', { encoding: 'utf8', timeout: 2000 }).trim()
      } else if (process.platform === 'darwin') {
        clipboardText = execSync('pbpaste', { encoding: 'utf8', timeout: 2000 })
      } else {
        clipboardText = execSync('xclip -selection clipboard -o', { encoding: 'utf8', timeout: 2000 })
      }
      if (clipboardText) {
        clipboardText = clipboardText.replace(/\r?\n|\r/g, '')
        setValue(prev => prev.slice(0, cursorPosition) + clipboardText + prev.slice(cursorPosition))
        setCursorPosition(prev => prev + clipboardText.length)
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

    if (key.sequence && key.sequence.includes('\x1b[200~')) {
      setInPasteMode(true)
      setPasteBuffer('')
      return
    }

    if (key.sequence && key.sequence.includes('\x1b[201~')) {
      setInPasteMode(false)
      if (pasteBuffer) {
        setValue(prev => prev.slice(0, cursorPosition) + pasteBuffer + prev.slice(cursorPosition))
        setCursorPosition(prev => prev + pasteBuffer.length)
        setPasteBuffer('')
      }
      return
    }

    if (inPasteMode) {
      setPasteBuffer(prev => prev + (key.sequence || ''))
      return
    }

    if (key.name === 'return') {
      onSubmit(value)
      setValue('')
      setCursorPosition(0)
      setHistoryIndex(-1)
      setCurrentInput('')
      setInputHistory(getInputHistory())
    } else if (key.name === 'backspace') {
      if (cursorPosition > 0) {
        setValue(prev => prev.slice(0, cursorPosition - 1) + prev.slice(cursorPosition))
        setCursorPosition(prev => prev - 1)
      }
    } else if (key.name === 'delete') {
      if (key.ctrl || key.meta) {
        setValue('')
        setCursorPosition(0)
      } else if (cursorPosition < value.length) {
        setValue(prev => prev.slice(0, cursorPosition) + prev.slice(cursorPosition + 1))
      }
    } else if (key.name === 'up') {
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
      setCursorPosition(prev => Math.max(0, prev - 1))
    } else if (key.name === 'right') {
      setCursorPosition(prev => Math.min(value.length, prev + 1))
    } else if (key.name === 'home') {
      setCursorPosition(0)
    } else if (key.name === 'end') {
      setCursorPosition(value.length)
    } else if (key.sequence && key.sequence.length > 1 && !key.ctrl && !key.meta && !key.name) {
      const pastedText = key.sequence
      setValue(prev => prev.slice(0, cursorPosition) + pastedText + prev.slice(cursorPosition))
      setCursorPosition(prev => prev + pastedText.length)
      setHistoryIndex(-1)
    } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      const char = key.sequence
      setValue(prev => prev.slice(0, cursorPosition) + char + prev.slice(cursorPosition))
      setCursorPosition(prev => prev + char.length)
      setHistoryIndex(-1)
    }
  })

  const displayValue = password && value ? '•'.repeat(value.length) : value
  const cursorChar = focused ? '█' : '│'
  const isEmpty = value.length === 0

  const lineWidth = Math.max(10, terminalWidth - 4)

  const wrapTextWithCursor = (text: string, cursorPos: number, maxWidth: number): { lines: string[], cursorLine: number, cursorCol: number } => {
    if (text.length === 0) {
      return { lines: [''], cursorLine: 0, cursorCol: 0 }
    }

    const lines: string[] = []
    let currentLine = ''
    let cursorLine = 0
    let cursorCol = 0

    for (let i = 0; i < text.length; i++) {
      if (i === cursorPos) {
        cursorLine = lines.length
        cursorCol = currentLine.length
      }

      currentLine += text[i]

      if (currentLine.length >= maxWidth) {
        lines.push(currentLine)
        currentLine = ''
      }
    }

    if (cursorPos === text.length) {
      cursorLine = lines.length
      cursorCol = currentLine.length
    }

    if (currentLine.length > 0 || lines.length === 0) {
      lines.push(currentLine)
    }

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

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      {lines.map((line, lineIndex) => {
        if (lineIndex === cursorLine) {
          const beforeCursor = line.slice(0, cursorCol)
          const afterCursor = line.slice(cursorCol)
          return (
            <box key={lineIndex} flexDirection="row">
              {beforeCursor && <text>{beforeCursor}</text>}
              <text>{cursorChar}</text>
              {afterCursor && <text>{afterCursor}</text>}
            </box>
          )
        }
        return (
          <box key={lineIndex} flexDirection="row">
            <text>{line || ' '}</text>
          </box>
        )
      })}
    </box>
  )
}