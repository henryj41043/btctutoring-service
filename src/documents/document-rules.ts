/**
 * What may be uploaded to a contact, and how it is handed back. Pure.
 */

export const MAX_BYTES = 15 * 1024 * 1024;
export const MAX_NAME_LENGTH = 200;

/** Content type → the extensions a file of that type may carry. */
export const ALLOWED_TYPES: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    'docx',
  ],
};

/** Types a browser shows by itself; anything else is always a download. */
const INLINE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export type DocumentUrlMode = 'view' | 'download';

/**
 * The file's own name without any folder part or control characters, cut to
 * MAX_NAME_LENGTH with the extension kept.
 */
export function cleanFileName(name: string): string {
  const base = (name ?? '')
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (base.length <= MAX_NAME_LENGTH) {
    return base;
  }
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot) : '';
  return base.slice(0, MAX_NAME_LENGTH - extension.length).trim() + extension;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export interface UploadCheck {
  /** Set when the upload is refused; the message is shown to the admin. */
  error?: string;
  file_name: string;
  content_type: string;
}

/** Checks an upload request; the cleaned name and type come back with it. */
export function validateUpload(input: {
  file_name: string;
  content_type: string;
  size: number;
}): UploadCheck {
  const file_name = cleanFileName(input.file_name);
  const content_type = (input.content_type ?? '').toLowerCase().trim();
  const result = { file_name, content_type };
  if (!file_name || !extensionOf(file_name)) {
    return { ...result, error: 'The file needs a name with an extension.' };
  }
  // Own keys only: 'constructor' and friends are not content types.
  const extensions = Object.prototype.hasOwnProperty.call(
    ALLOWED_TYPES,
    content_type,
  )
    ? ALLOWED_TYPES[content_type]
    : undefined;
  if (!extensions || !extensions.includes(extensionOf(file_name))) {
    return {
      ...result,
      error: 'Only PDF, Word (.doc, .docx), JPG and PNG files can be uploaded.',
    };
  }
  if (!Number.isInteger(input.size) || input.size < 1) {
    return { ...result, error: 'The file is empty.' };
  }
  if (input.size > MAX_BYTES) {
    return { ...result, error: 'The file is larger than 15 MB.' };
  }
  return result;
}

export function canViewInline(contentType: string | undefined): boolean {
  return INLINE_TYPES.includes(contentType ?? '');
}

/**
 * Content-Disposition for a download link: a plain-ASCII fallback name plus
 * the real name encoded per RFC 5987, so accents and quotes survive.
 */
export function contentDisposition(
  fileName: string,
  mode: DocumentUrlMode,
  contentType: string | undefined,
): string {
  const kind =
    mode === 'view' && canViewInline(contentType) ? 'inline' : 'attachment';
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
