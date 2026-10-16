import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
  icon?: ReactNode;
}

export interface CustomSelectProps {
  id?: string;
  label?: string;
  value: string;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  variant?: 'guild' | 'field';
  leadingIcon?: ReactNode;
}

export function CustomSelect({
  id,
  label,
  value,
  options,
  placeholder = 'Selecciona una opción',
  disabled = false,
  onChange,
  variant = 'field',
  leadingIcon,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((item) => item.value === value);

  useEffect(() => {
    if (!open) return;
    const selectedIdx = options.findIndex((item) => item.value === value);
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : 0);
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, options, value]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || !options.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      setActiveIndex((prev) => (prev + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      setActiveIndex((prev) => (prev - 1 + options.length) % options.length);
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (open && activeIndex >= 0 && options[activeIndex]) {
        event.preventDefault();
        onChange(options[activeIndex].value);
        setOpen(false);
      }
    }
  };

  return (
    <div ref={rootRef} className={cn('custom-select', variant === 'guild' ? 'guild-picker' : 'field-select', open && 'is-open')}>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={id ? `${id}-listbox` : undefined}
        disabled={disabled}
        className="custom-select-trigger"
        onClick={() => !disabled && options.length > 0 && setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
      >
        {leadingIcon && <span className="guild-avatar">{leadingIcon}</span>}
        <span className="custom-select-copy">
          {label && <span className="custom-select-label">{label}</span>}
          <span className="custom-select-value">{selected ? selected.label : placeholder}</span>
        </span>
        <ChevronDown size={15} className={cn('custom-select-chevron', open && 'is-open')} aria-hidden="true" />
      </button>
      {open && options.length > 0 && (
        <div id={id ? `${id}-listbox` : undefined} role="listbox" aria-label={label || placeholder} className="custom-select-menu">
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isHighlighted = index === activeIndex;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={cn('custom-select-option', isSelected && 'is-selected', isHighlighted && 'is-highlighted')}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.icon && <span className="custom-select-option-icon">{option.icon}</span>}
                <span className="custom-select-option-text">
                  <strong>{option.label}</strong>
                  {option.sublabel && <small>{option.sublabel}</small>}
                </span>
                {isSelected && <Check size={15} className="custom-select-check" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

