-- Achievement WhatsApp alerts are now batched into ONE combined message per sync
-- (all newly-unlocked badge names, comma-separated) instead of one message per
-- badge. The old per-badge sends hammered Meta's per-user MARKETING frequency cap
-- (error 131049), so only the first went through and the rest failed.
--
-- We track "already notified" on the row itself so the combined message is never
-- re-sent. Existing badges are marked notified so deploying this doesn't blast a
-- backlog of historical achievements at everyone. New unlocks default to false
-- and get picked up by the next sync. Idempotent.
ALTER TABLE user_achievements
  ADD COLUMN IF NOT EXISTS whatsapp_notified BOOLEAN NOT NULL DEFAULT false;

UPDATE user_achievements
   SET whatsapp_notified = true
 WHERE whatsapp_notified = false;
