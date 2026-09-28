import {
  ALLOWED_TYPES,
  canViewInline,
  cleanFileName,
  contentDisposition,
  extensionOf,
  MAX_BYTES,
  MAX_NAME_LENGTH,
  validateUpload,
} from './document-rules';

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('document rules', () => {
  it('allows 15 MB and exactly the five kinds of file', () => {
    expect(MAX_BYTES).toBe(15728640);
    expect(MAX_NAME_LENGTH).toBe(200);
    expect(ALLOWED_TYPES).toEqual({
      'application/pdf': ['pdf'],
      'image/jpeg': ['jpg', 'jpeg'],
      'image/png': ['png'],
      'application/msword': ['doc'],
      [DOCX]: ['docx'],
    });
  });

  describe('cleanFileName', () => {
    it('drops folders, control characters and extra spaces', () => {
      expect(cleanFileName('C:\\Users\\me\\My  Resume.pdf')).toBe(
        'My Resume.pdf',
      );
      expect(cleanFileName('../../etc/passwd.pdf')).toBe('passwd.pdf');
      expect(cleanFileName('  re\u0000su\u001fme\u007f.pdf \n')).toBe(
        'resume.pdf',
      );
    });

    it('copes with a missing name', () => {
      expect(cleanFileName(undefined as unknown as string)).toBe('');
      expect(cleanFileName('folder/')).toBe('');
    });

    it('keeps a name of exactly the limit', () => {
      const name = 'a'.repeat(196) + '.pdf';
      expect(cleanFileName(name)).toBe(name);
    });

    it('cuts a long name and keeps its extension', () => {
      const cleaned = cleanFileName('a'.repeat(300) + '.docx');
      expect(cleaned).toBe('a'.repeat(195) + '.docx');
      expect(cleaned).toHaveLength(200);
    });

    it('cuts a long name without an extension, and one that only starts with a dot', () => {
      expect(cleanFileName('b'.repeat(250))).toBe('b'.repeat(200));
      expect(cleanFileName('.' + 'c'.repeat(250))).toBe('.' + 'c'.repeat(199));
    });

    it('trims a space left at the cut', () => {
      expect(
        cleanFileName('a'.repeat(195) + ' ' + 'b'.repeat(50) + '.pdf'),
      ).toBe('a'.repeat(195) + '.pdf');
    });
  });

  describe('extensionOf', () => {
    it('reads the last extension, lowercased', () => {
      expect(extensionOf('Resume.Final.PDF')).toBe('pdf');
      expect(extensionOf('resume')).toBe('');
      expect(extensionOf('.hidden')).toBe('');
      expect(extensionOf('name.')).toBe('');
    });
  });

  describe('validateUpload', () => {
    const ok = {
      file_name: 'resume.pdf',
      content_type: 'application/pdf',
      size: 1,
    };

    it.each([
      ['resume.pdf', 'application/pdf'],
      ['photo.JPG', 'image/jpeg'],
      ['photo.jpeg', 'IMAGE/JPEG '],
      ['scan.png', 'image/png'],
      ['old.doc', 'application/msword'],
      ['new.docx', DOCX],
    ])('accepts %s as %s', (file_name, content_type) => {
      expect(validateUpload({ file_name, content_type, size: 10 })).toEqual({
        file_name,
        content_type: content_type.toLowerCase().trim(),
      });
    });

    it('accepts one byte and exactly 15 MB', () => {
      expect(validateUpload(ok).error).toBeUndefined();
      expect(validateUpload({ ...ok, size: MAX_BYTES }).error).toBeUndefined();
    });

    it('returns the cleaned name', () => {
      expect(
        validateUpload({ ...ok, file_name: 'a/b/resume.pdf' }).file_name,
      ).toBe('resume.pdf');
    });

    it.each([
      ['', 'The file needs a name with an extension.'],
      ['resume', 'The file needs a name with an extension.'],
    ])('refuses the name %p', (file_name, error) => {
      expect(validateUpload({ ...ok, file_name }).error).toBe(error);
    });

    it.each([
      ['archive.zip', 'application/zip'],
      ['page.html', 'text/html'],
      ['image.svg', 'image/svg+xml'],
      ['resume.pdf', 'image/png'],
      ['resume.exe', 'application/pdf'],
      ['resume.pdf', ''],
      ['resume.pdf', undefined as unknown as string],
      ['resume.pdf', 'constructor'],
    ])('refuses %s sent as %p', (file_name, content_type) => {
      expect(validateUpload({ file_name, content_type, size: 10 }).error).toBe(
        'Only PDF, Word (.doc, .docx), JPG and PNG files can be uploaded.',
      );
    });

    it.each([0, -1, 1.5, NaN, undefined as unknown as number])(
      'refuses the size %p as empty',
      (size) => {
        expect(validateUpload({ ...ok, size }).error).toBe(
          'The file is empty.',
        );
      },
    );

    it('refuses a file over 15 MB', () => {
      expect(validateUpload({ ...ok, size: MAX_BYTES + 1 }).error).toBe(
        'The file is larger than 15 MB.',
      );
    });
  });

  describe('canViewInline', () => {
    it('is true for PDFs and images only', () => {
      expect(canViewInline('application/pdf')).toBe(true);
      expect(canViewInline('image/jpeg')).toBe(true);
      expect(canViewInline('image/png')).toBe(true);
      expect(canViewInline('application/msword')).toBe(false);
      expect(canViewInline(DOCX)).toBe(false);
      expect(canViewInline(undefined)).toBe(false);
    });
  });

  describe('contentDisposition', () => {
    it('shows a PDF inline when viewing and attaches it when downloading', () => {
      expect(contentDisposition('resume.pdf', 'view', 'application/pdf')).toBe(
        'inline; filename="resume.pdf"; filename*=UTF-8\'\'resume.pdf',
      );
      expect(
        contentDisposition('resume.pdf', 'download', 'application/pdf'),
      ).toBe(
        'attachment; filename="resume.pdf"; filename*=UTF-8\'\'resume.pdf',
      );
    });

    it('always attaches a Word file', () => {
      expect(
        contentDisposition('cv.doc', 'view', 'application/msword'),
      ).toMatch(/^attachment; /);
      expect(contentDisposition('cv.doc', 'view', undefined)).toMatch(
        /^attachment; /,
      );
    });

    it('keeps accents, quotes and brackets in the encoded name only', () => {
      expect(
        contentDisposition(
          'Résumé "final" (1)*\'s\\.pdf',
          'download',
          'application/pdf',
        ),
      ).toBe(
        'attachment; filename="R_sum_ _final_ (1)*\'s_.pdf"; ' +
          "filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22%20%281%29%2A%27s%5C.pdf",
      );
    });
  });
});
