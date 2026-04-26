import React, { useState } from 'react';
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
    <div style={{ padding: '24px' }}>
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
                {dayAppointments.slice(0, 3).map(apt => (
                  <div
                    key={apt.id}
                    onClick={e => {
                      e.stopPropagation();
                      onSelectAppointment(apt);
                    }}
                    style={{
                      backgroundColor: getTypeColor(apt.type, apt.isFixed),
                      color: 'white',
                      padding: '3px 4px',
                      borderRadius: '3px',
                      fontSize: '10px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      border: apt.isFixed ? '2px solid #dc2626' : 'none',
                    }}
                    title={apt.title}
                  >
                    {apt.title}
                  </div>
                ))}
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
