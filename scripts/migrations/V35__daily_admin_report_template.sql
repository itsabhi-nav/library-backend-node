-- Daily admin report template. UTILITY, admin-only. The full member-wise detail
-- ships as a PDF in a DOCUMENT header (uploaded to Meta media at send time); the
-- body carries a short summary. Idempotent.
INSERT INTO whatsapp_templates (
  template_name, template_language, template_status, template_category,
  template_content, header_type, header_content, footer_text, variables, org_id
) VALUES (
  'library_daily_admin_report', 'en', 'approved', 'UTILITY',
  'Daily Report — {{1}}

Attendance today: {{2}}
Fees collected today: {{3}}
Pending dues: {{4}}
Next auto fee-generation: {{5}}

Full member-wise details (punch-in/out times, paid & pending, next billing date) are in the attached PDF.',
  'DOCUMENT',
  NULL,
  'Automated daily report',
  '[{"name":"{{1}}","type":"text","example":"Sat, 19 Jul 2026"},{"name":"{{2}}","type":"text","example":"37 member(s)"},{"name":"{{3}}","type":"text","example":"₹4,500 from 9 payment(s)"},{"name":"{{4}}","type":"text","example":"6 member(s) • ₹3,000"},{"name":"{{5}}","type":"text","example":"20 Jul 2026 — 3, 22 Jul 2026 — 2"}]'::jsonb,
  'library'
)
ON CONFLICT (template_name, template_language, org_id) DO UPDATE SET
  template_status = EXCLUDED.template_status,
  template_category = EXCLUDED.template_category,
  template_content = EXCLUDED.template_content,
  header_type = EXCLUDED.header_type,
  footer_text = EXCLUDED.footer_text,
  variables = EXCLUDED.variables,
  updated_at = NOW();
