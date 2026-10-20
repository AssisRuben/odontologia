'use client'

import { useState } from 'react'

interface ClockPickerProps {
  value: string
  onChange: (v: string) => void
  onClose: () => void
}

const SIZE = 256
const CX = SIZE / 2
const CY = SIZE / 2
const OUTER_R = 94
const INNER_R = 62

function polar(r: number, deg: number) {
  const rad = (deg - 90) * (Math.PI / 180)
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) }
}

const OUTER_HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const INNER_HOURS = [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
const MINUTE_MARKS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

export function ClockPicker({ value, onChange, onClose }: ClockPickerProps) {
  const [h, setH] = useState(() => parseInt(value.split(':')[0] || '9'))
  const [m, setM] = useState(() => {
    const raw = parseInt(value.split(':')[1] || '0')
    return Math.round(raw / 5) * 5 % 60
  })
  const [mode, setMode] = useState<'hour' | 'minute'>('hour')

  const isInner = h === 0 || h >= 13
  const hIdx = isInner ? INNER_HOURS.indexOf(h) : OUTER_HOURS.indexOf(h)
  const mIdx = MINUTE_MARKS.indexOf(m)

  const handIdx = mode === 'hour' ? (hIdx >= 0 ? hIdx : 0) : (mIdx >= 0 ? mIdx : 0)
  const handAngle = handIdx * 30
  const handR = mode === 'hour' ? (isInner ? INNER_R : OUTER_R) : OUTER_R
  const handEnd = polar(handR, handAngle)

  function pickHour(hr: number) {
    setH(hr)
    setMode('minute')
    onChange(`${String(hr).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }

  function pickMinute(mn: number) {
    setM(mn)
    onChange(`${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`)
    onClose()
  }

  function confirm() {
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl overflow-hidden"
        style={{ width: 280 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#3B82F6] px-6 py-4 flex items-center justify-center gap-1 select-none">
          <button
            type="button"
            onClick={() => setMode('hour')}
            className="text-5xl font-light leading-none transition-opacity"
            style={{ opacity: mode === 'hour' ? 1 : 0.5, color: '#fff' }}
          >
            {String(h).padStart(2, '0')}
          </button>
          <span className="text-5xl font-light leading-none" style={{ color: 'rgba(255,255,255,0.7)' }}>:</span>
          <button
            type="button"
            onClick={() => setMode('minute')}
            className="text-5xl font-light leading-none transition-opacity"
            style={{ opacity: mode === 'minute' ? 1 : 0.5, color: '#fff' }}
          >
            {String(m).padStart(2, '0')}
          </button>
        </div>

        {/* Clock face */}
        <div className="flex justify-center py-3 px-3">
          <svg width={SIZE} height={SIZE}>
            {/* Face */}
            <circle cx={CX} cy={CY} r={CX - 4} fill="#F3F4F6" />

            {/* Hand */}
            <line x1={CX} y1={CY} x2={handEnd.x} y2={handEnd.y} stroke="#3B82F6" strokeWidth={2} />
            <circle cx={CX} cy={CY} r={4} fill="#3B82F6" />

            {mode === 'hour' ? (
              <>
                {OUTER_HOURS.map((hr, i) => {
                  const p = polar(OUTER_R, i * 30)
                  const sel = h === hr
                  return (
                    <g key={hr} onClick={() => pickHour(hr)} style={{ cursor: 'pointer' }}>
                      <circle cx={p.x} cy={p.y} r={22} fill="transparent" />
                      <circle cx={p.x} cy={p.y} r={18} fill={sel ? '#3B82F6' : 'transparent'} />
                      <text
                        x={p.x} y={p.y}
                        textAnchor="middle" dominantBaseline="central"
                        fontSize={13} fill={sel ? '#fff' : '#111827'}
                        style={{ userSelect: 'none', pointerEvents: 'none' }}
                      >
                        {hr}
                      </text>
                    </g>
                  )
                })}
                {INNER_HOURS.map((hr, i) => {
                  const p = polar(INNER_R, i * 30)
                  const sel = h === hr
                  return (
                    <g key={`i${hr}`} onClick={() => pickHour(hr)} style={{ cursor: 'pointer' }}>
                      <circle cx={p.x} cy={p.y} r={17} fill="transparent" />
                      <circle cx={p.x} cy={p.y} r={13} fill={sel ? '#3B82F6' : 'transparent'} />
                      <text
                        x={p.x} y={p.y}
                        textAnchor="middle" dominantBaseline="central"
                        fontSize={10} fill={sel ? '#fff' : '#6B7280'}
                        style={{ userSelect: 'none', pointerEvents: 'none' }}
                      >
                        {String(hr).padStart(2, '0')}
                      </text>
                    </g>
                  )
                })}
              </>
            ) : (
              MINUTE_MARKS.map((mn, i) => {
                const p = polar(OUTER_R, i * 30)
                const sel = mn === m
                return (
                  <g key={mn} onClick={() => pickMinute(mn)} style={{ cursor: 'pointer' }}>
                    <circle cx={p.x} cy={p.y} r={22} fill="transparent" />
                    <circle cx={p.x} cy={p.y} r={18} fill={sel ? '#3B82F6' : 'transparent'} />
                    <text
                      x={p.x} y={p.y}
                      textAnchor="middle" dominantBaseline="central"
                      fontSize={12} fill={sel ? '#fff' : '#111827'}
                      style={{ userSelect: 'none', pointerEvents: 'none' }}
                    >
                      {String(mn).padStart(2, '0')}
                    </text>
                  </g>
                )
              })
            )}
          </svg>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 pb-4 -mt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-[#6B7280] hover:bg-[#F3F4F6] rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirm}
            className="px-4 py-2 text-sm font-semibold text-[#3B82F6] hover:bg-[#EFF6FF] rounded-lg transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
