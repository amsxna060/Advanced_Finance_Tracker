"""Outbound email behind a tiny backend interface.

Backends (settings.EMAIL_BACKEND):
  console — log the message instead of sending (development, tests, CI)
  smtp    — real delivery via SMTP_* settings (Gmail app password today,
            swap host/creds for SES in Phase 3 without touching callers)

Callers use the module-level `send_email(...)`; nothing outside this file
knows which backend is active. Sending is best-effort by design — a mail
failure must never fail the request that triggered it (signup still
succeeds; the user can hit /resend-verification).
"""

import logging
import smtplib
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger(__name__)


def send_email(to: str, subject: str, body: str) -> bool:
    """Send (or log) an email. Returns True if handed off successfully."""
    if settings.EMAIL_BACKEND == "smtp":
        return _send_smtp(to, subject, body)
    # console backend
    logger.info("EMAIL (console backend) to=%s subject=%r\n%s", to, subject, body)
    return True


def _send_smtp(to: str, subject: str, body: str) -> bool:
    msg = EmailMessage()
    msg["From"] = settings.EMAIL_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
            smtp.starttls()
            if settings.SMTP_USER:
                smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            smtp.send_message(msg)
        return True
    except Exception:
        logger.exception("email_service: SMTP send to %s failed", to)
        return False


def send_verification_email(to: str, token: str) -> bool:
    link = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    return send_email(
        to,
        "Verify your FinancerBuddy email",
        "Welcome to FinancerBuddy!\n\n"
        f"Confirm your email address by opening this link:\n\n  {link}\n\n"
        "The link is valid for 48 hours. If you didn't create this account, "
        "you can ignore this message.",
    )
