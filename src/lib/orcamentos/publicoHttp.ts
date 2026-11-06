import { NextResponse } from 'next/server'

export const PUBLIC_HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } as const

export function publicJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PUBLIC_HEADERS })
}

export const INTERNAL_ERROR = 'Erro interno. Tente novamente.'
