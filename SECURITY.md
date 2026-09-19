# Security policy

## Supported versions

Until the 1.0 release, only the latest published version receives security
fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository. Do not open a public issue.

Include, as far as you can:

- the affected package and version,
- a description of the issue and its impact,
- a reproduction or proof of concept,
- any suggested mitigation.

We aim to acknowledge a report within 5 working days and to provide an
assessment within 15 working days. If a fix is warranted we will coordinate a
release and credit you unless you prefer otherwise.

## Scope notes

Firsthand renders values into the DOM. Two behaviours are worth knowing:

- A value inserted through a child part is written as **text**, never parsed as
  HTML. `{userInput}` cannot introduce markup.
- `prop:innerHTML` and `attr:srcdoc` write raw HTML by definition. Those are the
  documented escape hatches, and passing untrusted input through them is an
  application-level vulnerability, not a framework one.

The compiler runs at build time over your own source. It does not evaluate the
code it transforms.
