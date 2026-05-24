//
//  SentryScrub.swift
//  Holistic Unity
//
//  Last-mile PII scrub for outbound Sentry events. Mirrors the
//  webapp helper at `client-webapp/src/lib/sentry/scrub.ts` —
//  every string in the event payload is walked and rewritten via
//  regex before the SDK ships it off. The threat model is the
//  same as for the webapps: stack traces or breadcrumbs may
//  accidentally embed Stripe IDs, JWTs, Bearer tokens, or emails
//  from app code, and the Sentry default scrubber doesn't know
//  about those patterns.
//
//  Wired up in `Holistic_UnityApp.swift` via `options.beforeSend`.
//

import Foundation
import Sentry

enum SentryScrub {

    /// Regex patterns applied to every string. Each pair is
    /// (compiled-regex, replacement). Order matters: more-specific
    /// patterns first, so a generic email regex doesn't chew through
    /// a Stripe ID before the Stripe pattern gets a look.
    private static let patterns: [(NSRegularExpression, String)] = {
        let raw: [(String, String)] = [
            // Stripe resource IDs — keep prefix for triage, redact payload
            (
                #"(\b(?:pi|cs|cus|pm|re|seti|ch|evt|acct|ba|card|txn|sub|in|prod|price|src|tok|po|tr|trr)_)[A-Za-z0-9]{14,}"#,
                "$1***"
            ),
            // Stripe API keys — should never leak but be paranoid
            (#"\b(sk|rk|pk)_(test|live)_[A-Za-z0-9]{20,}\b"#, "$1_$2_***"),
            // JWTs (3-part base64url, e.g. Supabase session tokens)
            (#"\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"#, "eyJ***JWT_REDACTED***"),
            // Bearer tokens
            (#"(Bearer\s+)[A-Za-z0-9._\-+/=]+"#, "$1***"),
            // Email addresses (RFC-lite — catches strays beyond event.user.email)
            (#"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"#, "***@***"),
        ]
        return raw.compactMap { pat, rep in
            guard let re = try? NSRegularExpression(pattern: pat) else { return nil }
            return (re, rep)
        }
    }()

    /// Apply every regex sequentially to `value` and return the
    /// redacted string. Linear in pattern count × string length.
    static func redact(_ value: String) -> String {
        var out = value
        for (regex, replacement) in patterns {
            let range = NSRange(out.startIndex..., in: out)
            out = regex.stringByReplacingMatches(
                in: out,
                options: [],
                range: range,
                withTemplate: replacement
            )
        }
        return out
    }

    /// Sentry `beforeSend` callback. Scrubs every PII-bearing field
    /// on the event and returns it for transmission. We never return
    /// `nil` (which would drop the event entirely) — a redacted
    /// event is still useful for triage.
    static func beforeSend(_ event: Event) -> Event? {
        // Event message — `formatted` is the rendered string Sentry
        // displays as the issue title.
        if let formatted = event.message?.formatted {
            event.message?.formatted = redact(formatted)
        }

        // Exception values — the actual thrown-error strings.
        event.exceptions?.forEach { exc in
            if let value = exc.value {
                exc.value = redact(value)
            }
        }

        // Breadcrumbs — message + arbitrary `data` dictionary.
        event.breadcrumbs?.forEach { crumb in
            if let msg = crumb.message {
                crumb.message = redact(msg)
            }
            if let data = crumb.data {
                var scrubbed: [String: Any] = [:]
                for (key, value) in data {
                    if let str = value as? String {
                        scrubbed[key] = redact(str)
                    } else {
                        scrubbed[key] = value
                    }
                }
                crumb.data = scrubbed
            }
        }

        // User context: only the opaque UUID is allowed through.
        // Sentry's default redaction omits some of these but being
        // explicit guards against config drift across SDK versions.
        if let user = event.user {
            user.email = nil
            user.username = nil
            user.ipAddress = nil
        }

        // Request headers — strip cookies + Authorization regardless
        // of case (Sentry sometimes lowercases header names, other
        // times preserves them).
        if let request = event.request {
            if var headers = request.headers {
                headers.removeValue(forKey: "Cookie")
                headers.removeValue(forKey: "cookie")
                headers.removeValue(forKey: "Authorization")
                headers.removeValue(forKey: "authorization")
                request.headers = headers
            }
            if let url = request.url {
                request.url = redact(url)
            }
        }

        return event
    }
}
