import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  Button,
  StatusPill,
  SegmentedControl,
  Toggle,
  Avatar,
  Input,
  Card,
  IconButton,
  MetaChip,
  ProgressMeter,
} from './index';

describe('Button', () => {
  it('renders its label and fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save anyway</Button>);
    const btn = screen.getByRole('button', { name: 'Save anyway' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Add appointment
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Add appointment' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults to type="button" so it never submits a form implicitly', () => {
    render(<Button>Ask</Button>);
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveAttribute('type', 'button');
  });
});

describe('StatusPill', () => {
  it('renders its status text', () => {
    render(<StatusPill intent="behind">behind</StatusPill>);
    expect(screen.getByText('behind')).toBeInTheDocument();
  });
});

describe('SegmentedControl', () => {
  it('marks the active option and reports the chosen value', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={['Day', 'Week', 'Month']}
        value="Week"
        onChange={onChange}
        ariaLabel="Calendar view"
      />,
    );
    const week = screen.getByRole('tab', { name: 'Week' });
    expect(week).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Month' }));
    expect(onChange).toHaveBeenCalledWith('Month');
  });

  it('supports {value,label} option objects', () => {
    render(
      <SegmentedControl
        options={[
          { value: 'sunday', label: 'Sunday' },
          { value: 'friday', label: 'Friday' },
        ]}
        value="sunday"
      />,
    );
    expect(screen.getByRole('tab', { name: 'Sunday' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Friday' })).toHaveAttribute('aria-selected', 'false');
  });
});

describe('Toggle', () => {
  it('exposes switch semantics and toggles its value', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Require PIN on open" />);
    const sw = screen.getByRole('switch', { name: 'Require PIN on open' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not toggle when disabled', () => {
    const onChange = vi.fn();
    render(<Toggle checked disabled onChange={onChange} label="Face ID" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Face ID' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Avatar', () => {
  it('derives two-letter initials from a full name', () => {
    render(<Avatar name="Theo R." />);
    expect(screen.getByText('TR')).toBeInTheDocument();
  });

  it('falls back to a placeholder for an empty name', () => {
    render(<Avatar name="" />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });
});

describe('Input', () => {
  it('associates its label and forwards changes', () => {
    const onChange = vi.fn();
    render(<Input label="Weekly hours" onChange={onChange} />);
    const field = screen.getByLabelText('Weekly hours');
    fireEvent.change(field, { target: { value: '20' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('shows the hint text', () => {
    render(<Input label="Earliest start" hint="Sessions never drafted outside this window" />);
    expect(screen.getByText('Sessions never drafted outside this window')).toBeInTheDocument();
  });
});

describe('Card', () => {
  it('renders children and is clickable when given onClick', () => {
    const onClick = vi.fn();
    render(
      <Card accent="var(--type-direct)" onClick={onClick}>
        <span>Theo R.</span>
      </Card>,
    );
    fireEvent.click(screen.getByText('Theo R.'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('IconButton', () => {
  it('uses its label as the accessible name and fires onClick', () => {
    const onClick = vi.fn();
    render(<IconButton icon="‹" label="Previous week" onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'Previous week' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('MetaChip', () => {
  it('renders its content', () => {
    render(<MetaChip icon="🦸">Theo R.</MetaChip>);
    expect(screen.getByText('Theo R.')).toBeInTheDocument();
  });
});

describe('ProgressMeter', () => {
  it('exposes progressbar semantics with the raw value', () => {
    render(<ProgressMeter value={8} max={10} cap={9} ariaLabel="Sam D. hours" />);
    const bar = screen.getByRole('progressbar', { name: 'Sam D. hours' });
    expect(bar).toHaveAttribute('aria-valuenow', '8');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
  });

  it('clamps an over-max value without error', () => {
    render(<ProgressMeter value={21} max={20} ariaLabel="over" />);
    expect(screen.getByRole('progressbar', { name: 'over' })).toHaveAttribute('aria-valuenow', '21');
  });
});
