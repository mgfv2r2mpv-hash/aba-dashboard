import React, { useState, useEffect } from 'react';
import { Appointment, Technician, Client } from '../types';
import { startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, format, isSameMonth, addMonths, subMonths } from 'date-fns';

interface CalendarProps {
  appointments: Appointment[];
  technicians: Technician[];
  clients: Client[];
  onAppointmentChange: (appointment: Appointment) => void;
  onSelectAppointment: (appointment: Appointment | null) => void;
}

export default function Calendar({
  appointments,
  technicians,
  clients,
  onAppointmentChange,
  onSelectAppointment,
}: CalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // When a schedule loads with no appointments in the currently-shown month,
  // jump to the month containing the first appointment so users actually see
  // their data instead of an empty grid.
  useEffect(() => {
    if (appointments.length === 0) return;
    const hasAppointmentThisMonth = appointments.some(a =>
      isSameMonth(new Date(a.startTime), currentDate)
    );
    if (hasAppointmentThisMonth) return;
    const earliest = appointments
      .map(a => new Date(a.startTime))
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (earliest) setCurrentDate(earliest);
    // Intentionally only react to appointments identity, not currentDate —
    // we don't want to fight the user's manual navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments]);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getAppointmentsForDate = (date: Date): Appointment[] => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return appointments.filter(a => a.startTime.startsWith(dateStr));
  };

  const getTechnicianName = (id?: string): string => {
    if (!id) return 'Unknown';
    const tech = technicians.find(t => t.id === id || t.name === id);
    return tech?.name || id;
  };

  const getTypeColor = (type: string, isFixed: boolean): string => {
    if (isFixed) return '#ef4444';
    switch (type) {
      case 'supervision':
        return '#10b981';
      case 'parent-training':
        return '#3b82f6';
      case 'client-session':
        return '#8b5cf6';
      case 'internal-task':
        return '#6b7280';
      default:
        return '#9ca3af';
    }
  };

  const goToPreviousMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const goToNextMonth = () => setCurrentDate(addMonths(currentDate, 1));

  return (
    <div style={{ padding: 'clamp(8px, 3vw, 24px)', maxWidth: '100%', boxSizing: 'border-box' }}>
      {/* Month Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <button onClick={goToPreviousMonth} style={{
          padding: '8px 12px',
          backgroundColor: '#e5e7eb',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}>← Previous</button>
        <h2 style={{ fontSize: '20px', fontWeight: 'bold' }}>
          {format(currentDate, 'MMMM yyyy')}
        </h2>
        <button onClick={goToNextMonth} style={{
          padding: '8px 12px',
          backgroundColor: '#e5e7eb',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}>Next →</button>
      </div>

      {/* Day Headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '1px',
        backgroundColor: '#e5e7eb',
        marginBottom: '1px',
      }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div
            key={day}
            style={{
              padding: '12px 8px',
              backgroundColor: '#f9f9f9',
              fontWeight: '600',
              textAlign: 'center',
              fontSize: '13px',
            }}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '1px',
        backgroundColor: '#e5e7eb',
      }}>
        {calendarDays.map(day => {
          const dayAppointments = getAppointmentsForDate(day);
          const isCurrentMonth = isSameMonth(day, monthStart);
          const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

          return (
            <div
              key={format(day, 'yyyy-MM-dd')}
              style={{
                backgroundColor: isCurrentMonth ? '#ffffff' : '#f3f4f6',
                minHeight: '120px',
                padding: '8px',
                cursor: 'pointer',
                opacity: isCurrentMonth ? 1 : 0.5,
              }}
              onClick={() => setSelectedDate(day)}
            >
              <div
                style={{
                  fontWeight: isToday ? 'bold' : 'normal',
                  marginBottom: '4px',
                  color: isToday ? '#3b82f6' : '#374151',
                  fontSize: '13px',
                }}
              >
                {format(day, 'd')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {dayAppointments.slice(0, 3).map(apt => {
                  const baseColor = getTypeColor(apt.type, apt.isFixed);
                  const canceled = apt.status === 'canceled';
                  const completed = apt.status === 'completed';
                  // Diagonal candystripe per the QA spec.
                  const stripeBg = canceled
                    ? 'repeating-linear-gradient(45deg, #fca5a5, #fca5a5 6px, #9ca3af 6px, #9ca3af 12px)'
                    : completed
                    ? 'repeating-linear-gradient(45deg, #86efac, #86efac 6px, #ffffff 6px, #ffffff 12px)'
                    : undefined;
                  return (
                    <div
                      key={apt.id}
                      onClick={e => {
                        e.stopPropagation();
                        onSelectAppointment(apt);
                      }}
                      style={{
                        background: stripeBg ?? baseColor,
                        color: canceled || completed ? '#1f2937' : 'white',
                        padding: '3px 4px',
                        borderRadius: '3px',
                        fontSize: '10px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                        border: apt.isFixed && !canceled && !completed ? '2px solid #dc2626' : 'none',
                        position: 'relative',
                        paddingRight: canceled || completed ? 14 : 4,
                        textDecoration: canceled ? 'line-through' : 'none',
                        opacity: canceled ? 0.85 : 1,
                      }}
                      title={apt.title + (canceled ? ' (canceled)' : completed ? ' (completed)' : '')}
                    >
                      {apt.title}
                      {(canceled || completed) && (
                        <span
                          style={{
                            position: 'absolute', top: 1, right: 3,
                            fontSize: 10, fontWeight: 700,
                            color: canceled ? '#b91c1c' : '#15803d',
                            lineHeight: 1,
                          }}
                          aria-label={canceled ? 'canceled' : 'completed'}
                        >{canceled ? '✕' : '✓'}</span>
                      )}
                    </div>
                  );
                })}
                {dayAppointments.length > 3 && (
                  <div style={{ fontSize: '10px', color: '#9ca3af' }}>
                    +{dayAppointments.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
