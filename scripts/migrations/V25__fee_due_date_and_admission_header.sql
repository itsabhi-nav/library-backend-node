-- Fee template: dynamic due date {{5}}; admission template: image header for Meta

UPDATE whatsapp_templates SET
  template_content = '💰 *Fee Invoice Generated*

Dear {{1}},

Your library fee for *{{2}}* has been generated.

📋 Amount: ₹{{3}}
📅 Due Date: {{5}}
💳 Amount Pending: ₹{{4}}

Please pay at the library reception before the due date.

📚 *BR Ambedkar Library, Nadipar*
*Unit of Udayan Public School, Japla*',
  variables = '[{"name":"{{1}}","type":"text","example":"Rahul Sharma"},{"name":"{{2}}","type":"text","example":"June 2026"},{"name":"{{3}}","type":"text","example":"1000"},{"name":"{{4}}","type":"text","example":"1000"},{"name":"{{5}}","type":"text","example":"24 May 2026"}]'::jsonb,
  updated_at = NOW()
WHERE template_name = 'library_fee_generated' AND template_language = 'en' AND org_id = 'library';

UPDATE whatsapp_templates SET
  template_status = 'approved',
  template_category = 'MARKETING',
  header_type = 'IMAGE',
  header_content = 'https://res.cloudinary.com/dcahaaigp/image/upload/v1781909500/school_tfd0v6.png',
  template_content = '📚 *Welcome to BR Ambedkar Library!*

Dear {{1}},

We are delighted to welcome you to *BR Ambedkar Library*.

Your membership has been successfully registered. We are committed to providing a peaceful, disciplined, and resourceful environment to support your learning and academic growth.

Thank you for choosing *BR Ambedkar Library*. We wish you a productive and successful learning journey ahead.

📚 *BR Ambedkar Library, Nadipar*
*Unit of Udayan Public School, Japla*',
  footer_text = 'This is an automated message. Please do not reply.',
  variables = '[{"name":"{{1}}","type":"text","example":"Rahul Sharma"}]'::jsonb,
  updated_at = NOW()
WHERE template_name = 'library_admission' AND template_language = 'en' AND org_id = 'library';

-- Insert admission template if missing (Neon may only have node migrations)
INSERT INTO whatsapp_templates (
  template_name, template_language, template_status, template_category,
  template_content, header_type, header_content, footer_text, variables, org_id
) VALUES (
  'library_admission', 'en', 'approved', 'MARKETING',
  '📚 *Welcome to BR Ambedkar Library!*

Dear {{1}},

We are delighted to welcome you to *BR Ambedkar Library*.

Your membership has been successfully registered. We are committed to providing a peaceful, disciplined, and resourceful environment to support your learning and academic growth.

Thank you for choosing *BR Ambedkar Library*. We wish you a productive and successful learning journey ahead.

📚 *BR Ambedkar Library, Nadipar*
*Unit of Udayan Public School, Japla*',
  'IMAGE',
  'https://res.cloudinary.com/dcahaaigp/image/upload/v1781909500/school_tfd0v6.png',
  'This is an automated message. Please do not reply.',
  '[{"name":"{{1}}","type":"text","example":"Rahul Sharma"}]'::jsonb,
  'library'
)
ON CONFLICT (template_name, template_language, org_id) DO NOTHING;
