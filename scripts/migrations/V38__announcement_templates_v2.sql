-- Sync announcement templates with the versions submitted/approved in Meta.
-- Both announcement templates now use TWO variables: {{1}} = recipient name,
-- {{2}} = the message. Adds a festival greeting template ({{2}} = occasion).
-- Also removes the earlier single-variable draft. Idempotent.

DELETE FROM whatsapp_templates
 WHERE template_name = 'library_announcement' AND org_id = 'library';

-- 1) Text-only announcement (no header)
INSERT INTO whatsapp_templates (template_name, template_language, template_status, template_category, template_content, footer_text, variables, org_id) VALUES
('library_announcement_1', 'en', 'approved', 'UTILITY',
'📢 *Library Announcement*

Dear *{{1}}*,

We would like to inform you:

{{2}}

📚 *BR Ambedkar Library, Nadipar*
*Unit of Udayan Public School, Japla*',
'This is an automated message. Please do not reply.',
'[{"name":"{{1}}","type":"text","example":"Rakesh"},{"name":"{{2}}","type":"text","example":"The library will remain closed tomorrow due to a public holiday."}]'::jsonb,
'library')
ON CONFLICT (template_name, template_language, org_id) DO UPDATE SET
  template_status = EXCLUDED.template_status,
  template_category = EXCLUDED.template_category,
  template_content = EXCLUDED.template_content,
  header_type = NULL,
  header_content = NULL,
  footer_text = EXCLUDED.footer_text,
  variables = EXCLUDED.variables,
  updated_at = NOW();

-- 2) Image-header announcement (image supplied per-send via Meta media upload)
INSERT INTO whatsapp_templates (template_name, template_language, template_status, template_category, template_content, header_type, header_content, footer_text, variables, org_id) VALUES
('library_announcement_image', 'en', 'approved', 'UTILITY',
'📢 *Library Announcement*

Dear *{{1}}*,

We would like to inform you:

{{2}}

📚 *BR Ambedkar Library, Nadipar*
*Unit of Udayan Public School, Japla*',
'IMAGE',
NULL,
'This is an automated message. Please do not reply.',
'[{"name":"{{1}}","type":"text","example":"Rakesh"},{"name":"{{2}}","type":"text","example":"The library will remain closed tomorrow due to a public holiday."}]'::jsonb,
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

-- 3) Festival greeting (image header; {{2}} = occasion)
INSERT INTO whatsapp_templates (template_name, template_language, template_status, template_category, template_content, header_type, header_content, footer_text, variables, org_id) VALUES
('festival_greetings', 'en', 'approved', 'UTILITY',
'Dear *{{1}}*,

Greetings and best wishes from *BR Ambedkar Library, Nadipar* .

On the occasion of *{{2}}*, we extend our sincere wishes to you and your family.

May this occasion bring good health, happiness, and continued success.

With regards,
📚 *BR Ambedkar Library, Nadipar*
*Unit of Udayan Public School, Japla*',
'IMAGE',
NULL,
'This is an automated message. Please do not reply.',
'[{"name":"{{1}}","type":"text","example":"Rakesh"},{"name":"{{2}}","type":"text","example":"New Year"}]'::jsonb,
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
