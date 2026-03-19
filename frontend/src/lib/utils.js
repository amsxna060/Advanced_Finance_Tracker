import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO } from "date-fns";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount) {
  if (amount === null || amount === undefined) return "₹0.00";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(num);
}

export function formatDate(date) {
  if (!date) return "-";
  try {
    const dateObj = typeof date === "string" ? parseISO(date) : date;
    return format(dateObj, "dd MMM yyyy");
  } catch (e) {
    return "-";
  }
}

export function formatDateInput(date) {
  if (!date) return "";
  try {
    const dateObj = typeof date === "string" ? parseISO(date) : date;
    return format(dateObj, "yyyy-MM-dd");
  } catch (e) {
    return "";
  }
}

export function getLoanStatusColor(status) {
  const colors = {
    active: "bg-green-100 text-green-800",
    closed: "bg-gray-100 text-gray-800",
    defaulted: "bg-red-100 text-red-800",
    on_hold: "bg-yellow-100 text-yellow-800",
  };
  return colors[status] || "bg-gray-100 text-gray-800";
}

export function getDaysOverdue(dueDate) {
  if (!dueDate) return 0;
  const due = typeof dueDate === "string" ? parseISO(dueDate) : dueDate;
  const today = new Date();
  const diff = Math.floor((today - due) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

export function monthlyRateToAnnual(monthlyRate) {
  if (!monthlyRate && monthlyRate !== 0) return null;
  return (parseFloat(monthlyRate) * 12).toFixed(2);
}
