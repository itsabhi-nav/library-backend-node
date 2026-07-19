-- Daily "we missed you today" reminder to enrolled members who did not visit.
-- Sent once, ~2 min after the last shift ends. Text-only, one variable (name).
-- Idempotent.
INSERT INTO whatsapp_templates (template_name, template_language, template_status, template_category, template_content, footer_text, variables, org_id) VALUES
('library_absent_reminder', 'en', 'approved', 'UTILITY',
'Hi *{{1}}*, we missed you at the library today.

Every day you show up is a step closer to your goal. Don''t break your momentum — come back tomorrow and keep your preparation on track. Your seat is ready for you! 📚

📚 *BR Ambedkar Library, Nadipar*
*Unit of Udayan Public School, Japla*',
'This is an automated message. Please do not reply.',
'[{"name":"{{1}}","type":"text","example":"Rahul Sharma"}]'::jsonb,
'library')
ON CONFLICT (template_name, template_language, org_id) DO UPDATE SET
  template_status = EXCLUDED.template_status,
  template_category = EXCLUDED.template_category,
  template_content = EXCLUDED.template_content,
  footer_text = EXCLUDED.footer_text,
  variables = EXCLUDED.variables,
  updated_at = NOW();
