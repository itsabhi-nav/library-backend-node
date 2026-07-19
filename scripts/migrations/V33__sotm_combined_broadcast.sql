-- Student of the Month was broadcast as ONE message PER category winner to the
-- whole library (3 categories => every member got 3 separate MARKETING messages),
-- which tripped Meta's per-user frequency cap (131049) so most failed.
--
-- Repurpose the (previously unused) library_sotm_broadcast template into a single
-- COMBINED announcement that lists all three winners in one message, so each
-- member receives just one message. Variables:
--   {{1}} month label
--   {{2}}/{{3}} Highest Study Hours winner name / value
--   {{4}}/{{5}} Best Attendance winner name / value
--   {{6}}/{{7}} Longest Streak winner name / value
-- Missing categories are sent as "—". Idempotent.
--
-- NOTE: This template must also be created/approved in Meta with the exact same
-- body and 7 variables before it will actually deliver.
INSERT INTO whatsapp_templates (template_name, template_language, template_status, template_category, template_content, footer_text, variables, org_id) VALUES
('library_sotm_broadcast', 'en', 'approved', 'MARKETING',
'🌟 *Students of the Month — {{1}}*

Celebrating our top achievers at BR Ambedkar Library! 👏

🏆 Highest Study Hours: *{{2}}* ({{3}})
📅 Best Attendance: *{{4}}* ({{5}})
🔥 Longest Streak: *{{6}}* ({{7}})

Keep showing up — you could be next! 📚

*BR Ambedkar Library, Nadipar*
*Unit of Udayan Public School, Japla*',
'This is an automated message. Please do not reply.',
'[{"name":"{{1}}","type":"text","example":"June 2026"},{"name":"{{2}}","type":"text","example":"Rahul Sharma"},{"name":"{{3}}","type":"text","example":"120h"},{"name":"{{4}}","type":"text","example":"Amit Kumar"},{"name":"{{5}}","type":"text","example":"26 days"},{"name":"{{6}}","type":"text","example":"Priya Singh"},{"name":"{{7}}","type":"text","example":"18 days in a row"}]'::jsonb,
'library')
ON CONFLICT (template_name, template_language, org_id) DO UPDATE SET
  template_status = EXCLUDED.template_status,
  template_category = EXCLUDED.template_category,
  template_content = EXCLUDED.template_content,
  footer_text = EXCLUDED.footer_text,
  variables = EXCLUDED.variables,
  updated_at = NOW();
