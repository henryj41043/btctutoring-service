import {
  BRAND_LOGO_URL,
  BRAND_NAME,
  brandedEmail,
  escapeHtml,
  toHtmlLines,
} from './email-template';

describe('email-template', () => {
  describe('escapeHtml', () => {
    it('escapes the five HTML-significant characters', () => {
      expect(escapeHtml(`Tom & Jerry <b>"quoted"</b> it's`)).toBe(
        'Tom &amp; Jerry &lt;b&gt;&quot;quoted&quot;&lt;/b&gt; it&#39;s',
      );
    });

    it('leaves plain text untouched', () => {
      expect(escapeHtml('Worked on fractions.')).toBe('Worked on fractions.');
    });
  });

  describe('toHtmlLines', () => {
    it('escapes first, then converts LF and CRLF line breaks to <br>', () => {
      expect(toHtmlLines('a <b>\nb\r\nc')).toBe('a &lt;b&gt;<br>b<br>c');
    });
  });

  describe('brandedEmail', () => {
    const full = brandedEmail({
      title: 'Session notes',
      greeting: 'Hi Jane,',
      intro: "Here are the notes from Sam's session on June 1, 2026 with Tess:",
      body: 'Worked on fractions.\nHomework: p. 12 <odd>',
      outro: 'See you next week!',
    });

    it('returns UTF-8 Html and Text parts', () => {
      expect(full.Html.Charset).toBe('UTF-8');
      expect(full.Text.Charset).toBe('UTF-8');
    });

    it('brands the HTML with the logo, the company name and the title', () => {
      expect(full.Html.Data).toContain(`<img src="${BRAND_LOGO_URL}"`);
      expect(full.Html.Data).toContain(`alt="${BRAND_NAME}"`);
      expect(full.Html.Data).toContain(
        '<h1 style="margin:0 0 16px;font-size:20px;color:#062e3b;">Session notes</h1>',
      );
      expect(full.Html.Data).toContain('<title>Session notes</title>');
      expect(full.Html.Data).toContain('background:#118ab2'); // teal header band
      expect(full.Html.Data).toContain('border-top:3px solid #ff9000'); // orange footer rule
      expect(full.Html.Data).toContain(`— ${BRAND_NAME}</td>`);
    });

    it('renders greeting, intro, body and outro in order with escaping + line breaks', () => {
      const html = full.Html.Data;
      const greeting = html.indexOf('Hi Jane,');
      const intro = html.indexOf('Here are the notes from Sam&#39;s session');
      const body = html.indexOf(
        'Worked on fractions.<br>Homework: p. 12 &lt;odd&gt;',
      );
      const outro = html.indexOf('See you next week!');
      expect(greeting).toBeGreaterThan(-1);
      expect(intro).toBeGreaterThan(greeting);
      expect(body).toBeGreaterThan(intro);
      expect(outro).toBeGreaterThan(body);
      expect(html).not.toContain('<odd>');
    });

    it('builds the plain-text alternative from the same parts, unescaped, signed by the brand', () => {
      expect(full.Text.Data).toBe(
        [
          'Hi Jane,',
          "Here are the notes from Sam's session on June 1, 2026 with Tess:",
          'Worked on fractions.\nHomework: p. 12 <odd>',
          'See you next week!',
          `— ${BRAND_NAME}`,
        ].join('\n\n'),
      );
    });

    it('omits the optional parts when absent', () => {
      const minimal = brandedEmail({ title: 'T & C', body: 'Body only' });
      expect(minimal.Html.Data).toContain(
        '<h1 style="margin:0 0 16px;font-size:20px;color:#062e3b;">T &amp; C</h1>',
      );
      expect(minimal.Html.Data).toContain('Body only');
      // Exactly zero <p> paragraphs: no greeting / intro / outro.
      expect(minimal.Html.Data.match(/<p /g)).toBeNull();
      expect(minimal.Text.Data).toBe(`Body only\n\n— ${BRAND_NAME}`);
    });

    it('escapes the title in both the <title> and the heading', () => {
      const out = brandedEmail({ title: '<script>x</script>', body: 'b' });
      expect(out.Html.Data).not.toContain('<script>');
      expect(out.Html.Data).toContain('&lt;script&gt;x&lt;/script&gt;');
    });
  });
});
