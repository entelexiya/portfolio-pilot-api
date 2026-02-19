type LogLevel = 'info' | 'warn' | 'error'

type LogInput = {
  requestId?: string
  event: string
  message?: string
  meta?: Record<string, unknown>
  error?: unknown
}

function serializeError(error: unknown) {
  if (!error) return undefined
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  if (typeof error === 'string') return { message: error }
  return { value: error }
}

function writeLog(level: LogLevel, input: LogInput) {
  const payload = {
    level,
    event: input.event,
    requestId: input.requestId,
    message: input.message,
    meta: input.meta,
    error: serializeError(input.error),
    timestamp: new Date().toISOString(),
  }

  const line = JSON.stringify(payload)
  if (level === 'error') {
    console.error(line)
    return
  }
  if (level === 'warn') {
    console.warn(line)
    return
  }
  console.log(line)
}

export function logInfo(input: LogInput) {
  writeLog('info', input)
}

export function logWarn(input: LogInput) {
  writeLog('warn', input)
}

export function logError(input: LogInput) {
  writeLog('error', input)
}
