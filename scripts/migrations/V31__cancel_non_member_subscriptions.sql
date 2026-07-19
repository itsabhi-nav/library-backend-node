-- Subscriptions only ever belong to MEMBER accounts. Early testing left a couple
-- of stray ACTIVE rows on the admin account, which inflated the "Active Members"
-- stat on the Shifts tab. Cancel (don't delete — a fee_invoice references one of
-- them) any active subscription whose owner is not a MEMBER. Idempotent.
UPDATE subscriptions s
   SET status = 'CANCELLED'
  FROM users u
 WHERE u.id = s.user_id
   AND u.role <> 'MEMBER'
   AND s.status = 'ACTIVE';
