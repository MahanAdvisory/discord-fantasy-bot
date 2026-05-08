import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Use · Fantasy Dashboard",
  description: "The terms that govern your use of Fantasy Dashboard.",
};

const LAST_UPDATED = "May 8, 2026";

export default function TermsOfUsePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/"
        className="mb-6 inline-flex items-center rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
      >
        ← Back to dashboard
      </Link>

      <h1 className="mb-2 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">Terms of Use</h1>
      <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">Last updated: {LAST_UPDATED}</p>

      <div className="space-y-6 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        <section>
          <p>
            These Terms of Use (&quot;Terms&quot;) govern your access to and use of Fantasy
            Dashboard&apos;s website, Discord bot, and related services (collectively, the
            &quot;Service&quot;). By using the Service, you agree to these Terms. If you do not
            agree, do not use the Service.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            1. Eligibility and accounts
          </h2>
          <p>
            You must be at least 13 years old (or the minimum age required in your jurisdiction) to
            use the Service. You are responsible for the accuracy of the information you provide,
            for safeguarding your account credentials, and for all activity that occurs under your
            account.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            2. The Service
          </h2>
          <p>
            The Service aggregates and displays fantasy football data from third-party providers
            you choose to link, and delivers notifications and tools that help you manage your
            leagues. Features may change, be added, or be removed at any time. The Service is
            provided on an &quot;as is&quot; and &quot;as available&quot; basis.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            3. Third-party services and disclaimer of affiliation
          </h2>
          <p className="mb-2">
            The Service interacts with third-party platforms, including but not limited to Sleeper,
            ESPN, Discord, Google, and Stripe. We are not affiliated with, endorsed by, or
            sponsored by any fantasy football provider. All trademarks, service marks, and trade
            names belong to their respective owners.
          </p>
          <p>
            Your use of any third-party service is also governed by that service&apos;s own terms
            and policies. We are not responsible for the availability, accuracy, or behavior of
            third-party services, and we may discontinue support for any third-party integration at
            any time.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            4. Acceptable use
          </h2>
          <p className="mb-2">You agree not to:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Use the Service for any unlawful purpose or in violation of these Terms.</li>
            <li>
              Attempt to gain unauthorized access to the Service, other accounts, or related
              systems.
            </li>
            <li>
              Reverse engineer, decompile, or otherwise attempt to derive source code, except where
              expressly permitted by law.
            </li>
            <li>
              Interfere with, disrupt, or impose unreasonable load on the Service or its underlying
              providers, including by abusive scraping or excessive request volume.
            </li>
            <li>
              Use the Service to upload, send, or store content that is illegal, infringing,
              harmful, or that violates the rights of others.
            </li>
            <li>
              Resell, sublicense, or commercially exploit the Service without our prior written
              consent.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            5. Subscriptions and billing
          </h2>
          <p>
            Some features may require a paid subscription. Payments are processed by Stripe.
            Subscriptions automatically renew unless cancelled before the end of the current
            billing period. Fees are non-refundable except where required by law. We may change
            pricing on a going-forward basis with reasonable notice.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            6. Your content and license
          </h2>
          <p>
            You retain ownership of any content you submit to the Service. You grant us a limited,
            non-exclusive, royalty-free, worldwide license to host, store, transmit, and display
            that content solely as needed to operate, provide, and improve the Service.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            7. Intellectual property
          </h2>
          <p>
            The Service, including its software, design, and content (excluding your content and
            third-party content), is owned by us or our licensors and is protected by intellectual
            property laws. We grant you a limited, revocable, non-exclusive, non-transferable
            license to use the Service in accordance with these Terms.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            8. Disclaimers
          </h2>
          <p>
            THE SERVICE IS PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; BASIS,
            WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING IMPLIED WARRANTIES
            OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT
            WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, OR THAT
            THIRD-PARTY DATA WILL BE ACCURATE, COMPLETE, OR TIMELY.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            9. Limitation of liability
          </h2>
          <p>
            TO THE FULLEST EXTENT PERMITTED BY LAW, IN NO EVENT WILL WE BE LIABLE FOR ANY
            INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF
            PROFITS, REVENUES, DATA, OR GOODWILL, ARISING OUT OF OR RELATED TO YOUR USE OF THE
            SERVICE. OUR AGGREGATE LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATED TO THE
            SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU PAID US FOR THE SERVICE IN
            THE TWELVE MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR (B) ONE HUNDRED U.S.
            DOLLARS (US$100).
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            10. Indemnification
          </h2>
          <p>
            You agree to indemnify and hold us harmless from any claims, losses, liabilities,
            damages, costs, and expenses (including reasonable attorneys&apos; fees) arising out
            of or related to your use of the Service, your content, or your violation of these
            Terms or applicable law.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            11. Termination
          </h2>
          <p>
            You may stop using the Service at any time. We may suspend or terminate your access to
            the Service, with or without notice, if we reasonably believe you have violated these
            Terms or to protect the Service or its users. Sections that by their nature should
            survive termination will survive.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            12. Governing law and disputes
          </h2>
          <p>
            These Terms are governed by the laws of the State of Delaware, USA, without regard to
            conflict-of-laws rules. Any dispute arising out of or related to these Terms or the
            Service will be resolved exclusively in the state or federal courts located in
            Delaware, and you consent to personal jurisdiction there. Nothing in this section
            limits any right you may have to bring proceedings in a small-claims court or to seek
            injunctive relief.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            13. Changes to these Terms
          </h2>
          <p>
            We may update these Terms from time to time. When we do, we will revise the &quot;Last
            updated&quot; date above. Material changes will be highlighted on the Service. Your
            continued use of the Service after a change constitutes acceptance of the updated
            Terms.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            14. Miscellaneous
          </h2>
          <p>
            These Terms, together with our{" "}
            <Link href="/privacy" className="underline">
              Privacy Policy
            </Link>
            , are the entire agreement between you and us regarding the Service. If any provision
            is held to be unenforceable, the remaining provisions will remain in full force and
            effect. Our failure to enforce any provision is not a waiver of that provision. You may
            not assign these Terms without our prior written consent; we may assign them freely.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            15. Contact us
          </h2>
          <p>
            For questions about these Terms, contact us through the support channel listed on the
            dashboard or in our Discord application.
          </p>
        </section>
      </div>
    </main>
  );
}
