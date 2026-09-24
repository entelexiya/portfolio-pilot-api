import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]
type JsonObject = { [key: string]: JsonValue }

export function getRequestId(req: NextRequest) {
  return req.headers.get('x-request-id') || randomUUID()
}

function withRequestId(response: NextResponse, requestId: string) {
  response.headers.set('x-request-id', requestId)
  return response
}

export function success(
  data: JsonObject | JsonValue[] | null,
  requestId: string,
  status = 200,
  extras?: JsonObject
) {
  const payload: JsonObject = {
    success: true,
    requestId,
  }

  if (data !== null) payload.data = data
  if (extras) Object.assign(payload, extras)

  return withRequestId(NextResponse.json(payload, { status }), requestId)
}

export function failure(
  message: string,
  requestId: string,
  status = 400,
  code = 'BAD_REQUEST',
  details?: JsonObject
) {
  const payload: JsonObject = {
    success: false,
    error: message,
    code,
    requestId,
  }

  if (details) payload.details = details

  return withRequestId(NextResponse.json(payload, { status }), requestId)
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error'
}
