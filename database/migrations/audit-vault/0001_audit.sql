-- audit-vault / 0001_audit
--
-- Append-only, hash-chained, tamper-evident. On its own database instance so it
-- survives an attacker who owns the application database — otherwise they erase
-- their own tracks (§12B, docs/backend/backend-requirements.md §8).
--
-- Owning service: audit-service (read + sealing). Every other service writes
-- through an INSERT-only role.
--
-- What must never appear here: journal text, therapy transcripts, government ID
-- numbers, full emergency contact details, authentication secrets, encryption keys,
-- payment credentials (§12P logging controls).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Event types — registered, not free text
-- ---------------------------------------------------------------------------

CREATE TABLE audit_event_types (
    id                  text PRIMARY KEY,
    sensitivity         smallint    NOT NULL CHECK (sensitivity BETWEEN 1 AND 5),
    retention           text        NOT NULL DEFAULT 'long_term'
                        CHECK (retention IN ('security_window','long_term','permanent')),
    active              boolean     NOT NULL DEFAULT true
);

COMMENT ON TABLE audit_event_types IS
    'Seeded from metadata/audit/event-types/. A service emitting an unregistered type fails at insert rather than writing an unclassifiable row.';

-- ---------------------------------------------------------------------------
-- The chain
--
-- Field set fixed by §12P. Note what is absent: no free-form message column, and
-- no payload. An audit row records that an access happened, never what was read.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_events (
    seq                 bigserial PRIMARY KEY,

    request_id          uuid        NOT NULL,
    pseudo_id           bigint,
    actor_id            uuid,
    actor_role          text        NOT NULL
                        CHECK (actor_role IN ('user','therapist','moderator','admin','safety_reviewer','partner','service','system')),
    service_name        text        NOT NULL,
    action_type         text        NOT NULL REFERENCES audit_event_types(id),

    -- Must be a registered purpose. Enforced in CI against
    -- metadata/consent/purpose-registry/ and again by the consent engine.
    purpose             text        NOT NULL,

    consent_decision    text        NOT NULL
                        CHECK (consent_decision IN ('granted','denied','not_required','override','expired','withdrawn')),
    access_result       text        NOT NULL
                        CHECK (access_result IN ('allowed','denied','error')),
    risk_score          smallint    CHECK (risk_score BETWEEN 0 AND 100),

    -- Non-identifying context: record counts, vault touched, case reference.
    -- Constrained to an object so a caller cannot smuggle a bare string of content.
    context             jsonb       NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(context) = 'object'),

    occurred_at         timestamptz NOT NULL DEFAULT now(),

    prev_hash           bytea       NOT NULL,
    row_hash            bytea       NOT NULL
);

CREATE INDEX ON audit_events (pseudo_id, occurred_at DESC);
CREATE INDEX ON audit_events (actor_id, occurred_at DESC);
CREATE INDEX ON audit_events (action_type, occurred_at DESC);
CREATE INDEX ON audit_events (occurred_at);
CREATE INDEX ON audit_events (request_id);

-- ---------------------------------------------------------------------------
-- Chain maintenance
--
-- The advisory lock serialises inserts so the chain has a single unambiguous
-- order. This caps audit write throughput deliberately: a correct chain is worth
-- more than concurrent appends, and audit volume is bounded by request volume.
-- If this becomes a bottleneck, shard by service into parallel chains rather than
-- weakening the ordering guarantee.
-- ---------------------------------------------------------------------------

CREATE FUNCTION audit_chain_link() RETURNS trigger AS $$
DECLARE
    last_hash bytea;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('audit_events_chain'));

    SELECT row_hash INTO last_hash
    FROM audit_events
    ORDER BY seq DESC
    LIMIT 1;

    -- Genesis row chains from a fixed zero block.
    NEW.prev_hash := COALESCE(last_hash, decode(repeat('00', 32), 'hex'));

    NEW.row_hash := digest(
        NEW.prev_hash
        || convert_to(COALESCE(NEW.request_id::text, ''), 'UTF8')
        || convert_to(COALESCE(NEW.pseudo_id::text, ''), 'UTF8')
        || convert_to(COALESCE(NEW.actor_id::text, ''), 'UTF8')
        || convert_to(NEW.actor_role, 'UTF8')
        || convert_to(NEW.service_name, 'UTF8')
        || convert_to(NEW.action_type, 'UTF8')
        || convert_to(NEW.purpose, 'UTF8')
        || convert_to(NEW.consent_decision, 'UTF8')
        || convert_to(NEW.access_result, 'UTF8')
        || convert_to(NEW.context::text, 'UTF8')
        || convert_to(NEW.occurred_at::text, 'UTF8'),
        'sha256'
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql
-- SECURITY DEFINER is required, not incidental. Writers hold INSERT without SELECT
-- so a compromised service cannot enumerate who accessed what — but the trigger
-- must read the preceding row_hash to extend the chain. Running as the function
-- owner is what lets both hold at once.
-- search_path is pinned: a SECURITY DEFINER function without it is a privilege
-- escalation vector.
SECURITY DEFINER SET search_path = pg_catalog, public;

CREATE TRIGGER audit_events_chain
    BEFORE INSERT ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_chain_link();

-- Refuse mutation in the database itself, not only through grants. A superuser
-- can still drop this trigger, which is why sealing to WORM storage exists.
CREATE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only (attempted %)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

-- ---------------------------------------------------------------------------
-- Sealing to WORM object storage
--
-- Driven from the Postgres outbox, not a cron, so a missed window is recoverable
-- rather than silently skipped.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_event_hashes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_seq            bigint      NOT NULL,
    to_seq              bigint      NOT NULL,
    segment_hash        bytea       NOT NULL,
    event_count         integer     NOT NULL,

    sealed_at           timestamptz NOT NULL DEFAULT now(),
    object_key          text,
    object_locked_until timestamptz,

    CONSTRAINT segment_range_ordered CHECK (to_seq >= from_seq)
);

CREATE UNIQUE INDEX ON audit_event_hashes (from_seq, to_seq);

COMMENT ON TABLE audit_event_hashes IS
    'Each row seals a contiguous segment of the chain to object storage under Object Lock. Verification recomputes the segment hash and compares; a break localises tampering to one segment rather than invalidating the whole log.';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------

CREATE FUNCTION audit_verify_chain(start_seq bigint DEFAULT 1, end_seq bigint DEFAULT NULL)
RETURNS TABLE (broken_at bigint, reason text) AS $$
DECLARE
    r         record;
    expected  bytea := NULL;
BEGIN
    FOR r IN
        SELECT * FROM audit_events
        WHERE seq >= start_seq AND (end_seq IS NULL OR seq <= end_seq)
        ORDER BY seq
    LOOP
        IF expected IS NOT NULL AND r.prev_hash IS DISTINCT FROM expected THEN
            broken_at := r.seq;
            reason    := 'prev_hash does not match preceding row_hash';
            RETURN NEXT;
        END IF;
        expected := r.row_hash;
    END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION audit_verify_chain IS
    'Run on a schedule and before any compliance export. Returns zero rows for an intact chain.';

COMMIT;
