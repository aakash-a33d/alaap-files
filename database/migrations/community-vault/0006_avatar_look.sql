-- The member's chosen avatar look, on the persona.
--
-- Group sessions draw each member as a portrait they build themselves: a hairstyle,
-- a skin colour, an outfit, a backdrop and a few small extras. This column holds that
-- choice as a set of keys — `{"hair":"waves","skin":"honey","outfit":"knit",...}` —
-- never as colours or image data, so the palette can be retuned without rewriting
-- anybody's row.
--
-- WHY IT BELONGS HERE: the look is seen by everyone in a group beside the handle, so
-- it is public persona data and lives with the handle in the community vault, behind
-- the same pseudo_id. It must never be derived from anything in the identity vault,
-- and nothing writes it except the member, through pseudonym-service. pseudonym-service
-- validates every key before writing; the CHECK below only refuses something that is
-- not a JSON object at all.
--
-- `avatar_seed` and `avatar_style` (the identicon) are left in place: nothing reads
-- them today, and dropping a column on the persona table is not this change's to make.
--
-- NULL means "never chosen", and the client draws the one default look everybody
-- starts with. No grant follows: pseudonym_service already holds UPDATE on the table,
-- and a new column on an already-granted table needs no further privilege.

BEGIN;

ALTER TABLE pseudo_profiles
    ADD COLUMN avatar_look jsonb
    CONSTRAINT pseudo_profiles_avatar_look_object_check
        CHECK (avatar_look IS NULL OR jsonb_typeof(avatar_look) = 'object');

COMMENT ON COLUMN pseudo_profiles.avatar_look IS
    'The member''s chosen group-session portrait, as keys validated by pseudonym-service. Chosen by the member only; never derived from identity.';

COMMIT;
