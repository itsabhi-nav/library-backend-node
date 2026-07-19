-- Daily "we missed you today" reminder to enrolled members who did not visit.
-- Sent once, ~2 min after the last shift ends. Text-only, one variable (name).
-- Idempotent.
INSERT INTO whatsapp_templates (template_name, template_language, template_status, template_category, template_content, footer_text, variables, org_id) VALUES
('library_absent_reminder', 'en', 'approved', 'UTILITY',
'📢 *Absence Notification | अनुपस्थिति सूचना*

Dear *{{1}}*,

We noticed that you were unable to visit the library today. Consistency plays an important role in achieving your study goals, and every day of focused effort counts.

We look forward to seeing you back at your reserved seat tomorrow. Keep learning and stay consistent! 📚

प्रिय *{{2}}*,

आज आप लाइब्रेरी नहीं आ पाए। पढ़ाई में नियमित रहना आपके लक्ष्य को हासिल करने के लिए बहुत ज़रूरी है। आपकी हर दिन की मेहनत आपको आपके लक्ष्य के और करीब ले जाती है।

उम्मीद है कल आप फिर से लाइब्रेरी आएंगे और अपनी पढ़ाई जारी रखेंगे। नियमित रूप से पढ़ते रहें और अपने लक्ष्य की ओर आगे बढ़ते रहें! 📚

📚 *BR Ambedkar Library, Nadipar*
*Unit of Udayan Public School, Japla*',
'This is an automated message. Please do not reply.',
'[{"name":"{{1}}","type":"text","example":"Rakesh"},{"name":"{{2}}","type":"text","example":"Rakesh"}]'::jsonb,
'library')
ON CONFLICT (template_name, template_language, org_id) DO UPDATE SET
  template_status = EXCLUDED.template_status,
  template_category = EXCLUDED.template_category,
  template_content = EXCLUDED.template_content,
  footer_text = EXCLUDED.footer_text,
  variables = EXCLUDED.variables,
  updated_at = NOW();
