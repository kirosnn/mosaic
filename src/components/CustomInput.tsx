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
  const [cursorVisible, setCursorVisible] = useState(true)
  const [pasteBuffer, setPasteBuffer] = useState('')
  const [inPasteMode, setInPasteMode] = useState(false)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [currentInput, setCurrentInput] = useState('')
  const [inputHistory, setInputHistory] = useState<string[]>([])

  useEffect(() => {
    setInputHistory(getInputHistory())
  }, [])

  useEffect(() => {
    if (!focused) {
      setCursorVisible(true)
      return
    }

    const interval = setInterval(() => {
      setCursorVisible(prev => !prev)
    }, 500)

    return () => clearInterval(interval)
  }, [focused])

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
    setCursorVisible(true)

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

  if (isEmpty) {
    if (!placeholder) {
      return (
        <box flexDirection="row" flexGrow={1} width="100%">
          <text>{cursorVisible ? cursorChar : ' '}</text>
        </box>
      )
    }
    if (cursorVisible) {
      return (
        <box flexDirection="row" flexGrow={1} width="100%">
          <text>{cursorChar}</text>
          {placeholder.slice(1) && <text attributes={TextAttributes.DIM}>{placeholder.slice(1)}</text>}
        </box>
      )
    } else {
      return (
        <box flexDirection="row" flexGrow={1} width="100%">
          <text attributes={TextAttributes.DIM}>{placeholder}</text>
        </box>
      )
    }
  }

  const cursor = cursorVisible ? cursorChar : ' '
  const beforeCursor = displayValue.slice(0, cursorPosition)
  const afterCursor = displayValue.slice(cursorPosition)

  return (
    <box flexDirection="row" flexGrow={1} width="100%">
      {beforeCursor && <text>{beforeCursor}</text>}
      <text>{cursor}</text>
      {afterCursor && <text>{afterCursor}</text>}
    </box>
  )
}