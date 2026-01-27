import { useState, useEffect, useRef } from 'react'
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/react"
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getInputHistory } from '../utils/history'
import { emitImageCommand, canUseImages } from '../utils/imageBridge'
import { notifyNotification } from '../utils/notificationBridge'
import type { ImageAttachment } from '../utils/images'

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
  submitDisabled?: boolean
}

export function CustomInput({ onSubmit, placeholder = '', password = false, focused = true, pasteRequestId = 0, disableHistory = false, submitDisabled = false }: CustomInputProps) {
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
  const lastBracketedPasteAtRef = useRef<number | null>(null)
  const lastClipboardPasteRef = useRef<{ at: number; text: string } | null>(null)
  const lastClipboardImageRef = useRef<{ at: number; signature: string } | null>(null)
  const lastPasteRequestIdRef = useRef(0)
  const lastPasteUndoRef = useRef<{ prevValue: string; prevCursor: number; nextValue: string; nextCursor: number } | null>(null)
  const valueRef = useRef(value)
  const cursorPositionRef = useRef(cursorPosition)

  const renderer = useRenderer()

  const normalizePastedText = (text: string) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

  const buildClipboardImage = (data: string, mimeType: string, size: number): ImageAttachment => {
    const ext = mimeType === 'image/jpeg' ? 'jpg' : (mimeType === 'image/png' ? 'png' : 'bin')
    return {
      id: createId(),
      name: `clipboard-${Date.now()}.${ext}`,
      mimeType,
      data,
      size
    }
  }

  const isPng = (buffer: Buffer) => buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  const isJpeg = (buffer: Buffer) => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff

  const readClipboardImage = (): { data: string; mimeType: string; size: number } | null => {
    try {
      if (process.platform === 'win32') {
        const script = 'powershell.exe -NoProfile -Command "$img=Get-Clipboard -Format Image -ErrorAction SilentlyContinue; if ($img) { $ms=New-Object System.IO.MemoryStream; $img.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray()) }"'
        const base64 = execSync(script, { encoding: 'utf8', timeout: 2000 }).trim()
        if (!base64) return null
        const size = Buffer.from(base64, 'base64').length
        return { data: base64, mimeType: 'image/png', size }
      }

      if (process.platform === 'darwin') {
        try {
          const buffer = execSync('pbpaste -Prefer png', { timeout: 2000 }) as Buffer
          if (buffer.length > 0 && isPng(buffer)) {
            return { data: buffer.toString('base64'), mimeType: 'image/png', size: buffer.length }
          }
        } catch {
        }
        try {
          const buffer = execSync('pbpaste -Prefer jpeg', { timeout: 2000 }) as Buffer
          if (buffer.length > 0 && isJpeg(buffer)) {
            return { data: buffer.toString('base64'), mimeType: 'image/jpeg', size: buffer.length }
          }
        } catch {
        }
        return null
      }

      try {
        const buffer = execSync('xclip -selection clipboard -t image/png -o', { timeout: 2000 }) as Buffer
        if (buffer.length > 0 && isPng(buffer)) {
          return { data: buffer.toString('base64'), mimeType: 'image/png', size: buffer.length }
        }
      } catch {
      }
      try {
        const buffer = execSync('xclip -selection clipboard -t image/jpeg -o', { timeout: 2000 }) as Buffer
        if (buffer.length > 0 && isJpeg(buffer)) {
          return { data: buffer.toString('base64'), mimeType: 'image/jpeg', size: buffer.length }
        }
      } catch {
      }
    } catch {
    }
    return null
  }

  const tryPasteImage = (): boolean => {
    const image = readClipboardImage()
    if (!image) return false
    const signature = `${image.mimeType}:${image.data.slice(0, 64)}`
    const now = Date.now()
    const last = lastClipboardImageRef.current
    if (last && last.signature === signature && now - last.at < 400) return true
    lastClipboardImageRef.current = { at: now, signature }

    if (!canUseImages()) {
      notifyNotification('Current model does not support images.', 'warning', 3000)
      return true
    }

    emitImageCommand({ type: 'add', image: buildClipboardImage(image.data, image.mimeType, image.size) })
    return true
  }

  const addPastedBlock = (pastedText: string) => {
    const normalized = normalizePastedText(pastedText)
    if (!normalized) return

    const insertAt = cursorPositionRef.current
    const prevValue = valueRef.current
    const nextValue = prevValue.slice(0, insertAt) + normalized + prevValue.slice(insertAt)
    lastPasteUndoRef.current = {
      prevValue,
      prevCursor: insertAt,
      nextValue,
      nextCursor: insertAt + normalized.length
    }
    setValue(nextValue)
    setCursorPosition(insertAt + normalized.length)
    pasteFlagRef.current = true
    pastedContentRef.current = normalized
  }

  const openExternalEditor = () => {
    const filePath = join(tmpdir(), `mosaic-input-${Date.now()}-${process.pid}.txt`)
    try {
      writeFileSync(filePath, value, 'utf-8')
      if (process.platform === 'win32') {
        const escaped = filePath.replace(/'/g, "''")
        execSync(`powershell.exe -NoProfile -Command "Start-Process notepad.exe -ArgumentList '${escaped}' -Wait"`, { stdio: 'ignore' })
      } else if (process.platform === 'darwin') {
        execSync(`open -W -a TextEdit "${filePath}"`, { stdio: 'ignore' })
      } else {
        const editor = process.env.EDITOR || 'nano'
        execSync(`${editor} "${filePath}"`, { stdio: 'inherit' })
      }
      const updated = readFileSync(filePath, 'utf-8')
      const normalized = normalizePastedText(updated)
      setValue(normalized)
      setCursorPosition(normalized.length)
      setHistoryIndex(-1)
      desiredCursorColRef.current = null
    } catch (error) {
    } finally {
      try {
        rmSync(filePath)
      } catch (error) {
      }
    }
  }

  useEffect(() => {
    setInputHistory(getInputHistory())
  }, [])

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    cursorPositionRef.current = cursorPosition
  }, [cursorPosition])

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
      if (tryPasteImage()) return
      let clipboardText = ''
      if (process.platform === 'win32') {
        clipboardText = execSync('powershell.exe -command "Get-Clipboard"', { encoding: 'utf8', timeout: 2000 })
      } else if (process.platform === 'darwin') {
        clipboardText = execSync('pbpaste', { encoding: 'utf8', timeout: 2000 })
      } else {
        clipboardText = execSync('xclip -selection clipboard -o', { encoding: 'utf8', timeout: 2000 })
      }
      const normalized = normalizePastedText(clipboardText || '')
      if (!normalized) return
      const now = Date.now()
      const last = lastClipboardPasteRef.current
      if (last && last.text === normalized && now - last.at < 400) return
      lastClipboardPasteRef.current = { at: now, text: normalized }
      addPastedBlock(normalized)
    } catch (error) {
    }
  }

  useEffect(() => {
    if (!focused) return
    if (!pasteRequestId) return
    if (pasteRequestId === lastPasteRequestIdRef.current) return
    lastPasteRequestIdRef.current = pasteRequestId
    if (inPasteMode) return
    const now = Date.now()
    const lastBracketed = lastBracketedPasteAtRef.current
    if (lastBracketed && now - lastBracketed < 250) return
    pasteFromClipboard()
  }, [pasteRequestId, focused, inPasteMode])

  useEffect(() => {
    if (!focused) return

    const handlePaste = (event: { text?: string } | string) => {
      const text = typeof event === 'string' ? event : (event?.text || '')
      const normalized = normalizePastedText(text)
      if (!normalized) return
      const now = Date.now()
      const last = lastClipboardPasteRef.current
      if (last && last.text === normalized && now - last.at < 400) return
      lastClipboardPasteRef.current = { at: now, text: normalized }
      addPastedBlock(normalized)
      setHistoryIndex(-1)
      desiredCursorColRef.current = null
      lastBracketedPasteAtRef.current = now
    }

    renderer.keyInput.on('paste', handlePaste as any)
    return () => {
      renderer.keyInput.off('paste', handlePaste as any)
    }
  }, [focused, renderer.keyInput])

  const wrapTextWithCursor = (text: string, cursorPos: number, maxWidth: number): { lines: string[], cursorLine: number, cursorCol: number } => {
    const safeCursorPos = Math.max(0, Math.min(text.length, cursorPos))
    const lines: string[] = ['']
    let lineIndex = 0
    let col = 0
    let cursorLine = 0
    let cursorCol = 0

    for (let i = 0; i <= text.length; i += 1) {
      if (i === safeCursorPos) {
        cursorLine = lineIndex
        cursorCol = col
      }

      if (i === text.length) break

      const ch = text[i]!
      if (ch === '\n') {
        lines.push('')
        lineIndex += 1
        col = 0
        continue
      }

      if (col >= maxWidth) {
        lines.push('')
        lineIndex += 1
        col = 0
      }

      lines[lineIndex] = (lines[lineIndex] || '') + ch
      col += 1
    }

    return { lines, cursorLine, cursorCol }
  }

  useKeyboard((key) => {
    if (!focused) return

    if (key.sequence && key.sequence.includes('\x1b[200~')) {
      lastBracketedPasteAtRef.current = Date.now()
      setInPasteMode(true)
      setPasteBuffer('')
      return
    }

    if (key.sequence && key.sequence.includes('\x1b[201~')) {
      setInPasteMode(false)
      if (pasteBuffer) {
        const now = Date.now()
        const normalized = normalizePastedText(pasteBuffer)
        const last = lastClipboardPasteRef.current
        if (!last || last.text !== normalized || now - last.at >= 400) {
          addPastedBlock(pasteBuffer)
        }
        setPasteBuffer('')
        lastBracketedPasteAtRef.current = now
      }
      return
    }

    if (inPasteMode) {
      setPasteBuffer(prev => prev + (key.sequence || ''))
      return
    }

    if ((key.name === 'z' && key.ctrl) || key.sequence === '\x1a') {
      const lastPaste = lastPasteUndoRef.current
      if (lastPaste && valueRef.current === lastPaste.nextValue) {
        setValue(lastPaste.prevValue)
        setCursorPosition(lastPaste.prevCursor)
        lastPasteUndoRef.current = null
        pasteFlagRef.current = false
        pastedContentRef.current = ''
      }
      return
    }

    if ((key.name === 'v' && key.ctrl) || key.sequence === '\x16') {
      pasteFromClipboard()
      setHistoryIndex(-1)
      desiredCursorColRef.current = null
      return
    }

    if (key.name === 'k' && (key.ctrl || key.meta || (key as any).alt)) {
      setValue('')
      setCursorPosition(0)
      setHistoryIndex(-1)
      setCurrentInput('')
      pasteFlagRef.current = false
      pastedContentRef.current = ''
      desiredCursorColRef.current = null
      return
    }

    if (key.name === 'g' && (key.ctrl || key.meta)) {
      openExternalEditor()
      return
    }

    if (key.name === 'return') {
      if (submitDisabled) return
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
      const lineWidth = Math.max(10, terminalWidth - 4)
      const { lines: displayLines, cursorLine: currentCursorLine, cursorCol: currentCursorCol } = wrapTextWithCursor(value, cursorPosition, lineWidth)
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
      const lineWidth = Math.max(10, terminalWidth - 4)
      const { lines: displayLines, cursorLine: currentCursorLine, cursorCol: currentCursorCol } = wrapTextWithCursor(value, cursorPosition, lineWidth)
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

  const displayValue = password && value ? Array.from(value, (char) => (char === '\n' ? '\n' : '•')).join('') : value
  const isEmpty = value.length === 0

  const lineWidth = Math.max(10, terminalWidth - 4)

  if (isEmpty) {
    if (!placeholder) {
      return (
        <box flexDirection="column" flexGrow={1} width="100%">
          <box flexDirection="row">
            <text fg="black" bg="white"> </text>
          </box>
        </box>
      )
    }
    const firstChar = placeholder[0] || ' '
    return (
      <box flexDirection="column" flexGrow={1} width="100%">
        <box flexDirection="row">
          <text fg="gray" bg="white" attributes={TextAttributes.DIM}>{firstChar}</text>
          {placeholder.slice(1) && <text fg="gray" attributes={TextAttributes.DIM}>{placeholder.slice(1)}</text>}
        </box>
      </box>
    )
  }

  const { lines, cursorLine, cursorCol } = wrapTextWithCursor(displayValue, cursorPosition, lineWidth)

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      {lines.map((line, lineIndex) => (
        <box key={lineIndex} flexDirection="row">
          {lineIndex === cursorLine ? (
            <>
              {line.slice(0, cursorCol) && <text>{line.slice(0, cursorCol)}</text>}
              <text fg="black" bg="white">{line[cursorCol] || ' '}</text>
              {line.slice(cursorCol + 1) && <text>{line.slice(cursorCol + 1)}</text>}
            </>
          ) : (
            <text>{line || ' '}</text>
          )}
        </box>
      ))}
    </box>
  )
}
