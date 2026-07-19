-- Admin broadcast announcements. Two templates: text-only and image-header.
-- The admin's free text goes into body variable {{1}}; the image template's
-- header image is supplied per-send via Meta media upload (header_content NULL).
-- Idempotent.

-- 1) Text-only announcement
INSERT INTO whatsapp_templates (template_name, template_language, template_status, template_category, template_content, footer_text, variables, org_id) VALUES
('library_announcement', 'en', 'approved', 'UTILITY',
'📢 *Announcement | घोषणा*

{{1}}

📚 *BR Ambedkar Library, Nadipar*
*Unit of Udayan Public School, Japla*',
'This is an automated message. Please do not reply.',
'[{"name":"{{1}}","type":"text","example":"Library will remain closed tomorrow due to a public holiday. | कल सार्वजनिक अवकाश के कारण लाइब्रेरी बंद रहेगी।"}]'::jsonb,
'library')
ON CONFLICT (template_name, template_language, org_id) DO UPDATE SET
  template_status = EXCLUDED.template_status,
  template_category = EXCLUDED.template_category,
  template_content = EXCLUDED.template_content,
  footer_text = EXCLUDED.footer_text,
  variables = EXCLUDED.variables,
  updated_at = NOW();

-- 2) Image-header announcement (image supplied per-send via Meta media upload)
INSERT INTO whatsapp_templates (template_name, template_language, template_status, template_category, template_content, header_type, header_content, footer_text, variables, org_id) VALUES
('library_announcement_image', 'en', 'approved', 'UTILITY',
'📢 *Announcement | घोषणा*

{{1}}

📚 *BR Ambedkar Library, Nadipar*
*Unit of Udayan Public School, Japla*',
'IMAGE',
NULL,
'This is an automated message. Please do not reply.',
'[{"name":"{{1}}","type":"text","example":"Library will remain closed tomorrow due to a public holiday. | कल सार्वजनिक अवकाश के कारण लाइब्रेरी बंद रहेगी।"}]'::jsonb,
'library')
ON CONFLICT (template_name, template_language, org_id) DO UPDATE SET
  template_status = EXCLUDED.template_status,
  template_category = EXCLUDED.template_category,
  template_content = EXCLUDED.template_content,
  header_type = EXCLUDED.header_type,
  header_content = EXCLUDED.header_content,
  footer_text = EXCLUDED.footer_text,
  variables = EXCLUDED.variables,
  updated_at = NOW();
