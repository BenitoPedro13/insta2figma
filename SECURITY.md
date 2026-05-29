# Security Policy

Insta2Figma take the security of our service and our users' data seriously.
This document describes how to report security vulnerabilities and what you
can expect from us in return.

The canonical, public version of this policy is available at
**https://mainnet.design/resources/security**.

## Reporting a Vulnerability

If you believe you have found a security vulnerability in Insta2Figma (the
Figma plugin, our backend API, or any related service), please report it to us
privately so we can address it before it is disclosed publicly.

- **Email:** marcus@mainnet.design
- **Subject:** `[SECURITY] <short description>`

Please include, where possible:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (proof-of-concept, requests, or screenshots).
- The affected component (plugin UI, backend API, etc.) and version/date.
- Any suggested remediation.

Please **do not** open public GitHub issues, post in Discord, or otherwise
disclose the issue publicly until we have had a chance to investigate and
release a fix.

## Our Commitment (Response Targets)

| Stage | Target |
| --- | --- |
| Acknowledge receipt of your report | Within **48 hours** |
| Initial assessment and severity triage | Within **5 business days** |
| Fix for critical/high severity issues | Prioritized and deployed as soon as possible |
| Status updates while we investigate | At least every **7 days** |

We will keep you informed throughout the process and will credit you for the
discovery once a fix is released, if you wish to be acknowledged.

## Severity Classification

We triage reported issues using the following severity levels:

- **Critical** — Remote code execution, authentication bypass, or unauthorized
  access to other users' data.
- **High** — Privilege escalation, significant data exposure, or account
  takeover requiring limited preconditions.
- **Medium** — Issues with limited impact or that require significant user
  interaction.
- **Low** — Minor issues with minimal security impact.

## Coordinated Disclosure

We follow a coordinated disclosure model. Once a fix has been deployed, we are
happy to publicly acknowledge the reporter (with permission). We ask that
reporters give us a reasonable amount of time to remediate before any public
disclosure.

## Safe Harbor

We will not pursue or support legal action against individuals who:

- Make a good-faith effort to comply with this policy.
- Report vulnerabilities promptly and privately.
- Avoid privacy violations, data destruction, and service degradation while
  testing (e.g., do not access, modify, or delete data that is not your own,
  and do not run automated denial-of-service tests).

## What Data We Handle

To help reporters scope their testing, our service is designed around data
minimization and stores only what is required to operate:

- A pseudonymous identifier (alias) provided by Figma. We do **not** collect or
  store your real personal email address through the plugin; the account
  identifier is derived from the anonymous Figma-provided user ID.
- Subscription tier/status (billing identity is held by our payment provider).
- Import job metadata and temporary processing artifacts.

Any data we retain for analytics is used solely to understand usage and improve
the product, and is handled in an anonymized / pseudonymized form — it is not
used to identify individual users.

We **do not** store payment card data — all billing is handled by our payment
provider (Polar). All data is transmitted over TLS/HTTPS and stored in an
access-controlled database.

## Supported Versions

We support and patch the latest released version of the Insta2Figma plugin and
the currently deployed version of our backend services. Older plugin versions
should be updated through the Figma Community to receive security fixes.

---

_Last updated: 2026-05-28_
