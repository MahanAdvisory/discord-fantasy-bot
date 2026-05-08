import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy · Fantasy Dashboard",
  description: "How Fantasy Dashboard collects, uses, and protects your information.",
};

const LAST_UPDATED = "May 8, 2026";

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/"
        className="mb-6 inline-flex items-center rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
      >
        ← Back to dashboard
      </Link>

      <h1 className="mb-2 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">Privacy Policy</h1>
      <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">Last updated: {LAST_UPDATED}</p>

      <div className="space-y-6 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        <section>
          <p>
            This Privacy Policy describes how Fantasy Dashboard (&quot;we&quot;, &quot;us&quot;, or
            &quot;our&quot;) collects, uses, and shares information when you use our website,
            Discord bot, and related services (collectively, the &quot;Service&quot;). By using the
            Service, you agree to the practices described below.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            1. Information we collect
          </h2>
          <p className="mb-2">We collect the following categories of information:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Account information.</strong> When you sign in with Discord, Google, or an
              email magic link, we receive a stable account identifier and your email address. We
              do not receive or store your password.
            </li>
            <li>
              <strong>Linked fantasy accounts.</strong> If you choose to link a Sleeper username,
              ESPN league IDs, or other supported services, we store those identifiers and any
              optional credentials you provide (for example, ESPN private league cookies) so we can
              fetch your league data on your behalf.
            </li>
            <li>
              <strong>Usage and league data.</strong> We retrieve and cache fantasy league data
              (rosters, transactions, draft picks, waivers, lineups, and similar) from the
              providers you have linked, in order to deliver the dashboard and notification
              features you have requested.
            </li>
            <li>
              <strong>Notification preferences.</strong> Subscription routes (which Discord servers,
              channels, or DMs receive which categories of notifications) and related metadata you
              configure.
            </li>
            <li>
              <strong>Billing information.</strong> If you subscribe to a paid plan, payments are
              processed by Stripe. We receive the customer and subscription identifiers and status
              from Stripe, but we do not receive or store your full payment card number.
            </li>
            <li>
              <strong>Operational logs.</strong> Standard server logs (timestamps, IP addresses,
              request paths, error traces) that we use to operate, secure, and debug the Service.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            2. How we use information
          </h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>To authenticate you and maintain your session.</li>
            <li>To fetch, display, and notify you about your linked fantasy leagues.</li>
            <li>To process subscriptions and entitlements via Stripe.</li>
            <li>To monitor, troubleshoot, and improve the Service.</li>
            <li>To comply with legal obligations and enforce our Terms of Use.</li>
          </ul>
          <p className="mt-2">
            We do not sell your personal information, and we do not use it for third-party
            advertising.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            3. How we share information
          </h2>
          <p className="mb-2">We share information only with:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Service providers</strong> that help us operate the Service (for example,
              hosting, database, email delivery, and Stripe for billing). These providers process
              data on our behalf under contractual confidentiality and security obligations.
            </li>
            <li>
              <strong>Fantasy data providers</strong> (such as Sleeper and ESPN) when we make
              requests on your behalf using the credentials or identifiers you provided. We are not
              affiliated with, endorsed by, or sponsored by those providers.
            </li>
            <li>
              <strong>Legal and safety</strong> recipients when we believe disclosure is required
              by law, necessary to enforce our terms, or to protect the rights, property, or safety
              of users or the public.
            </li>
            <li>
              <strong>Successors</strong> in connection with a merger, acquisition, or asset sale,
              subject to standard confidentiality protections.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            4. Data retention
          </h2>
          <p>
            We retain account and league data for as long as your account is active. When you
            delete your account or unlink a provider, we remove or anonymize associated data on a
            reasonable schedule, except where retention is required to comply with legal
            obligations, resolve disputes, or enforce agreements. Cached league data may persist
            for a limited time to support performance and abuse prevention.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            5. Security
          </h2>
          <p>
            We use industry-standard administrative, technical, and physical safeguards to protect
            your information, including encryption in transit, access controls, and least-privilege
            credentials. No method of transmission or storage is perfectly secure, and we cannot
            guarantee absolute security.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            6. Your choices
          </h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>You can unlink Sleeper, ESPN, or other providers at any time from the dashboard.</li>
            <li>You can adjust or remove notification subscriptions at any time.</li>
            <li>
              You can request access to, correction of, or deletion of your personal information by
              contacting us using the address below. Some requests may require additional
              verification.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            7. Children&apos;s privacy
          </h2>
          <p>
            The Service is not directed to children under 13 (or the equivalent minimum age in your
            jurisdiction). We do not knowingly collect personal information from such children. If
            you believe a child has provided us with personal information, please contact us and we
            will take steps to delete it.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            8. International users
          </h2>
          <p>
            The Service is operated from the United States. By using the Service, you understand
            that your information may be transferred to, stored in, and processed in the United
            States or other countries, which may have different data protection laws than your
            country of residence.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            9. Changes to this policy
          </h2>
          <p>
            We may update this Privacy Policy from time to time. When we do, we will revise the
            &quot;Last updated&quot; date above. Material changes will be highlighted on the
            Service. Your continued use of the Service after a change constitutes acceptance of the
            updated policy.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            10. Contact us
          </h2>
          <p>
            For questions or requests about this Privacy Policy, contact us through the support
            channel listed on the dashboard or in our Discord application.
          </p>
        </section>
      </div>
    </main>
  );
}
