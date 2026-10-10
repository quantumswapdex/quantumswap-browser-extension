# Security Policy

This policy covers **quantumswap-browser-extension**, the QuantumSwap browser extension. It is maintained by 3-102-953804 S.R.L. (Costa Rica), the company that builds QuantumSwap.

## Reporting a vulnerability

**Please do not open a public GitHub issue, pull request or discussion for security problems.** Report privately instead:

- **Email:** contact@quantumswap.com, with the subject line `Security: quantumswap-browser-extension`
- **Telegram:** message an admin of [t.me/quantumswapdex](https://t.me/quantumswapdex) directly. Do not post details in the public chat.

Please include:

1. A description of the issue and its impact
2. The affected component, version or commit
3. Steps to reproduce, or a proof of concept
4. Optionally, the name you would like to be credited under

## What happens next

| Step | Target time |
|---|---|
| We acknowledge your report | Within 24 hours |
| We confirm the issue and its severity | Within 5 business days |
| We fix it, or agree a timeline with you | Depends on severity; we keep you updated |
| We publish an advisory and credit you (if you wish) | After the fix is released |

Please give us a reasonable chance to fix the issue before disclosing it publicly.

## Scope

**In scope:**

- Exposure of private keys or seed phrases
- Signing without a clear user prompt, or prompts that misrepresent what is being signed
- Origin spoofing that lets a website impersonate another site to the extension
- Insecure messaging between web pages, content scripts and the extension background
- Excessive permissions that can be abused

**Out of scope:**

- Issues that require a malicious browser or a compromised operating system
- Issues in third-party extensions or the browser itself
- Findings from automated scanners without a working proof of concept
- Social engineering, phishing of team members, and physical attacks
- Denial-of-service attacks against public infrastructure

## Recognition

QuantumSwap has run a community bug bounty since February 2026. The program is **recognition-only**: we do not pay monetary rewards. Valid reports are acknowledged according to their severity and impact:

| Severity | Recognition | Typical impact |
|---|---|---|
| Critical | Hall of Fame + security advisory credit | Direct loss or permanent freezing of user funds, or exposure of private keys |
| High | Hall of Fame + release notes credit | Temporary freezing of funds, or theft that needs unlikely user action |
| Medium | Hall of Fame credit | Incorrect behaviour that harms users without direct loss of funds |
| Low | Public acknowledgement | Minor issues and defence-in-depth improvements |

Recognition is decided by the QuantumSwap team based on impact, likelihood and report quality. If the same issue is reported more than once, the first complete report is credited. All credit is given only with your permission, and you can choose to stay anonymous.

## Testing rules

- Test on a local devnet where possible. If you test on mainnet, use a new wallet with small amounts, never your main wallet.
- Only interact with accounts and funds you own.
- Do not access, change or delete other users' data, and do not degrade the service for others.
- Stop testing and report as soon as you confirm an issue.

## Safe harbour

We will not pursue legal action against anyone who finds and reports a vulnerability in good faith and follows this policy.

## Related projects

- **Post-quantum signature library:** issues in the hybrid ML-DSA / SLH-DSA / Ed25519 signing code should be reported through the [circl security policy](https://github.com/quantumcoinproject/circl/security/policy). Its published review is in [SECURITY_AUDIT.md](https://github.com/quantumcoinproject/circl/blob/main/SECURITY_AUDIT.md).
- **QuantumCoin blockchain:** node and consensus issues belong to the [QuantumCoin project](https://github.com/QuantumCoinProject).
