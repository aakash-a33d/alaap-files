/**
 * Generate docs/Alaap-Status-and-Roadmap.docx.
 *
 *     node tools/generators/status-doc.js
 *
 * Lives in the repository rather than wherever it was last run, because it was written
 * in a scratch directory twice and lost twice — and a status document that cannot be
 * regenerated is one that drifts from the thing it describes.
 *
 * The numbers in here are measured, not remembered. Before editing, re-run:
 *
 *     pnpm test                          unit tests
 *     node scripts/dev/<suite>-flows.mjs each live suite's check count
 *     node scripts/db/verify.mjs         privilege boundaries
 */

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, PageBreak,
} = require('docx');
const fs = require('fs');
const path = require('path');

/* A4 (11906 x 16838 DXA) less 1440 margins each side. */
const W = 9026;
const INK = '1A1814';
const MUTED = '55504A';
const GOLD = '8A6A1F';
const RULE = 'D9D4CC';
const STONE = 'F4F1EA';

const P = (text, opts = {}) =>
  new Paragraph({
    spacing: { after: opts.after ?? 140, line: 288 },
    children: [
      new TextRun({
        text,
        size: opts.size ?? 21,
        color: opts.color ?? INK,
        bold: opts.bold,
        font: 'Calibri',
      }),
    ],
  });

/** A paragraph mixing a bold lead-in with plain continuation. */
const Pmix = (runs, opts = {}) =>
  new Paragraph({
    spacing: { after: opts.after ?? 140, line: 288 },
    children: runs.map(
      (r) =>
        new TextRun({
          text: r.t,
          bold: r.b,
          size: opts.size ?? 21,
          color: r.c ?? opts.color ?? INK,
          font: 'Calibri',
        }),
    ),
  });

const H1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 0, after: 120 },
    children: [new TextRun({ text, size: 40, bold: true, color: INK, font: 'Calibri' })],
  });

const H2 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 380, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 } },
    children: [new TextRun({ text, size: 28, bold: true, color: INK, font: 'Calibri' })],
  });

const H3 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 260, after: 120 },
    children: [new TextRun({ text, size: 23, bold: true, color: GOLD, font: 'Calibri' })],
  });

const Bullet = (text) =>
  new Paragraph({
    numbering: { reference: 'dots', level: 0 },
    spacing: { after: 90, line: 288 },
    children: [new TextRun({ text, size: 21, color: INK, font: 'Calibri' })],
  });

const Rule = () =>
  new Paragraph({
    spacing: { before: 60, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 2 } },
    children: [new TextRun({ text: '', size: 2 })],
  });

function row(cells, widths, opts = {}) {
  return new TableRow({
    tableHeader: opts.header,
    /* A row broken mid-cell by a page break reads as two different rows. */
    cantSplit: true,
    children: cells.map(
      (text, i) =>
        new TableCell({
          width: { size: widths[i], type: WidthType.DXA },
          shading: opts.header ? { type: ShadingType.CLEAR, fill: STONE, color: 'auto' } : undefined,
          margins: { top: 90, bottom: 90, left: 120, right: 120 },
          children: [
            new Paragraph({
              spacing: { after: 0, line: 264 },
              children: [
                new TextRun({
                  text,
                  size: 19,
                  bold: opts.header || (opts.boldFirst && i === 0),
                  color: opts.header ? INK : opts.dim && i > 0 ? MUTED : INK,
                  font: 'Calibri',
                }),
              ],
            }),
          ],
        }),
    ),
  });
}

/** Column widths must sum to W, and every cell repeats its own width (Google Docs). */
function table(widths, header, rows, opts = {}) {
  return new Table({
    columnWidths: widths,
    width: { size: W, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [row(header, widths, { header: true }), ...rows.map((r) => row(r, widths, opts))],
  });
}

const body = [];

/* ------------------------------------------------------------------ head -- */
body.push(H1('ALAAP'));
body.push(
  new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: 'Status and Roadmap', size: 26, color: MUTED, font: 'Calibri' })],
  }),
);
body.push(
  new Paragraph({
    spacing: { after: 300 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: GOLD, space: 8 } },
    children: [
      new TextRun({
        text: '23 October 2026  ·  current through M9  ·  usable end to end in a browser',
        size: 19,
        color: MUTED,
        font: 'Calibri',
      }),
    ],
  }),
);

body.push(H3('How to read this document'));
body.push(
  P(
    'This describes what exists, not what is intended. Where something is unbuilt, unproven or ' +
      'known to be wrong, it says so in the same voice as everything else — a status document ' +
      'that only reports progress is a document nobody can plan against.',
  ),
);
body.push(
  P(
    'Section 4 is what runs today and can be demonstrated. Section 5 is what does not exist. ' +
      'Section 6 states the classifier honestly, including the category that matters most and ' +
      'does not work. Sections 7 and 8 are the plan and what could break it.',
  ),
);

/* --------------------------------------------------------------- 1 what -- */
body.push(H2('1.  What Alaap Is'));
body.push(
  P(
    'A privacy-preserving mental wellness platform for India. Somebody arrives carrying ' +
      'something they have not said out loud, and the platform is built so that saying it costs ' +
      'them nothing they cannot get back.',
  ),
);
body.push(
  P(
    'Three commitments shape every technical decision in this document, and each one closes off ' +
      'an option that would otherwise be easier:',
  ),
);
body.push(
  Bullet(
    'No advertising, ever. Somebody who came to find solace is not an audience to be sold. This ' +
      'removes the entire business model the rest of the industry runs on, and with it the reason ' +
      'to retain, profile or rank anybody.',
  ),
);
body.push(
  Bullet(
    'No names. A verified mobile number ties a handle to one person so a trained human can reach ' +
      'them in a crisis, and it is kept where their words cannot reach it. There is no email, no ' +
      'photograph, no date of birth, no real name anywhere in the system.',
  ),
);
body.push(
  Bullet(
    'Posts expire. Five days on the free tier. Not a storage decision — a promise that what you ' +
      'said on your worst night is not a permanent record of you.',
  ),
);

/* -------------------------------------------------------------- 2 plans -- */
body.push(H2('2.  Plans and Limits'));
body.push(
  table(
    [2400, 1500, 1500, 3626],
    ['Plan', 'Price', 'Posts / month', 'What it adds'],
    [
      ['Anonymous Community', 'Free', '4', 'The feed, replies, one AI response per post, mood check-ins'],
      ['Interaction Plus', '₹199', '30', 'Journals, short stories, longer visibility, unlimited reading'],
      ['Care', '₹899', '30', 'A therapist, session notes, the clinical vault in earnest'],
      ['Subsidised Care', '₹99', '30', 'Care, funded in full by a government or partner scheme'],
    ],
    { boldFirst: true },
  ),
);
body.push(P('', { after: 120 }));
body.push(
  Pmix([
    { t: 'Reading is never metered. ', b: true },
    {
      t: 'Quotas cap writing only. A member out of posts can still read the feed, open their own ' +
        'threads, withdraw a consent and delete an entry — there is an assertion in the code that ' +
        'throws if any path tries to gate a read.',
    },
  ]),
);
body.push(
  Pmix([
    { t: 'Mood check-ins and consent withdrawal are never gated at all. ', b: true },
    {
      t: 'Both appear in a never_gated list in the plans metadata, and the services read that ' +
        'list rather than being trusted to remember. A member who cannot withdraw consent has not ' +
        'consented; they have been enrolled.',
    },
  ]),
);

/* ------------------------------------------------------------- 3 arch -- */
body.push(H2('3.  Architecture'));

body.push(H3('3.1  Five vaults, three databases'));
body.push(
  P(
    'Identity, core, community, clinical and billing are separate vaults. Identity sits on its ' +
      'own PostgreSQL instance and audit on a third, so "no cross-vault join" is not a convention ' +
      'anybody has to honour — it is structurally impossible, and there is a test that proves it ' +
      'by trying.',
  ),
);
body.push(
  table(
    [2600, 1500, 1400, 3526],
    ['Vault', 'Instance', 'Tables', 'Holds'],
    [
      ['identity_vault', 'dedicated', '12', 'The mobile number, and nothing a member wrote'],
      ['audit_vault', 'dedicated', '3', 'Append-only, hash-chained access trail'],
      ['core', 'shared', '10', 'Sessions, accounts, devices, deletion requests'],
      ['community_vault', 'shared', '12', 'Posts, replies, moderation verdicts, appeals'],
      ['clinical_vault', 'shared', '11', 'Journals, mood, consent records'],
      ['billing_vault', 'shared', '7', 'Subscriptions and subsidy claims'],
    ],
    { boldFirst: true, dim: true },
  ),
);
body.push(P('', { after: 120 }));
body.push(
  P(
    '55 tables across six databases. Every service holds a credential for its own vault and no ' +
      'other; 52 privilege assertions run against the live databases as the real login roles, and ' +
      'every negative case among them is a boundary the architecture depends on. Six of them ' +
      'describe retention-service, which deletes across five vaults and can open none of them.',
  ),
);

body.push(H3('3.2  Seventeen services and an AI tier, behind one door'));
body.push(
  P(
    'Nothing reaches a service directly. Every request passes the Privacy Gateway, which resolves ' +
      'the session, checks the role, makes the coarse consent decision, enforces purpose ' +
      'limitation, rate-limits, minimises the payload and writes the audit row — before it ' +
      'forwards anything.',
  ),
);
body.push(
  Pmix([
    { t: 'The browser never reaches the AI tier. ', b: true },
    {
      t: 'This was true on paper and false in the code until M8: the composer called the ' +
        'orchestrator directly on port 8000, bypassing all six controls and leaving no audit row. ' +
        'It now goes through the gateway like everything else.',
    },
  ]),
);

body.push(H3('3.3  Technology decisions, settled'));
body.push(
  table(
    [2600, 6426],
    ['Decision', 'Why'],
    [
      ['Node 26, TypeScript, strip-types', 'No build step between source and what runs in development'],
      ['Opaque Redis sessions, not JWTs', 'Revocation has to be instant; a JWT blocklist is a slower session with extra failure modes'],
      ['PostgreSQL, three instances', 'Instance separation is what makes vault isolation structural'],
      ['OpenBao Transit envelope encryption', 'Per-record keys; the service that decides who may read cannot read'],
      ['Self-hosted models only', 'No member text leaves the machine, so there is no processor to disclose'],
      ['Metadata-driven policy in YAML', 'Route policy, quotas, consent purposes and categories are data with schemas, not constants in code'],
    ],
    { boldFirst: true, dim: true },
  ),
);

body.push(H3('3.4  Five mechanisms worth understanding'));
body.push(
  Pmix([
    { t: 'Envelope encryption. ', b: true },
    {
      t: 'Each journal entry gets its own data key, used locally for AES-256-GCM, then wrapped by ' +
        'OpenBao. Plaintext never leaves the process. Verified from the database side: the entry ' +
        'body is absent from the ciphertext as raw bytes and from every text column of the row, ' +
        'and no two rows share a wrapped key.',
    },
  ]),
);
body.push(
  Pmix([
    { t: 'The audit trail is written before the proxy. ', b: true },
    {
      t: 'The access decision is recorded whether or not the upstream is reachable, so a denial ' +
        'and an outage are distinguishable afterwards.',
    },
  ]),
);
body.push(
  Pmix([
    { t: 'The session is an HttpOnly cookie. ', b: true },
    {
      t: 'Issued by the gateway itself — a downstream service cannot set a cookie on our origin, ' +
        'and the proxy strips the header to prove it. An opaque token is not a claim about who ' +
        'somebody is, it is the session, so anything that can read it holds the account. The ' +
        'browser never sees it.',
    },
  ]),
);
body.push(
  Pmix([
    { t: 'Erasure runs through the owning service, never through one privileged role. ', b: true },
    {
      t: 'retention-service orchestrates a deletion across five vaults and holds a database ' +
        'credential for none of them — it cannot even open community_vault or clinical_vault. ' +
        'Each vault is emptied by the service that owns it, over a signed internal route with no ' +
        'gateway path. A single role with DELETE everywhere would be the most dangerous ' +
        'credential in the system; this way a compromised one reaches a request ledger.',
    },
  ]),
);
body.push(
  Pmix([
    { t: 'Crisis triage runs at publish, never on a draft. ', b: true },
    {
      t: 'The consent text shown to members says, in as many words, that drafts are not read. The ' +
        'composer used to send draft text to the crisis model on a keystroke timer. It now runs ' +
        'server-side on what actually published, which is what makes that sentence true.',
    },
  ]),
);

/* ------------------------------------------------------------- 4 built -- */
body.push(new Paragraph({ children: [new PageBreak()] }));
body.push(H2('4.  What Is Actually Built'));
body.push(
  P(
    'All ten milestones are complete and the product now works the way a member would use it. ' +
      'Every claim below was exercised in a browser against live services, not only by the test ' +
      'suites: register with a phone number, post anonymously, be moderated by A1, receive an AI ' +
      'supportive response and a reply, record a mood, write an encrypted journal entry, read and ' +
      'withdraw a consent, export everything, delete the account, sign out. Every sensitive step ' +
      'writes a row to the audit vault.',
  ),
);

body.push(H3('4.1  M3 — identity, without names'));
body.push(
  Bullet(
    'Registration by mobile number and OTP. Four ways back in: OTP, passkey, recovery code, and ' +
      'a handle used as a username.',
  ),
);
body.push(
  Bullet(
    'One permanent handle per number, drawn not chosen — "QuietRiver-4821" out of a space of ' +
      '360,000,000. A handle somebody can swap is not one anybody can answer, so there is no reroll.',
  ),
);
body.push(
  Bullet(
    'Trusted devices, remote revocation, and recovery codes issued once. The server stores only ' +
      'hashes; a member who loses them has lost that door.',
  ),
);
body.push(
  Bullet(
    'An unregistered number receives the same 202 and the same challenge shape as a registered ' +
      'one. Otherwise the endpoint answers "does this person have an account on a mental health ' +
      'platform".',
  ),
);

body.push(H3('4.2  M4 — A1 served locally, behind the gateway'));
body.push(Bullet('MuRIL-large, checkpoint a1-v10, on the GPU, reached only through the gateway.'));
body.push(
  Bullet(
    'The public verdict withholds category scores and thresholds. Routed to a browser they are a ' +
      'tuning oracle for working out what gets past the filter.',
  ),
);
body.push(
  Bullet(
    'Python and Node share one HMAC signing contract, with fixtures generated by the real Node ' +
      'signer so the two halves cannot drift.',
  ),
);

body.push(H3('4.3  M5 and M6 — the community, and one reply that is never bare'));
body.push(
  Bullet(
    'Posting, the feed, replies, quotas, five-day expiry, reports and appeals. A post publishes ' +
      'as written; a reply is checked by A1 before it is stored.',
  ),
);
body.push(
  Bullet(
    'Thirteen categories that are situations, not conditions — "Just today", "Money", "Loss", ' +
      '"Something good". A list of diagnoses asks somebody to name their illness before they are ' +
      'allowed to speak, and most of the people this is for have never been diagnosed.',
  ),
);
body.push(
  Bullet(
    'B1 writes one supportive response per post: Qwen3 8B under Ollama, with eight rule groups it ' +
      'must not break — no diagnosis, no prescription, no stock opener, no claim to be human.',
  ),
);
body.push(
  Bullet('A blocked reply is still stored, unpublished. An appeal needs the text it is appealing about.'),
);

body.push(H3('4.4  M7 — the clinical vault and consent'));
body.push(
  Bullet(
    'Journals encrypted per record; mood check-ins deliberately not, because a number between one ' +
      'and ten has too little entropy for encryption to hide anything and would cost a key ' +
      'operation per read for no privacy.',
  ),
);
body.push(
  Bullet(
    'Consent is granted and withdrawn per purpose, against four published texts. Each says what ' +
      'is processed, what is done with it, and what stopping looks like — the third is the one ' +
      'usually missing.',
  ),
);
body.push(
  Bullet(
    'Consent is checked before quota. A member who withdrew consent must never be told they have ' +
      'run out of an allowance: that reads as "pay us to continue" at the moment they asserted ' +
      'control.',
  ),
);
body.push(
  Bullet(
    'Withdrawing stops new processing and destroys nothing. The existing entries stay readable, ' +
      'exportable and deletable, and the acceptance suite asserts it.',
  ),
);

body.push(H3('4.5  M8 — the browser against live services'));
body.push(
  Bullet(
    'Auth, feed, composer, replies, journal, mood and consent all call the real API. No screen ' +
      'renders invented data, and a gate fails the build if a component imports a fixture again.',
  ),
);
body.push(
  Bullet(
    'The session arrives as an HttpOnly, SameSite=Lax cookie. Signing out is answered by the ' +
      'gateway itself and revokes the session server-side — replaying the old cookie afterwards ' +
      'returns 401.',
  ),
);
body.push(
  Bullet(
    'Refusals keep their identity in the interface: 402 is a plan, 429 an allowance, 451 a ' +
      'consent the member withdrew, 503 a safety check that could not run.',
  ),
);
body.push(
  Bullet(
    'The category picker and the plan limits are served by the backend rather than shipped in the ' +
      'client. The picker had drifted to a condition list the server would have rejected outright.',
  ),
);
body.push(
  Bullet(
    'Public marketing pages show written examples, labelled as such before the reader reaches ' +
      'them. Real members’ words are not marketing material and are not readable without a ' +
      'session.',
  ),
);

body.push(H3('4.6  M9 — taking your data, and being forgotten'));
body.push(
  Bullet(
    'A step-up second factor, which had to be built first: three route groups were declared with ' +
      'step_up: true, the gateway checked the assertion, and nothing in the codebase ever wrote ' +
      'one. Export, admin and break-glass answered 403 to everyone, for four milestones.',
  ),
);
body.push(
  Bullet(
    'An export containing everything the member wrote and nothing anybody else did. Replies other ' +
      'people sent them are excluded — those are somebody else’s words, not theirs to take.',
  ),
);
body.push(
  Bullet(
    'Deletion across five vaults, orchestrated by a service that can open none of them. The ' +
      'handle goes last, because it is the only thing that makes a pseudonym resolvable; once it ' +
      'is gone the pseudo id left in the audit trail points at nobody.',
  ),
);
body.push(
  Bullet(
    'The audit trail survives, and the member is told why in plain words: it holds none of what ' +
      'they wrote, and it is what proves the deletion happened.',
  ),
);
body.push(
  Bullet(
    'A legal hold is reported rather than hidden. A post retained for an appeal survives, the ' +
      'request is recorded as partial rather than complete, and everything else still goes.',
  ),
);
body.push(
  P(
    'Three faults surfaced here that were invisible by reading the code, and all three sat in the ' +
      'design rather than the implementation: a grants file forbidding DELETE to everyone, which ' +
      'made erasure unexecutable; a deleted account whose Redis session kept working; and an ON ' +
      'DELETE CASCADE that destroyed a post the platform had just reported as retained.',
  ),
);

body.push(H3('4.7  What a walkthrough found that the suites did not'));
body.push(
  P(
    'M9 closed with every suite green. Walking the product as a member, cold, found seven things ' +
      'wrong anyway — and the pattern was one thing: the API layer was built correctly and ' +
      'roughly half the buttons were wired to it. Each of these had a working, tested endpoint ' +
      'behind it.',
    { after: 110 },
  ),
);
body.push(
  Bullet(
    'The mood check-in saved nothing. The button set a local flag; the free, never-gated surface ' +
      'the architecture treats as the lowest-friction way in was the one that did not work.',
  ),
);
body.push(
  Bullet(
    'The mood chart drew a month of history on a new account, from a sine wave with seeded noise ' +
      '— a fabricated record of somebody’s own moods, on a platform whose premise is that ' +
      'nothing here is invented about them. The generator is deleted.',
  ),
);
body.push(
  Bullet(
    '"Leave" did not sign anybody out. It was a link to the homepage and the session stayed live, ' +
      'so on a shared phone the next person was inside the account.',
  ),
);
body.push(
  Bullet(
    'No reply ever rendered, the AI’s included. The client asked for a route that does not ' +
      'exist, and the per-thread error handling — written so one bad thread cannot blank the feed ' +
      '— swallowed the 404s. Graceful degradation hid a total failure.',
  ),
);
body.push(
  Bullet(
    'Journal entries were published to the public feed. The composer called the post endpoint for ' +
      'every kind, so a private entry went on the wall under the member’s handle while the ' +
      'control beside it promised the opposite.',
  ),
);
body.push(
  Bullet(
    'The export attributed the AI’s words to the member. B1’s reply is stored against ' +
      'the post author’s pseudonym with source = ai; the export filtered on author alone, ' +
      'under a notice reading "Everything here was written by you".',
  ),
);
body.push(
  Bullet(
    'The sign-up flow ended on a panel stating that no account had been created, no code sent and ' +
      'nothing stored. True when written, false from the moment the backend landed.',
  ),
);
body.push(
  P(
    'All seven are fixed and verified in a browser. Two of them — the journal going public and ' +
      'the export mislabelling authorship — were privacy defects that no amount of green test ' +
      'output would have surfaced, because every endpoint involved was behaving correctly. The ' +
      'lesson is narrow and worth keeping: a suite proves the parts work, and says nothing about ' +
      'whether they are connected to anything a person can press.',
  ),
);

body.push(H3('4.8  Verification that exists today'));
body.push(
  table(
    [4200, 1500, 3326],
    ['Suite', 'Checks', 'What it proves'],
    [
      ['Unit tests, 19 packages', '296', 'Order, silence, and the refusals that look alike'],
      ['login-flows, device-flows', '75', 'Four doors in, trusted devices, revocation'],
      ['community-flows, moderation-flows', '63', 'Posting, quotas, expiry, verdicts, appeals'],
      ['clinical-flows', '32', 'Encryption at rest, consent before content'],
      ['ai-flows', '18', 'A1 through the gateway, audited, no tuning oracle'],
      ['frontend-flows', '34', 'The cookie path a browser actually uses'],
      ['retention-flows', '43', 'Export, deletion, and the databases read directly afterwards'],
      ['Privilege verification', '52', 'Every vault boundary, as the real login roles'],
      ['Browser walkthrough', 'manual', 'Every function a member can press, driven as a member'],
    ],
    { boldFirst: true, dim: true },
  ),
);
body.push(P('', { after: 120 }));
body.push(
  P(
    'The retention suite is the one that trusts nothing: after a deletion it opens all three ' +
      'PostgreSQL instances directly, as superuser, past every grant and every API, and looks for ' +
      'the pseudonym itself. Asking a service whether it deleted something is asking the only ' +
      'party with a reason to say yes.',
  ),
);
body.push(
  P(
    'Three standing gates run alongside. One refuses any database connection pool with no error ' +
      'listener; one refuses any interface component that imports invented data; one refuses a ' +
      'training dataset solvable from either half of a context-reply pair. All three were written ' +
      'after the failure they prevent had already happened once.',
  ),
);
body.push(
  P(
    'Starting the stack is one command rather than a remembered sequence. Twice in a week the ' +
      'browser showed a connection error that looked like a bug in the page and was not: a ' +
      'container restart had wiped OpenBao’s in-memory keys, or the AI tier had come up ' +
      'unauthenticated because one environment variable was unset — and it serves either way, so ' +
      'nothing looks wrong. Both steps are in the script now, which is the runbook made executable.',
  ),
);

/* ---------------------------------------------------------- 5 not built -- */
body.push(H2('5.  What Is Not Built'));
body.push(P('Ten of seventeen services are unwritten. None of them blocks the local run; each is breadth:'));
body.push(
  table(
    [3000, 6026],
    ['Not built', 'Consequence today'],
    [
      ['billing-subsidy-service', 'Everyone is on the free plan; the tier is read from configuration'],
      ['safety-crisis-service', 'Crisis alerts are raised but nothing routes them to a human'],
      ['notification-service', 'Nobody is told when a reply arrives'],
      ['therapist-service, care-therapy-service', 'The Care tier cannot be delivered'],
      ['Moderator-facing queue', 'Appeals are recorded; no one can work them, and no one can set a legal hold'],
      ['identity-vault-service', 'Nothing writes to the identity vault; a number exists only as a blind index'],
      ['Journal reading surface', 'Entries can be written to the vault but not listed or reopened'],
      ['mTLS between services', 'Service auth is a shared HMAC secret across two languages'],
    ],
    { boldFirst: true, dim: true },
  ),
);

/* --------------------------------------------------------------- 6 A1 -- */
body.push(new Paragraph({ children: [new PageBreak()] }));
body.push(H2('6.  The A1 Classifier — Stated Exactly'));
body.push(
  P(
    'Six of sixteen categories are enforced: bullying and harassment, hate speech, threats and ' +
      'intimidation, passive-aggressive abuse, scams and financial exploitation, and grooming ' +
      'indicators held at review. Ten are not.',
  ),
);
body.push(
  Pmix([
    { t: 'The one that matters most does not work. ', b: true, c: GOLD },
    {
      t: 'self_harm_encouragement has no adjudicated training data, and on a platform for people ' +
        'in distress it is the category the whole system exists to catch. The architecture, the ' +
        'serving path and the thresholds are sound and proven end to end; what is missing is ' +
        'labelled examples. It gates public launch rather than local completeness.',
    },
  ]),
);

body.push(H3('6.1  Two ways a pair dataset fails, and both have now happened'));
body.push(
  P(
    'The datasets are meant to teach that the same sentence is cruel or kind depending on what it ' +
      'answers. There are two ways to get that wrong, they are mirror images, and fixing one is ' +
      'how the other gets made.',
    { after: 110 },
  ),
);
body.push(
  table(
    [2500, 3100, 3426],
    ['shortcut', 'a model solves it from', 'and in production it then'],
    [
      ['reply-only', 'the reply alone', 'flags the wrong replies, ignoring who was answered'],
      ['context-only', 'the post alone', 'flags EVERY reply to a distressed person, the kind ones included'],
    ],
    { boldFirst: true, dim: true },
  ),
);
body.push(P('', { after: 120 }));
body.push(
  P(
    'The first batch of five datasets made the first mistake: not one of 24,000 replies appeared ' +
      'under more than one label, and a reply-only classifier scored 0.90 to 1.00. The three ' +
      'datasets that replaced them fix it completely — 100% hard pairs, reply-only down to 0.333 ' +
      '— and make the second mistake instead. A context-only classifier scores 0.93 on unseen posts.',
  ),
);
body.push(
  P(
    'The cause is a single number: 0 of 4,383 contexts appear under more than one label. Risk ' +
      'language sits in 59.3% of harmful posts and 0.3% of safe ones, so the post is a ' +
      'near-perfect separator and the model takes it. In 4,384 rows there is exactly one example ' +
      'of a person at risk being answered kindly.',
  ),
);
body.push(
  Pmix([
    { t: 'That second failure is the worse one here. ', b: true, c: GOLD },
    {
      t: 'The free tier exists so that people answer each other at their lowest. A classifier ' +
        'that blocks support because the post was distressing silences exactly what somebody came ' +
        'for, on the night they came for it. The fix is never to soften the posts — it is to add ' +
        'the row that is missing: a distressed post, answered well, labelled safe.',
    },
  ]),
);
body.push(
  P(
    'The shortcut gate now runs both ablations, and the generation prompts for the missing rows ' +
      'are written. Nothing is staged for training.',
  ),
);

body.push(H3('6.2  Two categories with no usable data at all'));
body.push(
  Pmix([
    { t: 'sexual_exploitation — zero examples. ', b: true },
    {
      t: 'Not few, none. Enforcement is now explicitly off: a severity-5 block decided by an ' +
        'untrained head is worse than no check. The score still travels in the verdict for ' +
        'measurement, so re-enabling is one line when a corpus exists.',
    },
  ]),
);
body.push(
  Pmix([
    { t: 'religious_coercion — 143 rows, 14 unique texts, no pairs. ', b: true },
    {
      t: 'One sentence repeated eleven times, and 66 of the rows co-labelled as unsafe medical ' +
        'advice. Every one sits at the unambiguous end. For India that is the easy five percent: ' +
        '"I will pray for you" and "have you spoken to someone at the temple" are ordinary and ' +
        'constant, and the same sentence is pastoral support after one post and coercion after ' +
        'another. Trained on blatant examples alone the model learns that religious language is ' +
        'the signal, and then flags ordinary comfort — the same shape of harm as the Hinglish ' +
        'bias that took three attempts to fix, falling hardest on the most observant members.',
    },
  ]),
);

body.push(H3('6.3  Two design decisions that are easy to mistake for bugs'));
body.push(
  Pmix([
    { t: 'A member’s own post is never moderated. ', b: true },
    {
      t: 'Every category needs a recipient and a new post has none. Only crisis detection runs on ' +
        'a post, and it gates nothing, blocks nothing and tells the writer nothing. Replies are ' +
        'moderated, because somebody else is on the receiving end.',
    },
  ]),
);
body.push(
  Pmix([
    { t: 'Categories are scoped by language, not duplicated per language. ', b: true },
    {
      t: 'A category is enforced only where it measures acceptably and is demoted to human review ' +
        'elsewhere. This is why abusive Hinglish can pass where the English equivalent is blocked: ' +
        'a known gap, held open deliberately, because enforcing an unmeasured category produces ' +
        'false positives against exactly the people the platform is for.',
    },
  ]),
);

/* -------------------------------------------------------- 7 milestones -- */
body.push(H2('7.  Milestones to First Local Run'));

body.push(H3('7.1  The goal, defined precisely'));
body.push(
  P(
    'One machine runs the whole platform. In a browser you can register with a phone number, ' +
      'create a passkey, post anonymously, watch the post be moderated by A1, receive an AI ' +
      'supportive response, receive a reply, write a journal entry, withdraw a consent, export ' +
      'your data and delete your account. Every sensitive step writes a row to the audit vault, ' +
      'and the privacy test suite passes.',
  ),
);
body.push(P('Everything after that is breadth.', { after: 200 }));

body.push(
  table(
    [620, 3860, 2946, 1600],
    ['M', 'What it delivers', 'Done when', 'Status'],
    [
      ['M0', 'Local infrastructure — Docker Compose, migrations, grants, verification', 'The gateway boots and writes an audit row', 'COMPLETE'],
      ['M1', 'Vault schemas and registered audit event types', 'A row inserts and joins its registered type', 'COMPLETE'],
      ['M2', 'Shared packages: consent engine, audit client, sessions, service auth', 'One implementation of "may this actor read this"', 'COMPLETE'],
      ['M3', 'auth-service and pseudonym-service', 'Register, sign in four ways, resolve a session', 'COMPLETE'],
      ['M4', 'A1 served on the GPU behind the orchestrator', 'A real string returns a real verdict, audited', 'COMPLETE'],
      ['M5', 'community-service and moderation-service', 'Post, be moderated, see replies; quotas enforce', 'COMPLETE'],
      ['M6', 'AI supportive response, self-hosted', 'No post is ever bare', 'COMPLETE'],
      ['M7', 'clinical-vault-service and consent-service', 'An entry written, encrypted, read back, consent withdrawn', 'COMPLETE'],
      ['M8', 'Frontend wired to the real API', 'The browser talks to the backend; no mock data', 'COMPLETE'],
      ['M9', 'retention-service — export and deletion', 'Delete your account and the suite proves it is gone', 'COMPLETE'],
    ],
    { boldFirst: true, dim: true },
  ),
);
body.push(P('', { after: 140 }));
body.push(
  Pmix([
    { t: 'Ten of ten complete. ', b: true },
    {
      t: 'The first local run is done, and as of this revision every function a member can press ' +
        'has been driven in a browser. What stands between here and a public launch is not ' +
        'architecture but the A1 data work in section 6 — and the operational gaps in section 8, ' +
        'chief among them that no human being yet reviews an appeal, a report or a crisis alert.',
    },
  ]),
);

/* ------------------------------------------------------------- 8 risks -- */
body.push(H2('8.  Risks'));
body.push(
  table(
    [2800, 4126, 2100],
    ['Risk', 'Standing', 'Status'],
    [
      [
        'A1 cannot detect self-harm encouragement',
        'Six of sixteen categories enforced. The pair datasets are one fix away rather than unusable, but nothing is trained yet.',
        'Open — binding constraint on public launch',
      ],
      [
        'Two categories have no data whatsoever',
        'sexual_exploitation has zero examples and is switched off; religious_coercion has fourteen unique texts and no pairs.',
        'Open — prompts written, nothing generated',
      ],
      [
        'No human reviews anything yet',
        'Appeals, reports and crisis alerts are all recorded and none are routed to a person. Nobody can place a legal hold either, though deletion honours one.',
        'Open — the binding operational gap',
      ],
      [
        'A2, the crisis model, is a placeholder',
        'Risk banding comes from a baseline. It now runs on every published post.',
        'Open — matters more each week',
      ],
      [
        'B1 output quality',
        'Base model plus prompt delivers about 55 percent usable replies. Retrying does not help.',
        'Open — needs a LoRA, measured',
      ],
      [
        'OpenBao runs in development mode',
        'Keys live in memory. A restart wipes them and orphans every ciphertext permanently.',
        'Open — acceptable locally, not beyond',
      ],
      [
        'A journal delete is a soft delete',
        'A member deleting one entry sets a flag; the ciphertext stays until the account is deleted or a retention sweep runs.',
        'Open — the sweep is unbuilt',
      ],
      [
        'Shared-secret service auth',
        'One HMAC secret across many services and two languages is weaker than the network segment it protects.',
        'Known — mTLS required before real records',
      ],
      [
        '32 GB RAM ceiling',
        'Three Postgres instances, Redis, OpenBao, seven Node services, A1 on the GPU and a generative model is a tight fit.',
        'Open — run services selectively',
      ],
    ],
    { boldFirst: true, dim: true },
  ),
);

body.push(P('', { after: 200 }));
body.push(Rule());
body.push(
  P(
    'Alaap does not diagnose, and is not a replacement for a therapist, a doctor or emergency ' +
      'services.',
    { size: 18, color: MUTED },
  ),
);

/* ------------------------------------------------------------------ doc -- */
const doc = new Document({
  creator: 'Alaap',
  title: 'Alaap — Status and Roadmap',
  description: 'Status and roadmap, current through M9',
  numbering: {
    config: [
      {
        reference: 'dots',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 220 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: body,
    },
  ],
});

const out = process.argv[2] ?? path.resolve(__dirname, '../../docs/Alaap-Status-and-Roadmap.docx');
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
});
