# consent-policy-engine

The only implementation of **"may this actor read this record for this purpose"**.

A service that answers that question locally is a bug
([backend-requirements §9](../../docs/backend/backend-requirements.md)).

---

## Where it runs

The decision is split across two layers, and neither is sufficient alone.

| Layer | Decides | Why not the other layer |
| --- | --- | --- |
| Gateway | Authentication, role, declared purpose, purpose limitation | It cannot know whether therapist `T-982` is assigned to journal `J-3912` |
| Owning service | Is the therapist assigned, did the user share *this* record, has consent expired, does the retention window hold | It cannot see the route policy or the session |

Enforcing only at the gateway would be a correctness bug disguised as a security
boundary. This package is what both layers call.

---

## It takes facts, not repositories

No database handle, no HTTP client, no clock it reads itself. `AccessRequest` in
[`src/types.ts`](src/types.ts) is the contract, and its shape buys three things:

- **Exhaustive tests.** Every denial path is asserted in microseconds with no
  fixtures. 42 tests, and one of them proves every declared `Denial` is reachable, so
  a reason cannot be added, forgotten and left as dead vocabulary.
- **No permissive defaults.** Every field the decision depends on is required, so a
  caller cannot widen an outcome by omitting something.
- **A stated precondition.** The input type says exactly what a service must know
  before it opens a record. A service that cannot fill it in has no business
  decrypting anything.

```ts
import { decide } from '@alaap/consent-policy-engine';

const decision = decide({
  layer: 'service',
  actor: { kind: 'therapist', actorId: 'T-982' },
  action: 'read',
  record: { /* the record's own access policy */ },
  purpose: { /* from metadata/consent/purpose-registry/ */ },
  consent: { /* the owner's grant for this purpose */ },
  care: { therapistId: 'T-982', active: true, scope: 'individual' },
  now: new Date(),
});

if (!decision.allowed) {
  // decision.denial     — machine-readable, for audit context and metrics
  // decision.consent    — what to record in audit_events.consent_decision
  // decision.structural — true when the platform *cannot*, not *will not*
}
```

---

## Check order is load-bearing

Deny-first, and the sequence is not arbitrary.

1. **Structural.** A Maximum Privacy record cannot be read by the platform at all, so
   no consent or relationship makes it readable. Checked first so the engine never
   says "denied" about something that was never possible — *"you cannot see this"* and
   *"we chose not to show you this"* are different sentences, and the interface has to
   be able to tell them apart. `decision.structural` carries that distinction.
2. **Gone.** A purged or retention-expired record is not a permissions question.
   Evaluating consent against it would produce an allow, then a confusing empty read.
3. **Absolute prohibitions.** Training use is never permitted, whatever was consented
   to, because consent to therapy is not consent to be training data.
4. **Relationship, then consent, then caller.** A therapist with no active care
   relationship is refused *before* their consent is examined, so a stale grant cannot
   outlive the relationship that justified it.

The function returns on the first failing check and reaches `allow` only when every
rule has passed. There are no early success paths, so a rule inserted in the middle
cannot be skipped.

---

## Two decisions worth knowing

**`override` is never rewritten to `granted`.** Emergency contact disclosure proceeds
against a stated preference on vital-interest grounds. Recording it as consent would
put a false statement in the one store that can never be corrected.

**Moderators, partners, safety reviewers and admins are refused outright.** Not by
omission — there is a named case for each. A moderator works on community content with
no identity attached; a partner sees de-identified aggregates; a safety reviewer sees
signals rather than content and reaches content only through break-glass; and §12L
assumes an admin account is compromisable, so it holds operational access only.

---

## Known gaps

- **Nothing calls it yet.** The services that would are M3 onwards. The engine and its
  tests are complete; its integration is not.
- **`Denial` reachability is asserted against a hand-maintained list**, because
  TypeScript erases the union at runtime. Adding a reason means adding it to that list
  in the test, and the test fails loudly if it is unreachable — but nothing catches a
  reason added to the union and to neither.
- **Step-up expiry is the caller's.** The engine checks that a step-up assertion
  exists and matches the required scope; the 15-minute lifetime is enforced by the
  gateway's session store, which owns the clock.

```bash
pnpm --filter @alaap/consent-policy-engine test
```
