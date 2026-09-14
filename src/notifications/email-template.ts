/**
 * Branded outbound email — a reusable HTML + plain-text pair for SES.
 *
 * Pure module (no Nest deps) so any sender can adopt it: the session-notes
 * email uses it today; reminders / pending-session / package-change notices
 * still send plain text and can migrate later. Layout is table-based with
 * inline styles (the only thing mail clients render reliably); the logo is
 * the app's own asset served from CloudFront.
 */

export const BRAND_NAME = 'Beyond the Chalkboard Tutoring';
export const BRAND_LOGO_URL =
  'https://btchub.bitshiftstudio.io/assets/BTC_Transparent_BG.png';

/** Brand palette (mirrors the app's styles.scss tokens). */
const TEAL = '#118ab2';
const INK = '#062e3b';
const SKY_TINT = '#e3f3f9';
const ORANGE = '#ff9000';
const PAPER = '#f6fafd';
const MUTED = '#5f6b72';

export interface BrandedEmailInput {
  /** Heading shown at the top of the card. */
  title: string;
  /** Greeting line, e.g. "Hi Jane,". */
  greeting?: string;
  /** Lead paragraph above the body. */
  intro?: string;
  /** Main content — rendered in a highlighted box; line breaks preserved. */
  body: string;
  /** Optional closing paragraph below the body. */
  outro?: string;
}

/** Shape of SES `Message.Body` with both alternatives. */
export interface BrandedEmailBody {
  Html: { Data: string; Charset: 'UTF-8' };
  Text: { Data: string; Charset: 'UTF-8' };
}

/** Escapes the five HTML-significant characters. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes text and turns newlines into `<br>` so typed paragraphs survive. */
export function toHtmlLines(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

/** Builds the branded HTML + plain-text pair for one email. */
export function brandedEmail(input: BrandedEmailInput): BrandedEmailBody {
  const paragraph = (text: string | undefined, style: string): string =>
    text ? `<p style="${style}">${toHtmlLines(text)}</p>` : '';
  const textStyle = `margin:0 0 14px;font-size:15px;line-height:1.5;color:${INK};`;

  const html = [
    `<!DOCTYPE html>`,
    `<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width">`,
    `<title>${escapeHtml(input.title)}</title></head>`,
    `<body style="margin:0;padding:0;background:${PAPER};font-family:Helvetica,Arial,sans-serif;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">`,
    `<tr><td align="center" style="padding:24px 12px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;">`,
    // Header: teal band with the logo + brand name.
    `<tr><td style="background:${TEAL};padding:20px 24px;" align="left">`,
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>`,
    `<td style="padding-right:14px;"><img src="${BRAND_LOGO_URL}" width="56" height="56" alt="${BRAND_NAME}" style="display:block;border:0;"></td>`,
    `<td style="color:#ffffff;font-size:18px;font-weight:bold;">${BRAND_NAME}</td>`,
    `</tr></table></td></tr>`,
    // Card body.
    `<tr><td style="padding:24px;">`,
    `<h1 style="margin:0 0 16px;font-size:20px;color:${INK};">${escapeHtml(input.title)}</h1>`,
    paragraph(input.greeting, textStyle),
    paragraph(input.intro, textStyle),
    `<div style="background:${SKY_TINT};border-left:4px solid ${ORANGE};border-radius:4px;padding:14px 16px;margin:0 0 14px;font-size:15px;line-height:1.55;color:${INK};white-space:normal;">${toHtmlLines(input.body)}</div>`,
    paragraph(input.outro, textStyle),
    `</td></tr>`,
    // Footer: orange rule + brand name.
    `<tr><td style="padding:14px 24px 18px;border-top:3px solid ${ORANGE};font-size:12px;color:${MUTED};">`,
    `— ${BRAND_NAME}`,
    `</td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join('');

  const text = [input.greeting, input.intro, input.body, input.outro]
    .filter((part): part is string => !!part)
    .concat(`— ${BRAND_NAME}`)
    .join('\n\n');

  return {
    Html: { Data: html, Charset: 'UTF-8' },
    Text: { Data: text, Charset: 'UTF-8' },
  };
}
