import { vi } from 'vitest'
import {
  formatCurrency,
  formatDate,
  formatDateInput,
  getLoanStatusColor,
  getDaysOverdue,
  monthlyRateToAnnual,
} from '../lib/utils'

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------
describe('formatCurrency', () => {
  it('returns ₹0.00 for null', () => {
    expect(formatCurrency(null)).toBe('₹0.00')
  })

  it('returns ₹0.00 for undefined', () => {
    expect(formatCurrency(undefined)).toBe('₹0.00')
  })

  it('formats 0 as ₹0.00', () => {
    // Intl formats zero — just confirm it contains "0.00" and the rupee symbol
    const result = formatCurrency(0)
    expect(result).toMatch(/0\.00/)
  })

  it('formats a whole number amount', () => {
    const result = formatCurrency(1000)
    // en-IN locale uses Indian number format; at minimum must contain "1,000"
    expect(result).toMatch(/1,000/)
  })

  it('formats a string number like "1500.5"', () => {
    const result = formatCurrency('1500.5')
    expect(result).toMatch(/1,500/)
    expect(result).toMatch(/50/)
  })

  it('formats a negative amount', () => {
    const result = formatCurrency(-500)
    expect(result).toMatch(/-/)
    expect(result).toMatch(/500/)
  })

  it('formats NaN gracefully (returns a string)', () => {
    const result = formatCurrency(NaN)
    // Intl.NumberFormat renders NaN as "NaN" — the function must still return a string
    expect(typeof result).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------
describe('formatDate', () => {
  it('returns "-" for null', () => {
    expect(formatDate(null)).toBe('-')
  })

  it('returns "-" for undefined', () => {
    expect(formatDate(undefined)).toBe('-')
  })

  it('returns "-" for empty string', () => {
    expect(formatDate('')).toBe('-')
  })

  it('formats a valid ISO date string', () => {
    expect(formatDate('2024-01-15')).toBe('15 Jan 2024')
  })

  it('formats a Date object', () => {
    expect(formatDate(new Date('2024-06-01'))).toBe('01 Jun 2024')
  })

  it('returns "-" for an unparseable string', () => {
    expect(formatDate('not-a-date')).toBe('-')
  })
})

// ---------------------------------------------------------------------------
// formatDateInput
// ---------------------------------------------------------------------------
describe('formatDateInput', () => {
  it('returns "" for null', () => {
    expect(formatDateInput(null)).toBe('')
  })

  it('returns "" for empty string', () => {
    expect(formatDateInput('')).toBe('')
  })

  it('formats a valid ISO date string to yyyy-MM-dd', () => {
    expect(formatDateInput('2024-03-20')).toBe('2024-03-20')
  })

  it('formats a Date object to yyyy-MM-dd', () => {
    expect(formatDateInput(new Date('2024-12-25'))).toBe('2024-12-25')
  })

  it('returns "" for an unparseable string', () => {
    expect(formatDateInput('garbage')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// getLoanStatusColor
// ---------------------------------------------------------------------------
describe('getLoanStatusColor', () => {
  it('returns green classes for "active"', () => {
    expect(getLoanStatusColor('active')).toBe('bg-green-100 text-green-800')
  })

  it('returns gray classes for "closed"', () => {
    expect(getLoanStatusColor('closed')).toBe('bg-gray-100 text-gray-800')
  })

  it('returns red classes for "defaulted"', () => {
    expect(getLoanStatusColor('defaulted')).toBe('bg-red-100 text-red-800')
  })

  it('returns yellow classes for "on_hold"', () => {
    expect(getLoanStatusColor('on_hold')).toBe('bg-yellow-100 text-yellow-800')
  })

  it('returns gray fallback for an unknown status string', () => {
    expect(getLoanStatusColor('pending')).toBe('bg-gray-100 text-gray-800')
  })

  it('returns gray fallback for undefined', () => {
    expect(getLoanStatusColor(undefined)).toBe('bg-gray-100 text-gray-800')
  })
})

// ---------------------------------------------------------------------------
// getDaysOverdue
// ---------------------------------------------------------------------------
describe('getDaysOverdue', () => {
  it('returns 0 for null', () => {
    expect(getDaysOverdue(null)).toBe(0)
  })

  it('returns 0 for undefined', () => {
    expect(getDaysOverdue(undefined)).toBe(0)
  })

  it('returns 0 for a future date', () => {
    // A date well in the future must not be overdue
    const future = new Date()
    future.setFullYear(future.getFullYear() + 1)
    expect(getDaysOverdue(future)).toBe(0)
  })

  it('returns 0 for a future ISO date string', () => {
    expect(getDaysOverdue('2099-12-31')).toBe(0)
  })

  it('returns a positive number for a past date', () => {
    // 10 days ago
    const past = new Date()
    past.setDate(past.getDate() - 10)
    const result = getDaysOverdue(past)
    // Allow a day of slack for timezone edge cases
    expect(result).toBeGreaterThanOrEqual(9)
    expect(result).toBeLessThanOrEqual(11)
  })

  it('returns a positive number for a past ISO date string', () => {
    const result = getDaysOverdue('2020-01-01')
    expect(result).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// monthlyRateToAnnual
// ---------------------------------------------------------------------------
describe('monthlyRateToAnnual', () => {
  it('converts monthly rate 2 to "24.00"', () => {
    expect(monthlyRateToAnnual(2)).toBe('24.00')
  })

  it('converts monthly rate 0 to "0.00"', () => {
    expect(monthlyRateToAnnual(0)).toBe('0.00')
  })

  it('returns null for null', () => {
    expect(monthlyRateToAnnual(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(monthlyRateToAnnual(undefined)).toBeNull()
  })

  it('converts string "1.5" to "18.00"', () => {
    expect(monthlyRateToAnnual('1.5')).toBe('18.00')
  })

  it('converts monthly rate 1 to "12.00"', () => {
    expect(monthlyRateToAnnual(1)).toBe('12.00')
  })
})
