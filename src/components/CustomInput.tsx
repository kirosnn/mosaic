import { useState, useEffect, useRef } from 'react'
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/react"
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getInputHistory } from '../utils/history'
import { tryPasteImage, normalizePastedText } from './main/clipboard'
import { commandRegistry, initializeCommands } from '../utils/commands'
import { listWorkspaceSkills } from '../utils/skills'

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
  maxWidth?: number
  initialValue?: string
}

interface SlashCompletionItem {
  token: string
  kind: 'command' | 'skill'
}

const ENABLE_TUI_COMPLETIONS = false

function parseSlashInput(input: string): { prefix: string; query: string; suffix: string } | null {
  const match = input.match(/^(\s*\/)([^\s]*)([\s\S]*)$/)
  if (!match) return null
  return {
    prefix: match[1] || '/',
    query: (match[2] || '').toLowerCase(),
    suffix: match[3] || '',
  }
}

function buildSlashCompletions(input: string): SlashCompletionItem[] {
  const parsed = parseSlashInput(input)
  if (!parsed) return []
  if (/\S/.test(parsed.suffix)) return []

  const commands = Array.from(commandRegistry.getAll().entries())
    .filter(([name, cmd]) => name === cmd.name)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b))
  const skills = listWorkspaceSkills().map((skill) => skill.id)

  const query = parsed.query
  const score = (token: string) => {
    const lower = token.toLowerCase()
    if (!query) return 0.55
    if (lower === query) return 1
    if (lower.startsWith(query)) return 0.92 + (query.length / Math.max(1, lower.length)) * 0.06
    if (lower.includes(query)) return 0.72
    return 0
  }

  const commandItems = commands
    .map((token) => ({ token, kind: 'command' as const, score: score(token) + 0.04 }))
    .filter((item) => item.score > 0)
  const skillItems = skills
    .map((token) => ({ token, kind: 'skill' as const, score: score(token) }))
    .filter((item) => item.score > 0)

  return [...commandItems, ...skillItems]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.kind !== b.kind) return a.kind === 'command' ? -1 : 1
      return a.token.localeCompare(b.token)
    })
    .slice(0, 30)
    .map(({ token, kind }) => ({ token, kind }))
}

function applySlashCompletion(input: string, token: string): string {
  const parsed = parseSlashInput(input)
  if (!parsed) return input
  const normalized = token.replace(/^\//, '').trim()
  if (!normalized) return input
  const nextBase = `${parsed.prefix}${normalized}`
  if (parsed.suffix) return `${nextBase}${parsed.suffix}`
  return `${nextBase} `
}

export function CustomInput({ onSubmit, placeholder = '', password = false, focused = true, pasteRequestId = 0, disableHistory = false, submitDisabled = false, maxWidth, initialValue }: CustomInputProps) {
  const [value, setValue] = useState(initialValue ?? '')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [terminalWidth, setTerminalWidth] = useState(process.stdout.columns || 80)
  const [selectionStart, setSelectionStart] = useState<number | null>(null)
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null)
  const [pasteBuffer, setPasteBuffer] = useState('')
  const [inPasteMode, setInPasteMode] = useState(false)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [currentInput, setCurrentInput] = useState('')
  const [inputHistory, setInputHistory] = useState<string[]>([])
  const [completionIndex, setCompletionIndex] = useState(0)
  const [hoveredCompletionToken, setHoveredCompletionToken] = useState<string | null>(null)

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
  const selectionStartRef = useRef<number | null>(selectionStart)
  const selectionEndRef = useRef<number | null>(selectionEnd)
  const initialValueRef = useRef(initialValue ?? '')
  const completionScrollboxRef = useRef<any>(null)

  const renderer = useRenderer()
  const completions = ENABLE_TUI_COMPLETIONS ? buildSlashCompletions(value) : []
  const completionKey = completions.map((item) => item.token).join('|')

  useEffect(() => {
    initializeCommands()
  }, [])

  useEffect(() => {
    setCompletionIndex(0)
    setHoveredCompletionToken(null)
  }, [completionKey])

  useEffect(() => {
    if (completionIndex < 0 || completionIndex >= completions.length) return
    const scrollbox = completionScrollboxRef.current
    if (!scrollbox || typeof scrollbox.scrollTo !== 'function') return
    scrollbox.scrollTo(completionIndex)
  }, [completionIndex, completions.length])

  useEffect(() => {
    if (initialValue === undefined) return
    if (initialValue === initialValueRef.current) return
    initialValueRef.current = initialValue
    setValue(initialValue)
    setCursorPosition(initialValue.length)
    setSelectionStart(null)
    setSelectionEnd(null)
    setHistoryIndex(-1)
    setCurrentInput('')
    desiredCursorColRef.current = null
  }, [initialValue])


  const addPastedBlock = (pastedText: string) => {
    const normalized = normalizePastedText(pastedText)
    if (!normalized) return

    const prevValue = valueRef.current
    const selStart = selectionStartRef.current
    const selEnd = selectionEndRef.current
    const hasSelection = typeof selStart === 'number' && typeof selEnd === 'number' && selEnd > selStart
    const insertAt = hasSelection ? selStart! : cursorPositionRef.current
    const deleteUntil = hasSelection ? selEnd! : insertAt
    const nextValue = prevValue.slice(0, insertAt) + normalized + prevValue.slice(deleteUntil)
    lastPasteUndoRef.current = {
      prevValue,
      prevCursor: insertAt,
      nextValue,
      nextCursor: insertAt + normalized.length
    }
    setValue(nextValue)
    setCursorPosition(insertAt + normalized.length)
    if (hasSelection) {
      setSelectionStart(null)
      setSelectionEnd(null)
    }
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
      setSelectionStart(null)
      setSelectionEnd(null)
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
    selectionStartRef.current = selectionStart
  }, [selectionStart])

  useEffect(() => {
    selectionEndRef.current = selectionEnd
  }, [selectionEnd])

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
      if (tryPasteImage(lastClipboardImageRef)) return
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

  const wrapTextWithCursor = (text: string, cursorPos: number, maxWidth: number): { lineStarts: number[], lineLengths: number[], cursorLine: number, cursorCol: number } => {
    const safeCursorPos = Math.max(0, Math.min(text.length, cursorPos))
    const lineStarts: number[] = [0]
    const lineLengths: number[] = [0]
    let lineIndex = 0
    let col = 0
    let cursorLine = 0
    let cursorCol = 0

    for (let i = 0; i <= text.length; i += 1) {
      if (col >= maxWidth) {
        lineStarts.push(i)
        lineLengths.push(0)
        lineIndex += 1
        col = 0
      }

      if (i === safeCursorPos) {
        cursorLine = lineIndex
        cursorCol = col
      }

      if (i === text.length) break

      const ch = text[i]!
      if (ch === '\n') {
        lineStarts.push(i + 1)
        lineLengths.push(0)
        lineIndex += 1
        col = 0
        continue
      }

      lineLengths[lineIndex] = (lineLengths[lineIndex] || 0) + 1
      col += 1
    }

    return { lineStarts, lineLengths, cursorLine, cursorCol }
  }

  const buildDisplayLines = (displayText: string, lineStarts: number[], lineLengths: number[]) => {
    const lines: string[] = []
    for (let i = 0; i < lineStarts.length; i += 1) {
      const start = lineStarts[i] ?? 0
      const len = lineLengths[i] ?? 0
      lines.push(displayText.slice(start, start + len))
    }
    return lines
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

    if (key.name === 'escape' || key.sequence === '\x1b') {
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
        setSelectionStart(null)
        setSelectionEnd(null)
      }
      return
    }

    if (key.name === 'a' && (key.ctrl || key.meta)) {
      if (value.length > 0) {
        const selStart = selectionStartRef.current
        const selEnd = selectionEndRef.current
        const hasSelection = typeof selStart === 'number' && typeof selEnd === 'number' && selEnd > selStart
        const fullSelection = hasSelection && selStart === 0 && selEnd === value.length
        if (fullSelection) {
          setSelectionStart(null)
          setSelectionEnd(null)
          setCursorPosition(value.length)
        } else {
          setSelectionStart(0)
          setSelectionEnd(value.length)
          setCursorPosition(value.length)
        }
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
      setSelectionStart(null)
      setSelectionEnd(null)
      return
    }

    if (key.name === 'g' && (key.ctrl || key.meta)) {
      openExternalEditor()
      return
    }

    if (key.name === 'tab') {
      const total = completions.length
      if (total > 0) {
        const index = Math.max(0, Math.min(completionIndex, total - 1))
        const selected = completions[index]
        if (!selected) return
        const nextValue = applySlashCompletion(valueRef.current, selected.token)
        setValue(nextValue)
        setCursorPosition(nextValue.length)
        setSelectionStart(null)
        setSelectionEnd(null)
        setHistoryIndex(-1)
        desiredCursorColRef.current = null
      }
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
      setSelectionStart(null)
      setSelectionEnd(null)
    } else if (key.name === 'backspace') {
      desiredCursorColRef.current = null
      const selStart = selectionStartRef.current
      const selEnd = selectionEndRef.current
      if (typeof selStart === 'number' && typeof selEnd === 'number' && selEnd > selStart) {
        const prev = valueRef.current
        const nextValue = prev.slice(0, selStart) + prev.slice(selEnd)
        setValue(nextValue)
        setCursorPosition(selStart)
        setSelectionStart(null)
        setSelectionEnd(null)
        return
      }
      if (cursorPosition > 0) {
        setValue(prev => prev.slice(0, cursorPosition - 1) + prev.slice(cursorPosition))
        setCursorPosition(prev => prev - 1)
      }
    } else if (key.name === 'delete') {
      desiredCursorColRef.current = null
      const selStart = selectionStartRef.current
      const selEnd = selectionEndRef.current
      if (typeof selStart === 'number' && typeof selEnd === 'number' && selEnd > selStart) {
        const prev = valueRef.current
        const nextValue = prev.slice(0, selStart) + prev.slice(selEnd)
        setValue(nextValue)
        setCursorPosition(selStart)
        setSelectionStart(null)
        setSelectionEnd(null)
        return
      }
      if (key.ctrl || key.meta) {
        setValue('')
        setCursorPosition(0)
        pasteFlagRef.current = false
        pastedContentRef.current = ''
        setSelectionStart(null)
        setSelectionEnd(null)
      } else if (cursorPosition < value.length) {
        setValue(prev => prev.slice(0, cursorPosition) + prev.slice(cursorPosition + 1))
      }
    } else if (key.name === 'up') {
      if (completions.length > 0) {
        setCompletionIndex((prev) => {
          if (completions.length <= 1) return 0
          return prev <= 0 ? completions.length - 1 : prev - 1
        })
        return
      }
      const lineWidth = Math.max(10, terminalWidth - 4)
      const { lineLengths, cursorLine: currentCursorLine, cursorCol: currentCursorCol, lineStarts } = wrapTextWithCursor(value, cursorPosition, lineWidth)
      if (currentCursorLine > 0) {
        if (desiredCursorColRef.current === null) {
          desiredCursorColRef.current = currentCursorCol
        }
        const targetLine = currentCursorLine - 1
        const targetCol = desiredCursorColRef.current
        const targetLineLen = lineLengths[targetLine] ?? 0
        const lineStart = lineStarts[targetLine] ?? 0
        const newCursorPos = lineStart + Math.min(targetCol, targetLineLen)
        setCursorPosition(Math.min(value.length, newCursorPos))
        setSelectionStart(null)
        setSelectionEnd(null)
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
        setSelectionStart(null)
        setSelectionEnd(null)
      } else if (historyIndex > 0) {
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        setValue(inputHistory[newIndex]!)
        setCursorPosition(inputHistory[newIndex]!.length)
        setSelectionStart(null)
        setSelectionEnd(null)
      }
    } else if (key.name === 'down') {
      if (completions.length > 0) {
        setCompletionIndex((prev) => {
          if (completions.length <= 1) return 0
          return prev >= completions.length - 1 ? 0 : prev + 1
        })
        return
      }
      const lineWidth = Math.max(10, terminalWidth - 4)
      const { lineLengths, cursorLine: currentCursorLine, cursorCol: currentCursorCol, lineStarts } = wrapTextWithCursor(value, cursorPosition, lineWidth)
      if (currentCursorLine < lineStarts.length - 1) {
        if (desiredCursorColRef.current === null) {
          desiredCursorColRef.current = currentCursorCol
        }
        const targetLine = currentCursorLine + 1
        const targetCol = desiredCursorColRef.current
        const targetLineLen = lineLengths[targetLine] ?? 0
        const lineStart = lineStarts[targetLine] ?? value.length
        const newCursorPos = lineStart + Math.min(targetCol, targetLineLen)
        setCursorPosition(Math.min(value.length, newCursorPos))
        setSelectionStart(null)
        setSelectionEnd(null)
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
        setSelectionStart(null)
        setSelectionEnd(null)
      } else {
        setHistoryIndex(-1)
        setValue(currentInput)
        setCursorPosition(currentInput.length)
        setSelectionStart(null)
        setSelectionEnd(null)
      }
    } else if (key.name === 'left') {
      desiredCursorColRef.current = null
      setCursorPosition(prev => Math.max(0, prev - 1))
      setSelectionStart(null)
      setSelectionEnd(null)
    } else if (key.name === 'right') {
      desiredCursorColRef.current = null
      setCursorPosition(prev => Math.min(value.length, prev + 1))
      setSelectionStart(null)
      setSelectionEnd(null)
    } else if (key.name === 'home') {
      desiredCursorColRef.current = null
      setCursorPosition(0)
      setSelectionStart(null)
      setSelectionEnd(null)
    } else if (key.name === 'end') {
      desiredCursorColRef.current = null
      setCursorPosition(value.length)
      setSelectionStart(null)
      setSelectionEnd(null)
    } else if (key.sequence && key.sequence.length > 1 && !key.ctrl && !key.meta && !key.name) {
      addPastedBlock(key.sequence)
      setHistoryIndex(-1)
      desiredCursorColRef.current = null
      setSelectionStart(null)
      setSelectionEnd(null)
    } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      const char = key.sequence
      const selStart = selectionStartRef.current
      const selEnd = selectionEndRef.current
      if (typeof selStart === 'number' && typeof selEnd === 'number' && selEnd > selStart) {
        const prev = valueRef.current
        const nextValue = prev.slice(0, selStart) + char + prev.slice(selEnd)
        setValue(nextValue)
        setCursorPosition(selStart + char.length)
        setSelectionStart(null)
        setSelectionEnd(null)
      } else {
        setValue(prev => prev.slice(0, cursorPosition) + char + prev.slice(cursorPosition))
        setCursorPosition(prev => prev + char.length)
      }
      setHistoryIndex(-1)
      desiredCursorColRef.current = null
    }
  })

  const displayValue = password && value ? Array.from(value, (char) => (char === '\n' ? '\n' : '•')).join('') : value
  const isEmpty = value.length === 0

  const lineWidth = Math.max(10, maxWidth ?? (terminalWidth - 4))

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

  const { lineStarts, lineLengths, cursorLine, cursorCol } = wrapTextWithCursor(value, cursorPosition, lineWidth)
  const lines = buildDisplayLines(displayValue, lineStarts, lineLengths)
  const selectionRange = (() => {
    if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
      const start = Math.max(0, Math.min(selectionStart, selectionEnd))
      const end = Math.max(0, Math.max(selectionStart, selectionEnd))
      if (end > start) return { start, end }
    }
    return null
  })()

  const buildSelectionSegments = (text: string, absStart: number) => {
    if (!selectionRange || text.length === 0) {
      return [{ text, selected: false }]
    }
    const segStart = absStart
    const segEnd = absStart + text.length
    if (selectionRange.end <= segStart || selectionRange.start >= segEnd) {
      return [{ text, selected: false }]
    }
    const parts: Array<{ text: string; selected: boolean }> = []
    if (selectionRange.start > segStart) {
      parts.push({ text: text.slice(0, selectionRange.start - segStart), selected: false })
    }
    const selFrom = Math.max(selectionRange.start, segStart) - segStart
    const selTo = Math.min(selectionRange.end, segEnd) - segStart
    parts.push({ text: text.slice(selFrom, selTo), selected: true })
    if (selectionRange.end < segEnd) {
      parts.push({ text: text.slice(selTo), selected: false })
    }
    return parts.filter(p => p.text.length > 0)
  }

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      {lines.map((line, lineIndex) => (
        <box key={lineIndex} flexDirection="row">
          {(() => {
            const lineStart = lineStarts[lineIndex] ?? 0
            if (lineIndex === cursorLine) {
              const safeCursorCol = Math.max(0, Math.min(line.length, cursorCol))
              const before = line.slice(0, safeCursorCol)
              const cursorChar = line[safeCursorCol] || ' '
              const after = line.slice(safeCursorCol + 1)
              const beforeSegs = buildSelectionSegments(before, lineStart)
              const afterSegs = buildSelectionSegments(after, lineStart + safeCursorCol + 1)
              return (
                <>
                  {beforeSegs.map((seg, i) => (
                    <text key={`b-${i}`} fg="white" bg={seg.selected ? "#3a3a3a" : undefined}>
                      {seg.text}
                    </text>
                  ))}
                  <text fg="black" bg="white">{cursorChar}</text>
                  {afterSegs.map((seg, i) => (
                    <text key={`a-${i}`} fg="white" bg={seg.selected ? "#3a3a3a" : undefined}>
                      {seg.text}
                    </text>
                  ))}
                </>
              )
            }
            const segs = buildSelectionSegments(line || ' ', lineStart)
            return (
              <>
                {segs.map((seg, i) => (
                  <text key={`l-${i}`} fg="white" bg={seg.selected ? "#3a3a3a" : undefined}>
                    {seg.text}
                  </text>
                ))}
              </>
            )
          })()}
        </box>
      ))}
      {completions.length > 0 && (
        <box
          flexDirection="column"
          marginTop={1}
          backgroundColor="#141414"
          opacity={0.92}
          padding={1}
          width="100%"
        >
          <box marginBottom={1} flexDirection="row" justifyContent="space-between" width="100%">
            <text attributes={TextAttributes.BOLD}>Completions</text>
            <box flexDirection="row">
              <text fg="white">↑↓ </text>
              <text attributes={TextAttributes.DIM}>select</text>
              <text fg="white">  tab </text>
              <text attributes={TextAttributes.DIM}>apply</text>
            </box>
          </box>
          <scrollbox
            ref={completionScrollboxRef}
            flexDirection="column"
            width="100%"
            height={Math.min(8, Math.max(3, completions.length))}
            verticalScrollbarOptions={{
              showArrows: false,
              trackOptions: {
                backgroundColor: "#1f1f1f",
                foregroundColor: "#383838",
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
            {completions.map((item, index) => {
              const active = index === completionIndex || hoveredCompletionToken === item.token
              return (
                <box
                  key={`completion-${item.token}-${index}`}
                  flexDirection="row"
                  width="100%"
                  backgroundColor={active ? "#2a2a2a" : "transparent"}
                  paddingLeft={1}
                  paddingRight={1}
                  onMouseOver={() => {
                    setHoveredCompletionToken(item.token)
                    setCompletionIndex(index)
                  }}
                  onMouseOut={() => {
                    setHoveredCompletionToken((prev) => (prev === item.token ? null : prev))
                  }}
                  onMouseDown={(event: any) => {
                    event?.stopPropagation?.()
                    const nextValue = applySlashCompletion(valueRef.current, item.token)
                    setValue(nextValue)
                    setCursorPosition(nextValue.length)
                    setSelectionStart(null)
                    setSelectionEnd(null)
                    setHistoryIndex(-1)
                    desiredCursorColRef.current = null
                  }}
                >
                  <text fg="#ffca38">{'\u203A'} </text>
                  <text>{`/${item.token}`}</text>
                </box>
              )
            })}
          </scrollbox>
        </box>
      )}
    </box>
  )
}
