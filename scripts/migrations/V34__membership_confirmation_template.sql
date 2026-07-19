-- Replace the new-member confirmation with a richer UTILITY template that also
-- includes the library portal link. The old library_admin_new_member template
-- carried the same membership-confirmation body but no portal link; the code now
-- points at library_membership_confirmation ({{6}} = portal URL). Idempotent.
INSERT INTO whatsapp_templates (template_name, template_language, template_status, template_category, template_content, footer_text, variables, org_id) VALUES
('library_membership_confirmation', 'en', 'approved', 'UTILITY',
'👤 *Library Membership Confirmation*

Dear *{{1}}*,

Your library membership registration has been completed successfully.

*Membership Details:*

• Member ID: *{{2}}*
• Plan: *{{3}}*
• Seat Number: *{{4}}*
• Registered Mobile Number: *{{5}}*

*Library Portal:*

🔗 Portal: {{6}}

You can use the library portal to view and manage your membership information.

📚 *BR Ambedkar Library, Nadipar*
*Unit of Udayan Public School, Japla*',
'This is an automated message. Please do not reply.',
'[{"name":"{{1}}","type":"text","example":"Rakesh"},{"name":"{{2}}","type":"text","example":"BRL001"},{"name":"{{3}}","type":"text","example":"Morning 07:00 AM - 12:00 PM"},{"name":"{{4}}","type":"text","example":"08"},{"name":"{{5}}","type":"text","example":"1234567890"},{"name":"{{6}}","type":"text","example":"https://www.library.udayanpublicschool.co.in/"}]'::jsonb,
'library')
ON CONFLICT (template_name, template_language, org_id) DO UPDATE SET
  template_status = EXCLUDED.template_status,
  template_category = EXCLUDED.template_category,
  template_content = EXCLUDED.template_content,
  footer_text = EXCLUDED.footer_text,
  variables = EXCLUDED.variables,
  updated_at = NOW();

-- Portal link used in WhatsApp messages (and anywhere else that needs it).
INSERT INTO library_config (config_key, config_value)
VALUES ('library_portal_url', 'https://www.library.udayanpublicschool.co.in/')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;
