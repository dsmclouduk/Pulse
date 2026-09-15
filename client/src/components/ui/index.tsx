import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/* ── Card ─────────────────────────────────────────────────────── */

interface CardProps {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}

export function Card({ children, className = '', padded = true }: Readonly<CardProps>) {
  return (
    <section
      className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] ${padded ? 'p-4' : ''} ${className}`}
    >
      {children}
    </section>
  );
}

interface CardHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function CardHeader({ title, eyebrow, description, actions }: Readonly<CardHeaderProps>) {
  return (
    <div className="mb-3 flex items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">{eyebrow}</p>}
        <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{description}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ── Button ───────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-light disabled:hover:bg-accent',
  secondary:
    'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-hover)]',
  ghost: 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]',
  danger: 'bg-sev-critical text-white hover:brightness-110',
  success: 'bg-sev-ok text-white hover:brightness-110'
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-sm'
};

export function Button({ variant = 'secondary', size = 'md', loading = false, className = '', children, disabled, ...rest }: Readonly<ButtonProps>) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {loading && <Spinner size={12} />}
      {children}
    </button>
  );
}

/* ── Badge ────────────────────────────────────────────────────── */

type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warning' | 'error' | 'critical' | 'info';

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}

const badgeToneClasses: Record<BadgeTone, string> = {
  neutral: 'border-[var(--color-border)] bg-[var(--color-header)] text-[var(--color-text-secondary)]',
  accent: 'border-accent/30 bg-accent/10 text-accent',
  ok: 'border-sev-ok/30 bg-sev-ok/10 text-sev-ok',
  warning: 'border-sev-warning/40 bg-sev-warning/15 text-yellow-700 dark:text-sev-warning',
  error: 'border-sev-error/30 bg-sev-error/10 text-sev-error',
  critical: 'border-sev-critical/30 bg-sev-critical/10 text-sev-critical',
  info: 'border-sev-info/30 bg-sev-info/10 text-sev-info'
};

export function Badge({ tone = 'neutral', children, className = '', title }: Readonly<BadgeProps>) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold leading-none ${badgeToneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ── Spinner ──────────────────────────────────────────────────── */

export function Spinner({ size = 14, className = '' }: Readonly<{ size?: number; className?: string }>) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" className="opacity-20" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
    </svg>
  );
}

/* ── Form fields ──────────────────────────────────────────────── */

const inputBase =
  'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, children, className = '' }: Readonly<FieldProps>) {
  return (
    <label className={`grid gap-1 text-xs font-medium text-[var(--color-text-secondary)] ${className}`}>
      <span>{label}</span>
      {children}
      {hint && <span className="text-[11px] font-normal text-[var(--color-text-tertiary)]">{hint}</span>}
    </label>
  );
}

export function Input({ className = '', ...rest }: Readonly<InputHTMLAttributes<HTMLInputElement>>) {
  return <input {...rest} className={`${inputBase} h-8 ${className}`} />;
}

export function Select({ className = '', children, ...rest }: Readonly<SelectHTMLAttributes<HTMLSelectElement>>) {
  return (
    <select {...rest} className={`${inputBase} h-8 ${className}`}>
      {children}
    </select>
  );
}

export function Textarea({ className = '', ...rest }: Readonly<TextareaHTMLAttributes<HTMLTextAreaElement>>) {
  return <textarea {...rest} className={`${inputBase} py-1.5 ${className}`} />;
}

/* ── Empty / notice states ────────────────────────────────────── */

interface NoticeProps {
  tone?: 'neutral' | 'warning' | 'error' | 'info';
  children: ReactNode;
  className?: string;
}

const noticeToneClasses: Record<NonNullable<NoticeProps['tone']>, string> = {
  neutral: 'border-[var(--color-border)] bg-[var(--color-header)] text-[var(--color-text-secondary)]',
  warning: 'border-sev-warning/30 bg-sev-warning/10 text-yellow-800 dark:text-sev-warning',
  error: 'border-sev-critical/30 bg-sev-critical/10 text-sev-critical',
  info: 'border-accent/30 bg-accent/10 text-accent'
};

export function Notice({ tone = 'neutral', children, className = '' }: Readonly<NoticeProps>) {
  return <div className={`rounded-md border px-3 py-2 text-xs ${noticeToneClasses[tone]} ${className}`}>{children}</div>;
}

export function EmptyState({ children, className = '' }: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <div className={`flex items-center justify-center rounded-md border border-dashed border-[var(--color-border)] px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)] ${className}`}>
      {children}
    </div>
  );
}

/* ── Stat tile ────────────────────────────────────────────────── */

interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: BadgeTone;
}

export function StatTile({ label, value, hint, tone = 'neutral' }: Readonly<StatTileProps>) {
  const accent = tone === 'neutral' ? 'text-[var(--color-text)]' : badgeToneClasses[tone].split(' ').find((cls) => cls.startsWith('text-')) ?? '';

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">{label}</p>
      <p className={`mt-0.5 font-mono text-sm font-semibold ${accent}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">{hint}</p>}
    </div>
  );
}
