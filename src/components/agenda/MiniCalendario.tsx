'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from 'date-fns'
import { useEffect } from 'react'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils'

interface MiniCalendarioProps {
  selectedDate: Date
  onSelectDate: (date: Date) => void
}

export function MiniCalendario({ selectedDate, onSelectDate }: MiniCalendarioProps) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(selectedDate))

  useEffect(() => {
    if (!isSameMonth(selectedDate, currentMonth)) {
      setCurrentMonth(startOfMonth(selectedDate))
    }
  }, [selectedDate]) // eslint-disable-line react-hooks/exhaustive-deps

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  const weekDays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

  return (
    <div className="p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          className="p-1 rounded hover:bg-[#F3F4F6] text-[#6B7280]"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-[#111827] capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
        </span>
        <button
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          className="p-1 rounded hover:bg-[#F3F4F6] text-[#6B7280]"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Week days */}
      <div className="grid grid-cols-7 mb-1">
        {weekDays.map((day, i) => (
          <div key={i} className="text-center text-xs font-medium text-[#9CA3AF] py-1">
            {day}
          </div>
        ))}
      </div>

      {/* Days */}
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const isSelected = isSameDay(day, selectedDate)
          const isToday = isSameDay(day, new Date())
          const isCurrentMonth = isSameMonth(day, currentMonth)

          return (
            <button
              key={day.toISOString()}
              onClick={() => onSelectDate(day)}
              className={cn(
                'aspect-square flex items-center justify-center text-xs rounded-full transition-colors',
                isSelected && 'bg-[#3B82F6] text-white font-semibold',
                !isSelected && isToday && 'text-[#3B82F6] font-semibold',
                !isSelected && !isToday && isCurrentMonth && 'text-[#111827] hover:bg-[#F3F4F6]',
                !isSelected && !isCurrentMonth && 'text-[#D1D5DB]'
              )}
            >
              {format(day, 'd')}
            </button>
          )
        })}
      </div>
    </div>
  )
}
