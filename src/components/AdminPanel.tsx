import React, { useState } from 'react';
import { ScheduleData, Technician, Client } from '../types';

interface AdminPanelProps {
  data: ScheduleData;
}

export default function AdminPanel({ data }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<'technicians' | 'clients' | 'settings'>('technicians');
  const [editingTech, setEditingTech] = useState<Technician | null>(null);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const handleTechnicianRBTChange = (tech: Technician, isRBT: boolean) => {
    setEditingTech({ ...tech, isRBT });
  };

  const handleClientAvailabilityChange = (client: Client, day: string, start: string, end: string) => {
    const updated = { ...client };
    updated.availabilityWindows = { ...updated.availabilityWindows };
    (updated.availabilityWindows as any)[day] = [{ start, end }];
    setEditingClient(updated);
  };

  const tabStyle = (isActive: boolean) => ({
    padding: '12px 16px',
    backgroundColor: isActive ? '#ffffff' : '#f3f4f6',
    border: isActive ? '2px solid #3b82f6' : '1px solid #e5e7eb',
    borderBottom: 'none',
    cursor: 'pointer',
    fontWeight: isActive ? '600' : 'normal',
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9f9f9' }}>
        <button
          onClick={() => setActiveTab('technicians')}
          style={tabStyle(activeTab === 'technicians')}
        >
          Technicians
        </button>
        <button
          onClick={() => setActiveTab('clients')}
          style={tabStyle(activeTab === 'clients')}
        >
          Clients
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          style={tabStyle(activeTab === 'settings')}
        >
          Settings
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {activeTab === 'technicians' && (
          <div>
            <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>
              Manage Technicians
            </h3>
            <div style={{ display: 'grid', gap: '16px' }}>
              {data.technicians.map(tech => (
                <div
                  key={tech.id}
                  style={{
                    backgroundColor: '#f9f9f9',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    padding: '16px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
                    <div>
                      <h4 style={{ marginBottom: '4px', fontWeight: '600' }}>{tech.name}</h4>
                      <p style={{ fontSize: '13px', color: '#6b7280' }}>ID: {tech.id}</p>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={tech.isRBT}
                        onChange={(e) => handleTechnicianRBTChange(tech, (e.target as any).checked)}
                        style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                      />
                      <span>RBT Certified</span>
                    </label>
                  </div>

                  {tech.assignments && tech.assignments.length > 0 && (
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>
                      <p style={{ marginBottom: '4px', fontWeight: '600' }}>Assignments:</p>
                      {tech.assignments.map((assign, idx) => (
                        <p key={idx}>• {assign.clientId}: {assign.hoursPerWeek}h/week</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'clients' && (
          <div>
            <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>
              Manage Clients
            </h3>
            <div style={{ display: 'grid', gap: '16px' }}>
              {data.clients.map(client => (
                <div
                  key={client.id}
                  style={{
                    backgroundColor: '#f9f9f9',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    padding: '16px',
                  }}
                >
                  <h4 style={{ marginBottom: '12px', fontWeight: '600' }}>{client.name}</h4>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>
                    <p style={{ marginBottom: '8px', fontWeight: '600' }}>Availability:</p>
                    {Object.entries(client.availabilityWindows || {}).map(([day, windows]) => (
                      windows && windows.length > 0 && (
                        <p key={day}>
                          {day}: {windows[0]?.start} - {windows[0]?.end}
                        </p>
                      )
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div>
            <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>
              Company Settings
            </h3>
            <div style={{
              backgroundColor: '#f9f9f9',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              padding: '16px',
              display: 'grid',
              gap: '16px',
            }}>
              <div>
                <p style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                  Supervision - Direct Hours
                </p>
                <p style={{ color: '#6b7280' }}>
                  {data.settings.supervisionDirectHoursPercent}% of direct client hours
                </p>
              </div>
              <div>
                <p style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                  Supervision - RBT Hours
                </p>
                <p style={{ color: '#6b7280' }}>
                  {data.settings.supervisionRBTHoursPercent}% of RBT hours
                </p>
              </div>
              <div>
                <p style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                  Parent Training
                </p>
                <p style={{ color: '#6b7280' }}>
                  Minimum: {data.settings.parentTrainingHoursPerMonth.minimum}h/month
                  <br />
                  Target: {data.settings.parentTrainingHoursPerMonth.target.min}-{data.settings.parentTrainingHoursPerMonth.target.max}h/month
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
